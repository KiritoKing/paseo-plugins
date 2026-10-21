import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOOK_NAMES = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "proc-receive",
  "post-receive",
  "post-update",
  "reference-transaction",
  "push-to-checkout",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change",
];

const MANAGED_DIRECTORY = "paseo-managed-hooks";
const MANIFEST = "install.json";
const DISPATCHER = "dispatch.mjs";
const SCHEMA_VERSION = 1;

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`could not run git ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.replace(/\r?\n$/, "");
}

function optionalGitConfig(args, cwd, env = process.env) {
  const result = spawnSync("git", ["config", ...args], {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`could not run git config: ${result.error.message}`);
  }
  if (result.status === 1) return null;
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(`git config failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.replace(/\r?\n$/, "");
}

function parseOriginSetting(output) {
  if (output === null) return null;
  const separator = output.indexOf("\t");
  if (separator === -1) {
    throw new Error("git config did not return a parseable core.hooksPath origin");
  }
  return {
    origin: output.slice(0, separator),
    value: output.slice(separator + 1),
  };
}

function absoluteHookPath(value, worktreeRoot) {
  return isAbsolute(value) ? resolve(value) : resolve(worktreeRoot, value);
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function expectedNames() {
  return new Set([MANIFEST, DISPATCHER, ...HOOK_NAMES]);
}

function readInstalled(managedPath, worktreeRoot, effectivePath) {
  const manifestPath = join(managedPath, MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new Error(`refusing to reuse unrecognized directory: ${managedPath}`);
  }

  const actualNames = readdirSync(managedPath).sort();
  const knownNames = [...expectedNames()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(knownNames)) {
    throw new Error(`managed hook directory contains unknown files: ${managedPath}`);
  }
  for (const name of actualNames) {
    const info = lstatSync(join(managedPath, name));
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`managed hook entry is not a regular file: ${name}`);
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`managed hook manifest is invalid: ${error.message}`);
  }
  if (
    manifest.schemaVersion !== SCHEMA_VERSION ||
    manifest.worktreeRoot !== worktreeRoot ||
    manifest.managedPath !== managedPath ||
    JSON.stringify(manifest.hooks) !== JSON.stringify(HOOK_NAMES)
  ) {
    throw new Error(`managed hook manifest does not match this installer: ${managedPath}`);
  }

  for (const [name, digest] of Object.entries(manifest.files ?? {})) {
    if (
      !expectedNames().has(name) ||
      name === MANIFEST ||
      fileDigest(join(managedPath, name)) !== digest
    ) {
      throw new Error(`managed hook file was changed or is unrecognized: ${name}`);
    }
  }
  if (Object.keys(manifest.files ?? {}).length !== HOOK_NAMES.length + 1) {
    throw new Error("managed hook manifest is incomplete");
  }
  if (!effectivePath || canonicalPath(effectivePath) !== canonicalPath(managedPath)) {
    throw new Error("managed hook files exist but this worktree is not configured to use them");
  }
  return manifest;
}

function wrapperSource() {
  return [
    "#!/bin/sh",
    'HOOK_DIR=$(CDPATH= cd -P "$(dirname -- "$0")" && pwd) || exit 1',
    'exec node "$HOOK_DIR/dispatch.mjs" "$0" "$@"',
    "",
  ].join("\n");
}

function configPathFrom(output, worktreeRoot) {
  const setting = parseOriginSetting(output);
  return setting ? absoluteHookPath(setting.value, worktreeRoot) : null;
}

function commonGitDirectory(worktreeRoot) {
  const gitEntryPath = join(worktreeRoot, ".git");
  const realGitEntry = realpathSync(gitEntryPath);
  let gitDirectory;
  if (lstatSync(realGitEntry).isDirectory()) {
    gitDirectory = realGitEntry;
  } else {
    const gitEntry = readFileSync(gitEntryPath, "utf8").trim();
    const match = /^gitdir:\s*(.+)$/i.exec(gitEntry);
    if (!match) throw new Error(`could not read Git directory from ${gitEntryPath}`);
    gitDirectory = realpathSync(resolve(worktreeRoot, match[1]));
  }

  const commonDirectoryFile = join(gitDirectory, "commondir");
  if (!existsSync(commonDirectoryFile)) return gitDirectory;
  const commonDirectoryValue = readFileSync(commonDirectoryFile, "utf8").trim();
  if (!commonDirectoryValue)
    throw new Error(`Git common directory is empty: ${commonDirectoryFile}`);
  return realpathSync(resolve(gitDirectory, commonDirectoryValue));
}

function refuseUnsafeCommonWorktreeConfig(commonDirectory) {
  const commonConfig = join(commonDirectory, "config");
  const configReadCwd = tmpdir();
  const configReadEnvironment = { ...process.env };
  for (const key of Object.keys(configReadEnvironment)) {
    if (key.startsWith("GIT_")) delete configReadEnvironment[key];
  }
  const extensionEnabled =
    optionalGitConfig(
      [
        "--file",
        commonConfig,
        "--no-includes",
        "--type=bool",
        "--get",
        "extensions.worktreeConfig",
      ],
      configReadCwd,
      configReadEnvironment,
    ) === "true";
  if (extensionEnabled) return;

  const hasCoreWorktree =
    optionalGitConfig(
      ["--file", commonConfig, "--no-includes", "--get-all", "core.worktree"],
      configReadCwd,
      configReadEnvironment,
    ) !== null;
  const coreBareValues = optionalGitConfig(
    ["--file", commonConfig, "--no-includes", "--type=bool", "--get-all", "core.bare"],
    configReadCwd,
    configReadEnvironment,
  );
  const hasCoreBareTrue = coreBareValues?.split("\n").includes("true") ?? false;
  const sensitiveSettings = [
    ...(hasCoreWorktree ? ["core.worktree"] : []),
    ...(hasCoreBareTrue ? ["core.bare=true"] : []),
  ];
  if (sensitiveSettings.length > 0) {
    throw new Error(
      `refusing to enable extensions.worktreeConfig: common local config contains ${sensitiveSettings.join(" and ")}; manually migrate these worktree-sensitive settings from the common config to the main worktree's config.worktree, then retry`,
    );
  }
}

export function installHooks(cwd = process.cwd()) {
  const sourceDirectory = realpathSync(dirname(fileURLToPath(import.meta.url)));
  const sourceWorktreeRoot = realpathSync(join(sourceDirectory, ".."));
  refuseUnsafeCommonWorktreeConfig(commonGitDirectory(sourceWorktreeRoot));

  const worktreeRoot = realpathSync(git(["rev-parse", "--show-toplevel"], cwd));
  if (sourceDirectory !== realpathSync(join(worktreeRoot, ".githooks"))) {
    throw new Error("run this installer from the worktree that contains its .githooks directory");
  }

  const gitDirectory = realpathSync(git(["rev-parse", "--absolute-git-dir"], worktreeRoot));
  const managedPath = join(gitDirectory, MANAGED_DIRECTORY);
  const effectiveOutput = optionalGitConfig(
    ["--show-origin", "--path", "--get", "core.hooksPath"],
    worktreeRoot,
  );
  const effectiveSetting = parseOriginSetting(effectiveOutput);
  if (effectiveSetting?.origin.startsWith("command line:")) {
    throw new Error("refusing installation while core.hooksPath is overridden on the command line");
  }
  const effectivePath = effectiveSetting
    ? absoluteHookPath(effectiveSetting.value, worktreeRoot)
    : null;

  if (existsSync(managedPath)) {
    const manifest = readInstalled(managedPath, worktreeRoot, effectivePath);
    const source = join(sourceDirectory, DISPATCHER);
    const target = join(managedPath, DISPATCHER);
    if (fileDigest(source) !== fileDigest(target)) {
      const dispatcherUpdate = join(managedPath, ".dispatch-update");
      const manifestUpdate = join(managedPath, ".manifest-update");
      writeFileSync(dispatcherUpdate, readFileSync(source), { flag: "wx", mode: 0o600 });
      manifest.files[DISPATCHER] = fileDigest(dispatcherUpdate);
      writeFileSync(manifestUpdate, `${JSON.stringify(manifest, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(dispatcherUpdate, target);
      renameSync(manifestUpdate, join(managedPath, MANIFEST));
      readInstalled(managedPath, worktreeRoot, effectivePath);
      console.log(`Updated Git hooks for this worktree: ${managedPath}`);
    } else {
      console.log(`Git hooks already installed for this worktree: ${managedPath}`);
    }
    return managedPath;
  }
  if (effectivePath && canonicalPath(effectivePath) === canonicalPath(managedPath)) {
    throw new Error(`core.hooksPath already points to a missing managed directory: ${managedPath}`);
  }

  const globalOutput = optionalGitConfig(
    ["--global", "--show-origin", "--path", "--get", "core.hooksPath"],
    worktreeRoot,
  );
  const globalSetting = parseOriginSetting(globalOutput);
  const defaultPath = git(
    ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
    worktreeRoot,
  );
  const inheritedKind =
    effectiveSetting &&
    globalSetting &&
    effectiveSetting.origin === globalSetting.origin &&
    effectiveSetting.value === globalSetting.value
      ? "global"
      : effectiveSetting
        ? "configured"
        : "default";
  const originalHooks = {
    kind: inheritedKind,
    origin: effectiveSetting?.origin ?? null,
    configuredPath: effectivePath,
    defaultPath: canonicalPath(defaultPath),
  };

  const dispatcherSource = join(sourceDirectory, DISPATCHER);
  if (!existsSync(dispatcherSource)) {
    throw new Error(`persistent dispatcher is missing: ${dispatcherSource}`);
  }

  mkdirSync(managedPath, { mode: 0o700 });
  try {
    const dispatcherPath = join(managedPath, DISPATCHER);
    writeFileSync(dispatcherPath, readFileSync(dispatcherSource), { flag: "wx", mode: 0o600 });
    chmodSync(dispatcherPath, 0o600);
    for (const hookName of HOOK_NAMES) {
      const wrapperPath = join(managedPath, hookName);
      writeFileSync(wrapperPath, wrapperSource(), { encoding: "utf8", mode: 0o755, flag: "wx" });
      chmodSync(wrapperPath, 0o755);
    }

    const files = Object.fromEntries(
      [DISPATCHER, ...HOOK_NAMES].map((name) => [name, fileDigest(join(managedPath, name))]),
    );
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      worktreeRoot,
      managedPath,
      hooks: HOOK_NAMES,
      originalHooks,
      files,
    };
    writeFileSync(join(managedPath, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    throw new Error(`could not prepare managed hook files at ${managedPath}: ${error.message}`);
  }

  const currentOutput = optionalGitConfig(
    ["--show-origin", "--path", "--get", "core.hooksPath"],
    worktreeRoot,
  );
  if (currentOutput !== effectiveOutput) {
    throw new Error(
      "core.hooksPath changed while the installer was preparing; refusing to replace it",
    );
  }

  git(["config", "--local", "--replace-all", "extensions.worktreeConfig", "true"], worktreeRoot);
  git(["config", "--worktree", "--replace-all", "core.hooksPath", managedPath], worktreeRoot);

  const installedSetting = optionalGitConfig(
    ["--show-origin", "--path", "--get", "core.hooksPath"],
    worktreeRoot,
  );
  const installedPath = configPathFrom(installedSetting, worktreeRoot);
  if (!installedPath || canonicalPath(installedPath) !== canonicalPath(managedPath)) {
    throw new Error("Git did not read back the worktree-specific core.hooksPath setting");
  }

  console.log(`Installed Git hooks for this worktree: ${managedPath}`);
  return managedPath;
}

if (
  process.argv[1] &&
  canonicalPath(resolve(process.argv[1])) === canonicalPath(fileURLToPath(import.meta.url))
) {
  try {
    installHooks();
  } catch (error) {
    console.error(`Git hook installation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
