import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasAiwConfig } from "../server/availability";

test("AIW button eligibility needs only a local manifest, with no CLI or materialization", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aiw-header-"));
  const root = join(fixture, "root");
  mkdirSync(root);
  try {
    assert.equal(hasAiwConfig(root), false);
    writeFileSync(join(root, "aiw.yaml"), "repos: []\n");
    assert.equal(hasAiwConfig(root), true);
    writeFileSync(join(root, "aiw.yaml"), "invalid YAML [");
    assert.equal(
      hasAiwConfig(root),
      true,
      "a malformed manifest should still expose the panel error path",
    );
    rmSync(join(root, "aiw.yaml"));
    mkdirSync(join(root, "aiw.yaml"));
    assert.equal(hasAiwConfig(root), false);
    rmSync(join(root, "aiw.yaml"), { recursive: true });
    writeFileSync(join(root, "manifest.yaml"), "repos: []");
    symlinkSync("manifest.yaml", join(root, "aiw.yaml"));
    assert.equal(hasAiwConfig(root), true);
    rmSync(join(root, "aiw.yaml"));
    writeFileSync(join(fixture, "outside.yaml"), "repos: []");
    symlinkSync("../outside.yaml", join(root, "aiw.yaml"));
    assert.equal(hasAiwConfig(root), false, "do not follow a manifest outside the workspace");
    assert.equal(hasAiwConfig(join(fixture, "missing")), false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
