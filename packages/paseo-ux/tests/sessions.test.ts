import { test } from "node:test";
import assert from "node:assert/strict";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { listSessions, orderedClosed, type WorkspaceSession } from "../shared/sessions";
import { loadSessions, createSessionRestorer } from "../server/sessions";
import { fittedViewport, zoomAt, dragViewport } from "../shared/viewport";
const session = (id: string, changes: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id,
  workspaceId: "w",
  title: id,
  provider: "codex",
  status: "closed",
  createdAt: "2026-10-12T00:00:00Z",
  updatedAt: "2026-10-12T01:00:00Z",
  archivedAt: "2026-10-12T01:00:00Z",
  canRestore: true,
  ...changes,
});
function context(rows: WorkspaceSession[], after?: WorkspaceSession) {
  let reads = 0;
  return {
    paseo: {
      workspaces: { ref: () => ({ refresh: async () => ({ id: "w", name: "Test workspace" }) }) },
      agents: {
        list: async () => ({
          entries: rows.map((s) => ({
            agent: { ...s, persistence: s.canRestore ? { sessionId: s.id } : null },
          })),
          pageInfo: { nextCursor: null },
        }),
        ref: () => ({
          refresh: async () => (++reads === 1 ? null : after ? { agent: after } : null),
        }),
      },
    },
  } as unknown as PluginHandlerContext;
}
test("recent recovery orders closed records, excludes active and unrecoverable records", () => {
  const rows = [
    session("old"),
    session("new", { archivedAt: "2026-10-12T02:00:00Z" }),
    session("active", { archivedAt: null, status: "running" }),
    session("missing", { canRestore: false, archivedAt: "2026-10-12T03:00:00Z" }),
    session("closed-runtime", { archivedAt: null, updatedAt: "2026-10-12T01:30:00Z" }),
  ];
  assert.deepEqual(
    orderedClosed(rows).map((s) => s.id),
    ["new", "closed-runtime", "old"],
  );
  assert.equal(orderedClosed(rows, false).length, 4);
});
test("history is scoped to exact workspace even when another workspace shares its project", async () => {
  const result = await loadSessions(
    { workspaceId: "w" },
    context([session("own"), session("other", { workspaceId: "w-other" })]),
  );
  assert.deepEqual(
    result.sessions.map((s) => s.id),
    ["own"],
  );
  assert.equal(listSessions.output.parse(result).workspaceName, "Test workspace");
  await assert.rejects(
    () =>
      createSessionRestorer(async () => {
        throw Error("must not reload");
      })(
        { workspaceId: "w", agentId: "other" },
        context([session("other", { workspaceId: "w-other" })]),
      ),
    /不属于/,
  );
});
test("opening live sessions never reloads; recovery keeps ID and requires state readback", async () => {
  let calls = 0;
  const restore = createSessionRestorer(async (id) => {
    calls++;
    return { agentId: id };
  });
  const live = session("live", { status: "running", archivedAt: null });
  assert.equal(
    (await restore({ workspaceId: "w", agentId: "live" }, context([live]))).restored,
    false,
  );
  assert.equal(calls, 0);
  const old = session("old");
  assert.deepEqual(
    await restore(
      { workspaceId: "w" },
      context([old], { ...old, status: "idle", archivedAt: null }),
    ),
    { agentId: "old", workspaceId: "w", restored: true },
  );
  await assert.rejects(
    () => restore({ workspaceId: "w", agentId: "old" }, context([old], old)),
    /尚未确认/,
  );
  await assert.rejects(
    () =>
      createSessionRestorer(async () => ({ agentId: "different" }))(
        { workspaceId: "w" },
        context([old]),
      ),
    /预期/,
  );
});
test("concurrent explicit recovery does not confuse different selected sessions", async () => {
  const a = session("a"),
    b = session("b");
  const restore = createSessionRestorer(async (id) => ({ agentId: id }));
  const results = await Promise.all([
    restore(
      { workspaceId: "w", agentId: "a" },
      context([a, b], { ...a, status: "idle", archivedAt: null }),
    ),
    restore(
      { workspaceId: "w", agentId: "b" },
      context([a, b], { ...b, status: "idle", archivedAt: null }),
    ),
  ]);
  assert.deepEqual(
    results.map((r) => r.agentId),
    ["a", "b"],
  );
});
test("zoom preserves the point under the cursor, clamps scale and accumulates drag", () => {
  assert.deepEqual(zoomAt(fittedViewport, 2, { x: 100, y: 50 }), { zoom: 2, x: -100, y: -50 });
  assert.deepEqual(zoomAt({ zoom: 2, x: -100, y: -50 }, 0.5, { x: 100, y: 50 }), fittedViewport);
  assert.equal(zoomAt(fittedViewport, 100, { x: 0, y: 0 }).zoom, 8);
  assert.equal(zoomAt(fittedViewport, 0.01, { x: 0, y: 0 }).zoom, 0.25);
  assert.deepEqual(dragViewport({ zoom: 2, x: 5, y: -10 }, { x: 20, y: 30 }), {
    zoom: 2,
    x: 25,
    y: 20,
  });
});

test("latest and explicit requests for the same closed session share one recovery", async () => {
  const old = session("old");
  let calls = 0;
  const restore = createSessionRestorer(async (id) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { agentId: id };
  });
  const ctx = context([old], { ...old, status: "idle", archivedAt: null });
  const results = await Promise.all([
    restore({ workspaceId: "w" }, ctx),
    restore({ workspaceId: "w", agentId: "old" }, ctx),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
});

test("dialog requests remain scoped and stale closes do not dismiss a newer picker", async () => {
  const { createSessionDialogs } = await import("../client/session-dialogs");
  const dialogs = createSessionDialogs();
  let updates = 0;
  const release = dialogs.subscribe("w", () => updates++);
  dialogs.open("w");
  const first = dialogs.get("w")!;
  assert.equal(first.latest, false);
  assert.strictEqual(dialogs.get("w"), first);
  assert.equal(dialogs.get("other"), null);
  dialogs.open("w", true);
  const next = dialogs.get("w")!;
  dialogs.close("w", first.id);
  assert.strictEqual(dialogs.get("w"), next);
  assert.equal(next.latest, true);
  dialogs.close("w", next.id);
  assert.equal(dialogs.get("w"), null);
  assert.equal(updates, 3);
  release();
  dialogs.dispose();
});
