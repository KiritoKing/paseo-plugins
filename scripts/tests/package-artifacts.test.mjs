import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertArchiveContents,
  assertPackageLocalImport,
  assertPublishedManifest,
  assertRuntimeEntries,
  assertShrinkwrapComplete,
  parseWorkspaceList,
} from "../lib/package-utils.mjs";
import { createPackageArtifact } from "../package-artifacts.mjs";

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "paseo-package-utils-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("workspace discovery includes a newly added public package from pnpm JSON", (t) => {
  const root = temporaryDirectory(t);
  const newPackage = resolve(root, "packages/new-plugin");
  mkdirSync(newPackage, { recursive: true });
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({ name: "workspace-root", private: true }),
  );
  writeFileSync(
    resolve(newPackage, "package.json"),
    JSON.stringify({ name: "@chlrc/new-plugin", version: "1.0.0" }),
  );

  const discovered = parseWorkspaceList(
    root,
    JSON.stringify([
      { name: "workspace-root", path: root, private: true },
      { name: "@chlrc/new-plugin", path: newPackage },
    ]),
  );

  assert.deepEqual(
    discovered.map(({ packageJson }) => packageJson.name),
    ["@chlrc/new-plugin"],
  );
});

test("pack inspection rejects an archive that omits a runtime entry", () => {
  assert.throws(
    () =>
      assertArchiveContents(
        [
          "package/package.json",
          "package/paseo-plugin.json",
          "package/OVERVIEW.md",
          "package/LICENSE",
          "package/README.md",
        ],
        ["index.client.ts"],
        "@chlrc/missing-entry",
      ),
    /Missing packed runtime entry/,
  );
  assert.throws(() => assertRuntimeEntries([], "@chlrc/no-entry"), /Missing source runtime entry/);
});

test("package compilation rejects local imports that escape the unpacked package", (t) => {
  const packageRoot = temporaryDirectory(t);
  assert.throws(
    () =>
      assertPackageLocalImport(
        packageRoot,
        resolve(packageRoot, "..", "other-workspace", "index.ts"),
        "../../other-workspace/index.ts",
      ),
    /Local import escapes packed package/,
  );
});

test("runtime dependencies without a complete npm shrinkwrap are rejected", () => {
  assert.throws(
    () =>
      assertShrinkwrapComplete(
        { name: "@chlrc/with-runtime-deps", dependencies: { yaml: "^2.9.1" } },
        undefined,
      ),
    /require npm-shrinkwrap.json/,
  );
  assert.throws(
    () =>
      assertShrinkwrapComplete(
        { name: "@chlrc/with-runtime-deps", version: "1.0.0", dependencies: { yaml: "^2.9.1" } },
        {
          lockfileVersion: 3,
          packages: {
            "": {
              name: "@chlrc/with-runtime-deps",
              version: "1.0.0",
              dependencies: { yaml: "^2.9.1" },
            },
          },
        },
      ),
    /missing runtime dependency yaml/,
  );
});

test("published artifacts reject the Git-only plugin build command", () => {
  assert.throws(
    () =>
      assertPublishedManifest(
        { id: "aiw-companion", build: [["pnpm", "install", "--frozen-lockfile"]] },
        "@chlrc/paseo-aiw-companion",
      ),
    /omit the Git-only build command/,
  );
});

test("consumer locks reject inherited registry mirrors", () => {
  const pkg = { name: "@chlrc/fixture", version: "1.0.0", dependencies: { yaml: "2.9.1" } };
  assert.throws(
    () =>
      assertShrinkwrapComplete(pkg, {
        lockfileVersion: 3,
        packages: {
          "": pkg,
          "node_modules/yaml": {
            version: "2.9.1",
            resolved: "https://mirror.example.invalid/yaml.tgz",
            integrity: "sha512-fixture",
          },
        },
      }),
    /public npm sources/,
  );
});

test("artifact preparation never executes package lifecycle scripts", async (t) => {
  const directory = temporaryDirectory(t);
  const pkg = {
    name: "@chlrc/paseo-fixture",
    version: "1.0.0",
    files: [
      "index.server.ts",
      "shared/",
      "paseo-plugin.json",
      "README.md",
      "OVERVIEW.md",
      "LICENSE",
    ],
    scripts: { prepack: "node -e \"require('node:fs').writeFileSync('hook-ran', 'unexpected')\"" },
  };
  const manifest = { id: "fixture" };
  writeFileSync(join(directory, "package.json"), JSON.stringify(pkg));
  writeFileSync(join(directory, "paseo-plugin.json"), JSON.stringify(manifest));
  mkdirSync(join(directory, "shared"));
  writeFileSync(join(directory, "shared/value.ts"), "export const fixtureValue = 1;\n");
  writeFileSync(
    join(directory, "index.server.ts"),
    'import { fixtureValue } from "./shared/value"; export default function contribute() { return fixtureValue; }\n',
  );
  for (const name of ["README.md", "OVERVIEW.md", "LICENSE"])
    writeFileSync(join(directory, name), "Fixture\n");
  const result = await createPackageArtifact({
    packageRoot: directory,
    packageJson: pkg,
    pluginManifest: manifest,
    entries: ["index.server.ts"],
    hasRuntimeDependencies: false,
  });
  assert.ok(result.fileCount >= 6);
  assert.equal(existsSync(join(directory, "hook-ran")), false);
});
