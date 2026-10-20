import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import semver from "semver";

export const PNPM_VERSION = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).packageManager.replace("pnpm@", "");
export const REQUIRED_PACKAGE_FILES = [
  "package.json",
  "paseo-plugin.json",
  "OVERVIEW.md",
  "LICENSE",
  "README.md",
];
export const RUNTIME_ENTRY_NAMES = [
  "index.client.ts",
  "index.client.tsx",
  "index.server.ts",
  "index.server.tsx",
];
export const PUBLIC_DATA_MARKERS =
  /\/Users\/|\.feishu\.cn|\.larkoffice\.com|\.byted\.org|\.bytedance\.net|\bsk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/;

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function toPosixPath(path) {
  return path.split(sep).join("/");
}

export function readJson(path, description = path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${description}: ${error.message}`, { cause: error });
  }
}

export function getRuntimeEntries(packageRoot) {
  return RUNTIME_ENTRY_NAMES.filter((name) => existsSync(resolve(packageRoot, name)));
}

export function assertRuntimeEntries(entries, packageName = "package") {
  requireValue(
    entries.length > 0,
    `Missing source runtime entry (index.client/server.ts/tsx): ${packageName}`,
  );
  return entries;
}

export function assertPackageNameMatchesDirectory(packageRoot, packageJson) {
  const directoryName = basename(resolve(packageRoot));
  const expectedName = `@chlrc/${directoryName}`;
  requireValue(
    packageJson.name === expectedName,
    `Package name must match its directory (${expectedName}): ${packageJson.name ?? "(missing)"}`,
  );
  requireValue(
    packageJson.name.length <= 214 &&
      /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(packageJson.name),
    `Invalid npm package name: ${packageJson.name}`,
  );
}

export function assertManifestId(pluginManifest, packageName, seenIds) {
  const id = pluginManifest?.id;
  requireValue(
    typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id),
    `Invalid paseo-plugin.json id: ${packageName}`,
  );
  requireValue(!seenIds.has(id), `Duplicate paseo-plugin.json id "${id}": ${packageName}`);
  seenIds.add(id);
}

export function assertShrinkwrapComplete(packageJson, shrinkwrap) {
  const runtimeDependencies = packageJson.dependencies ?? {};
  if (!Object.keys(runtimeDependencies).length) return false;

  requireValue(
    shrinkwrap && typeof shrinkwrap === "object",
    `Runtime dependencies require npm-shrinkwrap.json: ${packageJson.name}`,
  );
  requireValue(
    Number(shrinkwrap.lockfileVersion) >= 2,
    `npm-shrinkwrap.json must use npm lockfileVersion 2 or newer: ${packageJson.name}`,
  );
  const lockPackages = shrinkwrap.packages;
  requireValue(
    lockPackages && typeof lockPackages === "object",
    `npm-shrinkwrap.json is missing packages metadata: ${packageJson.name}`,
  );

  const rootPackage = lockPackages[""];
  requireValue(
    rootPackage && typeof rootPackage === "object",
    `npm-shrinkwrap.json is missing its root package entry: ${packageJson.name}`,
  );
  requireValue(
    rootPackage.name === packageJson.name && rootPackage.version === packageJson.version,
    `npm-shrinkwrap.json root package identity does not match: ${packageJson.name}`,
  );
  for (const [name, versionRange] of Object.entries(runtimeDependencies)) {
    requireValue(
      rootPackage.dependencies?.[name] === versionRange,
      `npm-shrinkwrap.json does not match runtime dependency ${name}@${versionRange}: ${packageJson.name}`,
    );
    const lockEntry = lockPackages[`node_modules/${name}`];
    requireValue(
      lockEntry && typeof lockEntry === "object",
      `npm-shrinkwrap.json is missing runtime dependency ${name}: ${packageJson.name}`,
    );
    requireValue(
      typeof lockEntry.resolved === "string" && lockEntry.resolved.length > 0,
      `npm-shrinkwrap.json is missing resolved for ${name}: ${packageJson.name}`,
    );
    requireValue(
      typeof lockEntry.integrity === "string" && lockEntry.integrity.length > 0,
      `npm-shrinkwrap.json is missing integrity for ${name}: ${packageJson.name}`,
    );
  }

  for (const [name, entry] of Object.entries(lockPackages)) {
    if (!name.startsWith("node_modules/")) continue;
    requireValue(
      entry?.link !== true,
      `npm-shrinkwrap.json must not contain workspace links (${name}): ${packageJson.name}`,
    );
    requireValue(
      typeof entry?.resolved === "string" && entry.resolved.length > 0,
      `npm-shrinkwrap.json is missing resolved for ${name}: ${packageJson.name}`,
    );
    requireValue(
      typeof entry?.integrity === "string" && entry.integrity.length > 0,
      `npm-shrinkwrap.json is missing integrity for ${name}: ${packageJson.name}`,
    );
    let source;
    try {
      source = new URL(entry.resolved);
    } catch {
      throw new Error(`Invalid dependency source for ${name}: ${packageJson.name}`);
    }
    requireValue(
      source.protocol === "https:" &&
        source.hostname === "registry.npmjs.org" &&
        !source.username &&
        !source.password,
      `Consumer lock must use public npm sources for ${name}: ${packageJson.name}`,
    );
  }
  return true;
}

export function validatePackageMetadata({
  root,
  packageRoot,
  packageJson,
  pluginManifest,
  seenIds,
}) {
  const packageName = packageJson.name ?? basename(packageRoot);
  assertPackageNameMatchesDirectory(packageRoot, packageJson);
  requireValue(packageJson.private !== true, `Public workspace cannot be private: ${packageName}`);
  requireValue(
    typeof packageJson.version === "string" &&
      semver.valid(packageJson.version) === packageJson.version,
    `Invalid package version: ${packageName}`,
  );
  assertManifestId(pluginManifest, packageName, seenIds);
  requireValue(packageJson.license === "MIT", `Package license must be MIT: ${packageName}`);
  requireValue(
    packageJson.publishConfig?.access === "public",
    `Package publish access must be public: ${packageName}`,
  );
  requireValue(
    packageJson.publishConfig?.registry === "https://registry.npmjs.org",
    `Package registry must be https://registry.npmjs.org: ${packageName}`,
  );
  requireValue(
    packageJson.repository?.directory === toPosixPath(relative(root, packageRoot)),
    `Package repository.directory does not match its workspace path: ${packageName}`,
  );

  const entries = assertRuntimeEntries(getRuntimeEntries(packageRoot), packageName);
  const files = packageJson.files;
  requireValue(Array.isArray(files), `Package files must be an array: ${packageName}`);
  for (const file of files) {
    requireValue(
      typeof file === "string" &&
        file.length > 0 &&
        !isAbsolute(file) &&
        !file.split(/[\\/]/).includes(".."),
      `Invalid package files entry: ${packageName}/${file}`,
    );
  }
  for (const required of ["paseo-plugin.json", "OVERVIEW.md", "LICENSE", "README.md"]) {
    requireValue(
      files.includes(required),
      `Package files must include ${required}: ${packageName}`,
    );
    requireValue(
      existsSync(resolve(packageRoot, required)),
      `Required package source file is missing: ${packageName}/${required}`,
    );
  }
  for (const entry of entries)
    requireValue(
      files.includes(entry),
      `Package files must include runtime entry ${entry}: ${packageName}`,
    );

  const hasRuntimeDependencies = Object.keys(packageJson.dependencies ?? {}).length > 0;
  if (hasRuntimeDependencies) {
    requireValue(
      files.includes("npm-shrinkwrap.json"),
      `Package files must include npm-shrinkwrap.json for runtime dependencies: ${packageName}`,
    );
    const shrinkwrapPath = resolve(packageRoot, "npm-shrinkwrap.json");
    requireValue(
      existsSync(shrinkwrapPath),
      `Runtime dependencies require npm-shrinkwrap.json: ${packageName}`,
    );
    assertShrinkwrapComplete(
      packageJson,
      readJson(shrinkwrapPath, `${packageName}/npm-shrinkwrap.json`),
    );
  }

  return { packageName, entries, hasRuntimeDependencies };
}

export function parseWorkspaceList(root, output) {
  let records;
  try {
    records = JSON.parse(output);
  } catch (error) {
    throw new Error(`pnpm list returned invalid JSON: ${error.message}`, { cause: error });
  }
  requireValue(Array.isArray(records), "pnpm list -r --depth -1 --json must return a JSON array");

  const packages = [];
  const seenPaths = new Set();
  for (const record of records) {
    requireValue(
      record && typeof record.path === "string",
      "pnpm workspace record is missing its package path",
    );
    const packageRoot = resolve(root, record.path);
    requireValue(
      isPathInside(root, packageRoot),
      `Workspace path escapes repository root: ${record.path}`,
    );
    if (packageRoot === resolve(root)) continue;
    const packageJsonPath = resolve(packageRoot, "package.json");
    requireValue(existsSync(packageJsonPath), `Workspace package.json is missing: ${record.path}`);
    const packageJson = readJson(packageJsonPath, `${record.path}/package.json`);
    if (packageJson.private === true) continue;
    requireValue(!seenPaths.has(packageRoot), `Duplicate pnpm workspace path: ${record.path}`);
    seenPaths.add(packageRoot);
    if (record.name !== undefined)
      requireValue(
        record.name === packageJson.name,
        `pnpm workspace name does not match package.json: ${record.path}`,
      );
    packages.push({ packageRoot, packageJson });
  }

  requireValue(packages.length > 0, "pnpm did not discover any public workspaces");
  return packages.sort((left, right) => left.packageRoot.localeCompare(right.packageRoot));
}

export function getPnpmInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /(?:^|[\\/])pnpm(?:\.c?js)$/i.test(npmExecPath)) {
    return { command: process.execPath, prefixArgs: [npmExecPath] };
  }
  return { command: "pnpm", prefixArgs: [] };
}

export function runPnpm(args, options = {}) {
  const invocation = getPnpmInvocation();
  let version;
  try {
    version = execFileSync(invocation.command, [...invocation.prefixArgs, "--version"], {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`Unable to run the pinned pnpm ${PNPM_VERSION} CLI: ${error.message}`, {
      cause: error,
    });
  }
  requireValue(
    version === PNPM_VERSION,
    `Expected pnpm ${PNPM_VERSION}, found ${version || "(no version)"}`,
  );

  try {
    return execFileSync(invocation.command, [...invocation.prefixArgs, ...args], {
      cwd: options.cwd,
      encoding: options.encoding ?? "utf8",
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      env: options.env ?? process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((part) => String(part).trim())
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `pnpm ${args.join(" ")} failed${error.status === undefined ? "" : ` (exit ${error.status})`}${details ? `:\n${details}` : `: ${error.message}`}`,
      { cause: error },
    );
  }
}

export function assertPackageLocalImport(packageRoot, resolvedPath, importPath) {
  requireValue(
    isPathInside(packageRoot, resolvedPath),
    `Local import escapes packed package (${importPath}): ${resolvedPath}`,
  );
}

export function assertPublishedManifest(pluginManifest, packageName) {
  requireValue(
    !Object.hasOwn(pluginManifest, "build"),
    `Published paseo-plugin.json must omit the Git-only build command: ${packageName}`,
  );
}

export function assertArchivePaths(paths, packageName) {
  const normalized = [];
  for (const rawPath of paths) {
    const path = rawPath.replace(/\\/g, "/").replace(/\/$/, "");
    if (!path) continue;
    requireValue(
      !path.startsWith("/") && !path.split("/").includes(".."),
      `Unsafe path in package archive (${packageName}): ${rawPath}`,
    );
    requireValue(
      path === "package" || path.startsWith("package/"),
      `Unexpected archive root (${packageName}): ${rawPath}`,
    );
    normalized.push(path === "package" ? "" : path.slice("package/".length));
  }
  return [...new Set(normalized)];
}

export function assertArchiveContents(paths, entries, packageName) {
  const files = assertArchivePaths(paths, packageName);
  for (const required of REQUIRED_PACKAGE_FILES)
    requireValue(files.includes(required), `Missing packed ${required}: ${packageName}`);
  assertRuntimeEntries(entries, packageName);
  for (const entry of entries)
    requireValue(files.includes(entry), `Missing packed runtime entry ${entry}: ${packageName}`);
  const forbidden = files.find((path) =>
    /(^|\/)(?:tests|node_modules|work)(?:\/|$)|(^|\/)validation(?:\.[^/]*)?(?:\/|$)|(^|\/)VALIDATION\.md$/i.test(
      path,
    ),
  );
  requireValue(!forbidden, `Unexpected packed file: ${packageName}/${forbidden}`);
  return files;
}

export function isMainModule(importMetaUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && importMetaUrl === pathToFileURL(resolve(argvPath)).href;
}
