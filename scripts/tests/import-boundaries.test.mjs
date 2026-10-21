import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkPackage } from "../check-boundaries.mjs";

function fixture(
  files,
  run,
  packageJson = { name: "fixture", dependencies: {}, devDependencies: {} },
) {
  const directory = mkdtempSync(join(tmpdir(), "plugin-boundaries-"));
  try {
    writeFileSync(join(directory, "package.json"), JSON.stringify(packageJson));
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(join(directory, path, ".."), { recursive: true });
      writeFileSync(join(directory, path), source);
    }
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("rejects Node access reached through a shared re-export", () => {
  fixture(
    {
      "index.client.ts": 'export * from "./shared/bridge";',
      "shared/bridge.ts": 'export { readFile } from "node:fs";',
    },
    (directory) => {
      assert.match(checkPackage(directory).join("\n"), /Node modules belong in server/);
    },
  );
});

test("rejects type-only crossing of client and server layers", () => {
  fixture(
    {
      "client/panel.ts": 'import type { Secret } from "../server/secret";',
      "server/secret.ts": "export type Secret = string;",
    },
    (directory) => {
      assert.match(checkPackage(directory).join("\n"), /client cannot import server/);
    },
  );
});

test("rejects undeclared production dependencies and host internals", () => {
  fixture(
    {
      "index.client.ts":
        'import "missing-library"; import "@getpaseo/plugin/client/host"; import type { PluginClientContext } from "@getpaseo/client";',
    },
    (directory) => {
      const errors = checkPackage(directory).join("\n");
      assert.match(errors, /undeclared dependency missing-library/);
      assert.match(errors, /host internals are test-only/);
      assert.match(errors, /type dependency must be in dependencies.*@getpaseo\/client/);
    },
  );
});

test("requires a production type dependency despite a hoisted development copy", () => {
  const files = {
    "index.server.ts":
      'import type { RootContent } from "hast";\nexport type Node = RootContent;\n',
  };
  const hoistedTypes = (directory) => {
    const typesDirectory = join(directory, "node_modules", "@types", "hast");
    mkdirSync(typesDirectory, { recursive: true });
    writeFileSync(join(typesDirectory, "package.json"), JSON.stringify({ name: "@types/hast" }));
    writeFileSync(join(typesDirectory, "index.d.ts"), "export type RootContent = unknown;\n");
    const refractorDirectory = join(directory, "node_modules", "refractor");
    mkdirSync(refractorDirectory, { recursive: true });
    writeFileSync(
      join(refractorDirectory, "package.json"),
      JSON.stringify({ name: "refractor", dependencies: { "@types/hast": "3.0.5" } }),
    );
    assert.ok(existsSync(join(typesDirectory, "index.d.ts")));
  };

  fixture(
    files,
    (directory) => {
      hoistedTypes(directory);
      assert.match(
        checkPackage(directory).join("\n"),
        /type dependency must be in dependencies \(hast or @types\/hast\)/,
      );
    },
    {
      name: "fixture",
      dependencies: { refractor: "5.0.0" },
      devDependencies: { "@types/hast": "3.0.5" },
    },
  );

  fixture(
    files,
    (directory) => {
      hoistedTypes(directory);
      assert.deepEqual(checkPackage(directory), []);
    },
    {
      name: "fixture",
      dependencies: { "@types/hast": "3.0.5", refractor: "5.0.0" },
      devDependencies: {},
    },
  );
});

test("permits server Node APIs and a browser-only adapter", () => {
  fixture(
    {
      "index.server.ts": 'import { readFile } from "node:fs";',
      "client/web.ts": "const document = {}; export { document };",
    },
    (directory) => {
      assert.deepEqual(checkPackage(directory), []);
    },
  );
});
