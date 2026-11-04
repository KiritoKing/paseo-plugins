import type { TurnCard, TurnSummary } from "../../shared/turn-diff";

const base = {
  agentId: "sample",
  startedAt: "2026-01-01T10:00:00Z",
  endedAt: "2026-01-01T10:01:00Z",
  outcome: "completed" as const,
  warnings: [],
};
const file = {
  status: "modified" as const,
  added: 1,
  removed: 1,
  binary: false,
  diffAvailable: true,
};
export const textTurn: TurnSummary = {
  ...base,
  id: "text-turn",
  totalFiles: 5,
  files: [
    { ...file, path: "src/example.ts" },
    { ...file, path: "src/new-name.ts", oldPath: "src/old-name.ts", status: "renamed" },
    { ...file, path: "sample.bin", binary: true },
    { ...file, path: "large.blob", diffAvailable: false },
    { ...file, path: "long.ts" },
  ],
  commits: [{ sha: "a".repeat(40), subject: "Save turn changes" }],
  warnings: ["Concurrent turns shared this directory. Changes may include other agents."],
};
const imageTurn: TurnSummary = {
  ...base,
  id: "image-turn",
  endedAt: "2026-01-01T10:02:00Z",
  totalFiles: 1,
  files: [{ ...file, path: "sample.png", binary: true }],
  commits: [],
};
export const turnCard: TurnCard = {
  kind: "turn-changes",
  version: 1,
  turnId: textTurn.id,
  totalFiles: textTurn.totalFiles,
  totalCommits: 1,
  files: textTurn.files,
  commits: textTurn.commits,
  warnings: textTurn.warnings,
};
export const turnDiffFixture = {
  failList: false,
  failDiff: false,
  delayDiff: false,
  calls: [] as Array<{ method: string; input: Record<string, string> }>,
  reset() {
    this.failList = false;
    this.failDiff = false;
    this.delayDiff = false;
    this.calls.length = 0;
  },
};

export async function turnRpc(
  name: string,
  input: Record<string, string>,
  before: string,
  after: string,
) {
  turnDiffFixture.calls.push({ method: name, input });
  if (name === "turn_changes.list") {
    if (turnDiffFixture.failList) {
      turnDiffFixture.failList = false;
      throw new Error("Synthetic turn history error. Retry.");
    }
    if (input.agentId !== "sample") return { turns: [], nextCursor: null };
    if (input.turnId)
      return {
        turns: [imageTurn, textTurn].filter((turn) => turn.id === input.turnId),
        nextCursor: null,
      };
    return input.cursor
      ? { turns: [textTurn], nextCursor: null }
      : { turns: [imageTurn], nextCursor: "older" };
  }
  if (turnDiffFixture.failDiff) {
    turnDiffFixture.failDiff = false;
    throw new Error("Synthetic saved diff error. Retry.");
  }
  if (turnDiffFixture.delayDiff) {
    turnDiffFixture.delayDiff = false;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  const result = { patch: "", truncated: false, beforeUri: null, afterUri: null };
  if (input.path === "sample.png")
    return { ...result, kind: "image", beforeUri: before, afterUri: after };
  if (input.path === "sample.bin") return { ...result, kind: "binary" };
  if (input.path === "large.blob")
    return {
      ...result,
      kind: "unavailable",
      notice: "Untracked file exceeded 1 MiB and was not saved.",
    };
  if (input.path === "long.ts")
    return {
      ...result,
      kind: "text",
      truncated: true,
      patch: "@@ -0,0 +1,2100 @@\n" + "+preview row\n".repeat(2_100),
    };
  return {
    ...result,
    kind: "text",
    patch:
      "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -8,2 +8,2 @@\n-const result = false;\n+const result = true;\n export { result };\n",
  };
}
