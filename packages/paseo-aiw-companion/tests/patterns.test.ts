import assert from "node:assert/strict";
import test from "node:test";
import { matchesGlob, matchesPatterns } from "../shared/patterns";
test("path patterns match nested paths and exclude either rename endpoint", () => {
  assert.equal(matchesGlob("**/changes/**", "changes/x/plan.md"), true);
  assert.equal(matchesGlob("**/changes/**", "docs/changes/x/plan.md"), true);
  assert.equal(matchesGlob("src/*.ts", "src/a/b.ts"), false);
  assert.equal(matchesGlob("src/?.ts", "src/a.ts"), true);
  assert.equal(matchesPatterns("src/new.ts", "changes/old.md", ["**/changes/**"], []), true);
  assert.equal(matchesPatterns("src/new.ts", "changes/old.md", ["**"], ["changes/**"]), false);
  assert.equal(matchesPatterns("notes.md", undefined, [], []), false);
});
