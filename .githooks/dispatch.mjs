import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hookDirectory = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(hookDirectory, "install.json");

function fail(message) {
  console.error(`Git hook blocked: ${message}`);
  process.exitCode = 1;
}

function readManifest() {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.schemaVersion !== 1 || !manifest.originalHooks) {
      throw new Error("unsupported or incomplete install manifest");
    }
    return manifest;
  } catch (error) {
    throw new Error(`cannot read managed hook manifest: ${error.message}`);
  }
}

function git(args, cwd, encoding = null) {
  const result = spawnSync("git", args, {
    cwd,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`could not run git ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.toString().trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

function resolveHookPath(value, cwd) {
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}

function currentOriginalDirectory(manifest, cwd) {
  const original = manifest.originalHooks;
  if (original.kind !== "global") {
    return original.configuredPath ?? original.defaultPath;
  }

  const result = spawnSync("git", ["config", "--global", "--path", "--get", "core.hooksPath"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`could not read global core.hooksPath: ${result.error.message}`);
  }
  if (result.status === 0) {
    const value = result.stdout.replace(/\r?\n$/, "");
    return resolveHookPath(value, cwd);
  }
  if (result.status === 1) return original.defaultPath;
  const detail = result.stderr.trim();
  throw new Error(`could not read global core.hooksPath${detail ? `: ${detail}` : ""}`);
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function sameFilePath(left, right) {
  return canonicalPath(left) === canonicalPath(right);
}

function runOriginalHook(directory, hookName, args, cwd) {
  const candidate = join(directory, hookName);
  if (sameFilePath(candidate, join(hookDirectory, hookName))) {
    return 0;
  }
  try {
    if (!statSync(candidate).isFile()) return 0;
    accessSync(candidate, constants.X_OK);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EACCES") return 0;
    throw new Error(`cannot inspect inherited hook ${candidate}: ${error.message}`);
  }

  const result = spawnSync(candidate, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`could not run inherited hook ${candidate}: ${result.error.message}`);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 128;
  }
  return result.status ?? 1;
}

function fileNames(args, cwd) {
  const output = git(args, cwd);
  if (output.length === 0) return [];
  const names = output.toString("binary").split("\0");
  if (names.at(-1) === "") names.pop();
  return names.map((name) => Buffer.from(name, "binary"));
}

function displayPath(path) {
  const decoded = path.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(path)
    ? JSON.stringify(decoded)
    : `<non-UTF-8 path bytes ${path.toString("hex")}>`;
}

function isProtectedConfiguration(path) {
  return (
    path === ".githooks" ||
    path.startsWith(".githooks/") ||
    path === "lint" ||
    path.startsWith("lint/") ||
    /(^|\/)biome\.jsonc?$/.test(path) ||
    /(^|\/)package\.json$/.test(path) ||
    /(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$/.test(
      path,
    ) ||
    /(^|\/)\.npmrc$/.test(path)
  );
}

function requireCommitTreeMatchesIndex(cwd) {
  const staged = fileNames(
    ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "-z"],
    cwd,
  );
  const unstaged = fileNames(["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z"], cwd);
  const unstagedKeys = new Set(unstaged.map((path) => path.toString("hex")));
  const stagedWithWorktreeChanges = staged.filter((path) => unstagedKeys.has(path.toString("hex")));
  if (stagedWithWorktreeChanges.length > 0) {
    const names = stagedWithWorktreeChanges.map(displayPath);
    throw new Error(`staged files also have unstaged changes: ${names.join(", ")}`);
  }

  const untracked = fileNames(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  const changedConfiguration = [...unstaged, ...untracked].filter((path) =>
    isProtectedConfiguration(path.toString("latin1")),
  );
  if (changedConfiguration.length > 0) {
    const names = changedConfiguration.map(displayPath);
    throw new Error(
      `lint, package, lock, or hook configuration has unstaged changes: ${names.join(", ")}`,
    );
  }
  // Boundary and type checks read the whole tree. An unstaged sibling or an
  // untracked import must not make an incomplete staged snapshot look valid.
  if (unstaged.length > 0) {
    throw new Error(
      `working tree has unstaged files outside the staged snapshot: ${unstaged.map(displayPath).join(", ")}`,
    );
  }
  if (untracked.length > 0) {
    throw new Error(
      `working tree has untracked files outside the staged snapshot: ${untracked.map(displayPath).join(", ")}`,
    );
  }
}

function requireTrackedTreeClean(cwd) {
  const status = git(
    ["status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=none"],
    cwd,
  );
  if (status.length > 0) {
    throw new Error(
      "tracked working tree or index is dirty; commit or discard tracked changes before pushing",
    );
  }
}

function runProjectCheck(command, cwd) {
  const environment = { ...process.env };
  if (command === "check") {
    // Git exports repository-local variables to push hooks. The full suite
    // creates temporary repositories, so it must discover each repo from cwd.
    // Keep the commit check's alternate index when checking staged files.
    for (const name of git(["rev-parse", "--local-env-vars"], cwd, "utf8").split(/\r?\n/)) {
      if (name) delete environment[name];
    }
  }
  const result = spawnSync("pnpm", [command], {
    cwd,
    env: environment,
    stdio: "inherit",
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(`pnpm is required to run 'pnpm ${command}' and was not found on PATH`);
  }
  if (result.error) {
    throw new Error(`could not run 'pnpm ${command}': ${result.error.message}`);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 128;
  }
  return result.status ?? 1;
}

function dispatch() {
  const wrapperPath = process.argv[2];
  if (!wrapperPath) throw new Error("hook wrapper did not pass its event name");
  const hookName = basename(wrapperPath);
  const args = process.argv.slice(3);
  const cwd = process.cwd();
  const manifest = readManifest();
  const originalDirectory = currentOriginalDirectory(manifest, cwd);
  const originalStatus = runOriginalHook(originalDirectory, hookName, args, cwd);
  if (originalStatus !== 0) {
    process.exitCode = originalStatus;
    return;
  }

  if (hookName === "pre-commit") {
    const worktreeRoot = git(["rev-parse", "--show-toplevel"], cwd, "utf8").replace(/\r?\n$/, "");
    requireCommitTreeMatchesIndex(worktreeRoot);
    process.exitCode = runProjectCheck("check:commit", worktreeRoot);
  } else if (hookName === "pre-push") {
    const worktreeRoot = git(["rev-parse", "--show-toplevel"], cwd, "utf8").replace(/\r?\n$/, "");
    requireTrackedTreeClean(worktreeRoot);
    process.exitCode = runProjectCheck("check", worktreeRoot);
  }
}

try {
  dispatch();
} catch (error) {
  fail(error.message);
}
