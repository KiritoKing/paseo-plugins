import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import typescript from "typescript";
import { REPOSITORY_ROOT, runPublicCheck } from "./check-public.mjs";
import {
  assertArchiveContents,
  assertPackageLocalImport,
  assertPublishedManifest,
  assertShrinkwrapComplete,
  isMainModule,
  isPathInside,
  readJson,
  requireValue,
  runPnpm,
} from "./lib/package-utils.mjs";

const HOST_EXTERNALS = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/*",
  "@getpaseo/client",
  "@getpaseo/client/*",
  "react",
  "react/*",
  "react-native",
  "react-native/*",
  "react-dom",
  "react-dom/*",
  "@tanstack/react-query",
  "@tanstack/react-query/*",
  "zod",
  "zod/*",
];
const TYPE_HOST_EXTERNALS = HOST_EXTERNALS.filter(
  (specifier) => specifier !== "@getpaseo/client" && specifier !== "@getpaseo/client/*",
);
const NODE_BUILTIN_NAMES = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

const REPOSITORY_ROOT_REAL = realpathSync(REPOSITORY_ROOT);

function run(command, args, { cwd, env = process.env } = {}) {
  try {
    return execFileSync(command, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((part) => String(part).trim())
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed${error.status === undefined ? "" : ` (exit ${error.status})`}${details ? `:\n${details}` : `: ${error.message}`}`,
      { cause: error },
    );
  }
}

function unpackArchive(archivePath, destination, packageName, entries) {
  const paths = run("tar", ["-tzf", archivePath]).split("\n").filter(Boolean);
  const normalizedPaths = assertArchiveContents(paths, entries, packageName);
  mkdirSync(destination, { recursive: true });
  run("tar", ["-xzf", archivePath, "-C", destination]);
  const packageRoot = realpathSync(resolve(destination, "package"));
  requireValue(
    isPathInside(realpathSync(destination), packageRoot) && existsSync(packageRoot),
    `Unable to unpack ${packageName}`,
  );
  return { packageRoot, paths: normalizedPaths };
}

function createTarball(packageRoot, destination) {
  mkdirSync(destination, { recursive: true });
  runPnpm(["pack", "--json", "--config.ignore-scripts=true", "--pack-destination", destination], {
    cwd: packageRoot,
  });
  const archives = readdirSync(destination).filter((file) => file.endsWith(".tgz"));
  requireValue(
    archives.length === 1,
    `Expected exactly one pnpm pack artifact in ${destination}, found ${archives.length}`,
  );
  return resolve(destination, archives[0]);
}

function ensureOutputDirectory(outputDirectory) {
  const outputPath = resolve(REPOSITORY_ROOT_REAL, outputDirectory);
  requireValue(
    isPathInside(REPOSITORY_ROOT_REAL, outputPath),
    `Artifact output must be inside the repository: ${outputDirectory}`,
  );
  const relativeOutputPath = relative(REPOSITORY_ROOT_REAL, outputPath)
    .split(/[\\/]/)
    .filter(Boolean);
  let cursor = REPOSITORY_ROOT_REAL;
  for (const segment of relativeOutputPath) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) continue;
    requireValue(
      !lstatSync(cursor).isSymbolicLink(),
      `Artifact output cannot pass through a symlink: ${cursor}`,
    );
    const realPath = realpathSync(cursor);
    requireValue(
      isPathInside(REPOSITORY_ROOT_REAL, realPath),
      `Artifact output resolves outside the repository: ${outputDirectory}`,
    );
  }
  mkdirSync(outputPath, { recursive: true });
  const actualPath = realpathSync(outputPath);
  requireValue(
    isPathInside(REPOSITORY_ROOT_REAL, actualPath),
    `Artifact output resolves outside the repository: ${outputDirectory}`,
  );
  return actualPath;
}

async function compileRuntimeEntries(packageRoot, entries, packageName, temporaryRoot) {
  const { build } = await import("esbuild");
  const nodeBuiltins = [
    ...new Set(builtinModules.map((name) => name.replace(/^node:/, ""))),
  ].flatMap((name) => [name, `node:${name}`]);

  for (const entry of entries) {
    const platform = entry.includes(".client.") ? "browser" : "node";
    const external = platform === "node" ? [...HOST_EXTERNALS, ...nodeBuiltins] : HOST_EXTERNALS;
    try {
      const result = await build({
        absWorkingDir: packageRoot,
        entryPoints: [resolve(packageRoot, entry)],
        bundle: true,
        write: false,
        platform,
        format: "esm",
        target: platform === "node" ? "node22" : "es2022",
        jsx: "automatic",
        external,
        outdir: resolve(temporaryRoot, "bundles", entry.replace(/[^a-zA-Z0-9.-]/g, "_")),
        logLevel: "silent",
        plugins: [
          {
            name: "packed-package-boundary",
            setup(buildContext) {
              buildContext.onResolve({ filter: /^(?:\.\.?\/|\/)/ }, (args) => {
                const candidate = resolve(args.resolveDir, args.path);
                assertPackageLocalImport(packageRoot, candidate, args.path);
                return undefined;
              });
            },
          },
        ],
      });
      requireValue(
        result.outputFiles.length > 0,
        `esbuild produced no bundle for ${entry}: ${packageName}`,
      );
    } catch (error) {
      throw new Error(
        `Unable to compile packed runtime entry ${packageName}/${entry}: ${error.message}`,
        { cause: error },
      );
    }
  }
}

function getDiagnosticModuleSpecifier(ts, diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  return message.match(/(?:module|type definition file for) ['"]([^'"]+)['"]/i)?.[1];
}

function isHostTypeExternal(specifier) {
  if (!specifier) return false;
  if (specifier === "node") return true;
  if (NODE_BUILTIN_NAMES.has(specifier.replace(/^node:/, ""))) return true;
  return TYPE_HOST_EXTERNALS.some((external) => {
    if (external.endsWith("/*")) return specifier.startsWith(external.slice(0, -1));
    return specifier === external;
  });
}

export function assertRuntimeTypeImportsResolve(packageRoot, entries, packageName) {
  const ts = typescript;
  const program = ts.createProgram({
    rootNames: entries.map((entry) => resolve(packageRoot, entry)),
    options: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: false,
      target: ts.ScriptTarget.ES2022,
      types: [],
    },
  });
  const unresolved = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
    if (![2307, 2688, 7016].includes(diagnostic.code)) return false;
    return !isHostTypeExternal(getDiagnosticModuleSpecifier(ts, diagnostic));
  });
  if (unresolved.length === 0) return;

  const details = unresolved.map((diagnostic) => {
    const source = diagnostic.file;
    const position =
      source && diagnostic.start !== undefined
        ? source.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined;
    const location = source
      ? `${relative(packageRoot, source.fileName)}${position ? `:${position.line + 1}:${position.character + 1}` : ""}`
      : packageName;
    return `${location} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  });
  throw new Error(
    `Unable to resolve non-host runtime type imports for ${packageName}:\n${details.map((detail) => `  ${detail}`).join("\n")}`,
  );
}

function assertRuntimeLockFromStage(packageRoot, packageJson, packageName, archiveFiles) {
  const hasRuntimeDependencies = Object.keys(packageJson.dependencies ?? {}).length > 0;
  if (!hasRuntimeDependencies) return false;
  requireValue(
    archiveFiles.includes("npm-shrinkwrap.json"),
    `Packed runtime dependencies are missing npm-shrinkwrap.json: ${packageName}`,
  );
  const shrinkwrap = readJson(
    resolve(packageRoot, "npm-shrinkwrap.json"),
    `${packageName}/npm-shrinkwrap.json`,
  );
  assertShrinkwrapComplete(packageJson, shrinkwrap);
  return true;
}

export async function createPackageArtifact({
  packageRoot,
  packageJson,
  pluginManifest,
  entries,
  hasRuntimeDependencies,
  artifactOutputDir,
}) {
  const packageName = packageJson.name;
  requireValue(entries.length > 0, `Missing source runtime entry: ${packageName}`);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "paseo-package-artifact-"));
  try {
    const sourceArchive = createTarball(packageRoot, resolve(temporaryRoot, "source-tarball"));
    const extractedSource = unpackArchive(
      sourceArchive,
      resolve(temporaryRoot, "source"),
      packageName,
      entries,
    );
    const unpackedPackageJson = readJson(
      resolve(extractedSource.packageRoot, "package.json"),
      `${packageName}/package.json`,
    );
    requireValue(
      unpackedPackageJson.name === packageName,
      `Packed package name changed during source pack: ${packageName}`,
    );
    const unpackedPluginManifest = readJson(
      resolve(extractedSource.packageRoot, "paseo-plugin.json"),
      `${packageName}/paseo-plugin.json`,
    );
    requireValue(
      unpackedPluginManifest.id === pluginManifest.id,
      `Packed plugin id changed during source pack: ${packageName}`,
    );
    const sourceArchiveFiles = extractedSource.paths;
    requireValue(
      !hasRuntimeDependencies || Object.keys(unpackedPackageJson.dependencies ?? {}).length > 0,
      `Runtime dependencies disappeared from packed package.json: ${packageName}`,
    );

    const stagedManifestPath = resolve(extractedSource.packageRoot, "paseo-plugin.json");
    const stagedManifest = readJson(stagedManifestPath, `${packageName}/paseo-plugin.json`);
    delete stagedManifest.build;
    writeFileSync(stagedManifestPath, `${JSON.stringify(stagedManifest, null, 2)}\n`);

    const needsProductionInstall = assertRuntimeLockFromStage(
      extractedSource.packageRoot,
      unpackedPackageJson,
      packageName,
      sourceArchiveFiles,
    );
    requireValue(
      needsProductionInstall === hasRuntimeDependencies,
      `Runtime dependency metadata changed for ${packageName}`,
    );

    if (needsProductionInstall) {
      const npmCache = resolve(temporaryRoot, "npm-cache");
      mkdirSync(npmCache, { recursive: true });
      const environment = {
        ...process.env,
        npm_config_cache: npmCache,
        NPM_CONFIG_CACHE: npmCache,
        npm_config_registry: "https://registry.npmjs.org/",
        NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
      };
      run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
        cwd: extractedSource.packageRoot,
        env: environment,
      });
    }

    assertRuntimeTypeImportsResolve(extractedSource.packageRoot, entries, packageName);
    await compileRuntimeEntries(extractedSource.packageRoot, entries, packageName, temporaryRoot);

    const finalArchive = createTarball(
      extractedSource.packageRoot,
      resolve(temporaryRoot, "final-tarball"),
    );
    const extractedFinal = unpackArchive(
      finalArchive,
      resolve(temporaryRoot, "final"),
      packageName,
      entries,
    );
    const finalPackageJson = readJson(
      resolve(extractedFinal.packageRoot, "package.json"),
      `${packageName}/package.json`,
    );
    requireValue(
      finalPackageJson.name === packageName && finalPackageJson.version === packageJson.version,
      `Final packed package identity changed: ${packageName}`,
    );
    const finalPluginManifest = readJson(
      resolve(extractedFinal.packageRoot, "paseo-plugin.json"),
      `${packageName}/paseo-plugin.json`,
    );
    assertPublishedManifest(finalPluginManifest, packageName);
    assertRuntimeLockFromStage(
      extractedFinal.packageRoot,
      finalPackageJson,
      packageName,
      extractedFinal.paths,
    );

    let artifactPath;
    if (artifactOutputDir !== undefined) {
      const outputDirectory = ensureOutputDirectory(artifactOutputDir);
      const fileName = basename(finalArchive);
      artifactPath = resolve(outputDirectory, fileName);
      requireValue(
        !existsSync(artifactPath),
        `Refusing to overwrite existing package artifact: ${artifactPath}`,
      );
      copyFileSync(finalArchive, artifactPath);
    }

    return { fileCount: extractedFinal.paths.length, artifactPath };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function parseOutputArgument(args) {
  let outputDirectory;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      requireValue(
        index + 1 < args.length && !args[index + 1].startsWith("--"),
        "--out requires a directory",
      );
      requireValue(outputDirectory === undefined, "Only one --out directory is allowed");
      outputDirectory = args[index + 1];
      requireValue(outputDirectory.length > 0, "--out requires a directory");
      index += 1;
    } else if (arg.startsWith("--out=")) {
      requireValue(outputDirectory === undefined, "Only one --out directory is allowed");
      outputDirectory = arg.slice("--out=".length);
      requireValue(outputDirectory.length > 0, "--out requires a directory");
    } else {
      throw new Error(`Unknown package-artifacts argument: ${arg}`);
    }
  }
  return outputDirectory;
}

async function main() {
  const outputDirectory = parseOutputArgument(process.argv.slice(2));
  if (outputDirectory === undefined) {
    console.log("Usage: node scripts/package-artifacts.mjs --out <directory>");
    return;
  }
  await runPublicCheck({ pack: true, artifactOutputDir: outputDirectory });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
