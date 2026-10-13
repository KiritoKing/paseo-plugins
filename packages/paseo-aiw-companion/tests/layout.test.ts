import assert from "node:assert/strict";
import test from "node:test";
import { saveWorkspaceLayout } from "../client/layout-store";
import { layoutValuesSchema, splitSize, stackLayout, workspaceLayoutSchema } from "../shared/layout";

test("saved sizes survive temporary constraints and layout directions adapt without overflow", () => {
  const saved = workspaceLayoutSchema.parse({ direction: "row", treeWidth: 520, treeHeight: 380 });
  assert.equal(stackLayout(saved.direction, true, 680), false);
  assert.equal(stackLayout(saved.direction, false, 400), true);
  assert.equal(stackLayout("auto", false, 680), true);
  assert.equal(stackLayout("column", false, 1600), true);
  const temporary = splitSize(680, saved.treeWidth, false);
  assert.ok(temporary + 12 + 240 <= 680);
  assert.equal(splitSize(1600, saved.treeWidth, false), 520);
  assert.equal(splitSize(1200, saved.treeHeight, true), 380);
  for (const extent of [0, 20, 100, 360, 800, 2400]) {
    for (const stacked of [true, false]) for (const requested of [-1000, 304, 9999]) {
      const actual = splitSize(extent, requested, stacked);
      assert.ok(actual >= 0 && actual <= Math.max(0, extent - 12));
    }
  }
  assert.equal(layoutValuesSchema.parse({}).workspaces["old-workspace"], undefined);
  assert.equal(workspaceLayoutSchema.safeParse({ treeWidth: Infinity }).success, false);
});

test("layout save rereads a conflict and preserves another workspace's latest layout", async () => {
  const own = workspaceLayoutSchema.parse({ treeWidth: 430 });
  const other = workspaceLayoutSchema.parse({ treeHeight: 620 });
  let reads = 0; let writes = 0;
  await saveWorkspaceLayout("own", own, async () => ({ status: "ready", revision: `r${++reads}`, values: layoutValuesSchema.parse(reads === 1 ? { workspaces: {} } : { workspaces: { other } }) }), async input => {
    writes++;
    if (writes === 1) return { status: "conflict", error: "another client saved" };
    assert.equal(input.revision, "r2");
    assert.deepEqual(input.values.workspaces, { own, other });
    return { status: "saved", revision: "r3", values: input.values };
  });
  assert.equal(writes, 2);
});

test("uncertain transport writes are surfaced without blind retry", async () => {
  let writes = 0;
  await assert.rejects(saveWorkspaceLayout("own", workspaceLayoutSchema.parse({}), async () => ({ status: "ready", revision: "r1", values: { workspaces: {} } }), async () => {
    writes++; throw new Error("connection lost after send");
  }), /connection lost/);
  assert.equal(writes, 1);
});
