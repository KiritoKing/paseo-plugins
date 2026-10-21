import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { releaseMetadata } from "../release-metadata.mjs";

const { version } = JSON.parse(
  readFileSync(new URL("../../packages/paseo-ux/package.json", import.meta.url), "utf8"),
);

test("an unapproved branch can prepare artifacts but cannot publish", () => {
  const input = { directory: "paseo-ux", version, ref: "refs/heads/change" };
  assert.match(releaseMetadata(input).artifact, /\.tgz$/);
  assert.throws(() => releaseMetadata({ ...input, publish: true }), /main branch/);
});

test("rejects a mismatched version and path traversal before release preparation", () => {
  assert.throws(
    () => releaseMetadata({ directory: "paseo-ux", version: "9.0.0" }),
    /match the package manifest/,
  );
  assert.throws(() => releaseMetadata({ directory: "../outside", version }), /Invalid package/);
});
