import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isMainModule,
  PUBLIC_DATA_MARKERS,
  parseWorkspaceList,
  readJson,
  requireValue,
  runPnpm,
  validatePackageMetadata,
} from "./lib/package-utils.mjs";

export const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

export function discoverPublicWorkspaces(root = REPOSITORY_ROOT) {
  const output = runPnpm(["list", "-r", "--depth", "-1", "--json"], { cwd: root });
  return parseWorkspaceList(root, output);
}

export function scanPublicSource(root) {
  let listedFiles;
  try {
    listedFiles = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: root,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch (error) {
    throw new Error(`Unable to inventory tracked and unignored source files: ${error.message}`, {
      cause: error,
    });
  }

  const paths = listedFiles.toString("utf8").split("\0").filter(Boolean);
  let scanned = 0;
  for (const relativePath of paths) {
    const absolutePath = resolve(root, relativePath);
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (stats.isSymbolicLink())
      throw new Error(`Unexpected symlink in public source or package assets: ${relativePath}`);
    if (!stats.isFile()) continue;

    const source = readFileSync(absolutePath).toString("utf8");
    requireValue(!PUBLIC_DATA_MARKERS.test(source), `Private data marker: ${relativePath}`);
    scanned += 1;
  }
  requireValue(paths.length > 0, "Git source inventory returned no files");
  return scanned;
}

function assertNoWorkspaceSymlinks(root, packageRoot) {
  let cursor = resolve(packageRoot);
  while (cursor !== resolve(root)) {
    if (lstatSync(cursor).isSymbolicLink())
      throw new Error(`Unexpected symlink in public package path: ${cursor}`);
    cursor = dirname(cursor);
  }
  for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "work") continue;
    const path = join(packageRoot, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Unexpected symlink in public package assets: ${path}`);
    if (entry.isDirectory()) assertNoWorkspaceSymlinks(root, path);
  }
}

export function validatePublicWorkspaces(root, workspacePackages) {
  const seenIds = new Set();
  const validated = [];
  for (const { packageRoot, packageJson } of workspacePackages) {
    assertNoWorkspaceSymlinks(root, packageRoot);
    const pluginManifest = readJson(
      resolve(packageRoot, "paseo-plugin.json"),
      `${packageJson.name}/paseo-plugin.json`,
    );
    const metadata = validatePackageMetadata({
      root,
      packageRoot,
      packageJson,
      pluginManifest,
      seenIds,
    });
    validated.push({ packageRoot, packageJson, pluginManifest, ...metadata });
  }
  return validated;
}

export async function runPublicCheck({
  root = REPOSITORY_ROOT,
  pack = false,
  artifactOutputDir = undefined,
} = {}) {
  const workspacePackages = discoverPublicWorkspaces(root);
  const validatedPackages = validatePublicWorkspaces(root, workspacePackages);
  const scannedFiles = scanPublicSource(root);
  console.log(
    `Checked ${scannedFiles} tracked and unignored source files across ${validatedPackages.length} public workspaces.`,
  );

  if (pack) {
    const { createPackageArtifact } = await import("./package-artifacts.mjs");
    const createdArtifacts = [];
    try {
      for (const pkg of validatedPackages) {
        const result = await createPackageArtifact({
          packageRoot: pkg.packageRoot,
          packageJson: pkg.packageJson,
          pluginManifest: pkg.pluginManifest,
          entries: pkg.entries,
          hasRuntimeDependencies: pkg.hasRuntimeDependencies,
          artifactOutputDir,
        });
        if (result.artifactPath) createdArtifacts.push(result.artifactPath);
        console.log(
          `${pkg.packageName}: ${result.fileCount} files packed and runtime entries compiled${result.artifactPath ? ` -> ${result.artifactPath}` : ""}`,
        );
      }
    } catch (error) {
      for (const artifactPath of createdArtifacts) {
        try {
          unlinkSync(artifactPath);
        } catch {
          // Preserve the original pack failure if a temporary artifact disappeared.
        }
      }
      throw error;
    }
  }

  console.log(
    pack
      ? "Public source and package artifact checks passed."
      : "Public source and package metadata checks passed.",
  );
  return validatedPackages;
}

async function main() {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => flag !== "--pack");
  requireValue(unknown.length === 0, `Unknown check-public arguments: ${unknown.join(" ")}`);
  await runPublicCheck({ pack: flags.includes("--pack") });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
