import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkPackage } from "../check-boundaries.mjs";

function fixture(files, run) {
  const directory = mkdtempSync(join(tmpdir(), "plugin-boundaries-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: {}, devDependencies: {} }),
    );
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
    { "index.client.ts": 'import "missing-library"; import "@getpaseo/plugin/client/host";' },
    (directory) => {
      const errors = checkPackage(directory).join("\n");
      assert.match(errors, /undeclared dependency missing-library/);
      assert.match(errors, /host internals are test-only/);
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
