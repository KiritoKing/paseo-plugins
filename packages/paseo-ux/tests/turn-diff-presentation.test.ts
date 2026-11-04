import assert from "node:assert/strict";
import test from "node:test";
import { createTurnSelections } from "../client/turn-diff-selection";
import { diffRows } from "../shared/turn-diff-presentation";

test("saved diff line numbers follow each hunk, including code starting with diff header markers", () => {
  const patch =
    "diff --git a/code b/code\n--- a/code\n+++ b/code\n@@ -8,2 +9,2 @@\n---old\n+++new\n same\n@@ -40,0 +42 @@\n+last\n\\ No newline at end of file\n";
  const { rows, truncated } = diffRows(patch);
  assert.equal(truncated, false);
  assert.deepEqual(rows.slice(4, 7), [
    { kind: "removed", text: "---old", before: 8, after: null },
    { kind: "added", text: "+++new", before: null, after: 9 },
    { kind: "context", text: " same", before: 9, after: 10 },
  ]);
  assert.deepEqual(rows[8], { kind: "added", text: "+last", before: null, after: 42 });
  assert.equal(rows[9]?.kind, "header");
});

test("the UI marks omitted rows and never renders more than 2,000", () => {
  const { rows, truncated } = diffRows("+line\n".repeat(2_001));
  assert.equal(rows.length, 2_000);
  assert.equal(truncated, true);
  assert.equal(diffRows("+line\n".repeat(2_000)).truncated, false);
});

test("card navigation stays scoped to its agent and releases subscriptions", () => {
  const selection = createTurnSelections();
  const events: string[] = [];
  const stopA = selection.subscribe("a", () => events.push("a"));
  const stopB = selection.subscribe("b", () => events.push("b"));
  selection.select("a", "old-turn", "file.txt");
  assert.deepEqual(events, ["a"]);
  assert.equal(selection.get("a").path, "file.txt");
  assert.equal(selection.get("b").turnId, null);
  selection.clear();
  selection.select("a", "reconnected-turn");
  assert.deepEqual(events, ["a", "a", "b", "a"]);
  stopA();
  selection.select("a", null);
  assert.equal(selection.get("a").path, null);
  assert.deepEqual(events, ["a", "a", "b", "a"]);
  stopB();
  selection.dispose();
  assert.equal(selection.get("a").turnId, null);
  assert.equal(selection.get("a"), selection.get("a"));
});
