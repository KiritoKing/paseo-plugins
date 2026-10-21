import assert from "node:assert/strict";
import { test } from "node:test";
import contribute from "../index.server";
import { catalogs } from "../server/media";
import {
  featureValuesSchema,
  listMedia,
  readFeatures,
  readMedia,
  resolveMedia,
} from "../shared/contracts";
import { defaultAppearance } from "../shared/conversation/appearance";
import { listSessions, restoreSession } from "../shared/sessions";

function harness(values: Record<string, unknown> = {}, status = "ready") {
  const handlers = new Map<unknown, (input: never, context: never) => Promise<unknown>>();
  const state = { status, values: featureValuesSchema.parse(values) };
  let reads = 0;
  const context = {
    paseo: {
      agents: {
        ref() {
          reads++;
          throw new Error("SDK read reached");
        },
      },
    },
  };
  const cleanup = contribute({
    registerSettings: (definition: { id: string }) => ({
      read: async () =>
        definition.id === "appearance" ? { status: "ready", values: defaultAppearance } : state,
    }),
    handle: (rpc: unknown, handler: (input: never, context: never) => Promise<unknown>) => {
      handlers.set(rpc, handler);
    },
  } as never);
  return {
    call: (rpc: unknown, input = {}) => handlers.get(rpc)!(input as never, context as never),
    reads: () => reads,
    cleanup,
  };
}

test("disabled server features reject before accessing conversation or session data", async () => {
  const app = harness({ attachmentsEnabled: false, sessionsEnabled: false, enabled: false });
  try {
    for (const rpc of [listMedia, readMedia, listSessions, restoreSession, resolveMedia]) {
      await assert.rejects(app.call(rpc, { agentId: "a", assetId: "asset" }), /disabled/);
    }
    assert.equal(app.reads(), 0);
    assert.equal(
      ((await app.call(readFeatures)) as { attachmentsEnabled: boolean }).attachmentsEnabled,
      false,
    );
  } finally {
    app.cleanup();
  }
});

test("unavailable preferences fail closed and audio off blocks cached audio before file access", async () => {
  const invalid = harness({}, "error");
  await assert.rejects(invalid.call(listMedia, { agentId: "a" }), /settings need attention/);
  assert.equal(invalid.reads(), 0);
  invalid.cleanup();
  const app = harness({ audioPlaybackEnabled: false });
  catalogs.set("a", {
    cwd: "/tmp",
    epoch: "test",
    updated: Date.now(),
    assets: new Map([["audio", { kind: "audio" } as never]]),
  });
  try {
    await assert.rejects(
      app.call(readMedia, { agentId: "a", assetId: "audio" }),
      /Audio playback is disabled/,
    );
    assert.equal(app.reads(), 0);
  } finally {
    app.cleanup();
  }
});

test("gallery and attachment switches independently allow authorized image resolution", async () => {
  for (const values of [
    { enabled: true, attachmentsEnabled: false },
    { enabled: false, attachmentsEnabled: true },
  ]) {
    const app = harness(values);
    try {
      await assert.rejects(
        app.call(resolveMedia, { agentId: "a", source: "photo.png" }),
        /SDK read reached/,
      );
      assert.equal(app.reads(), 1);
    } finally {
      app.cleanup();
    }
  }
});
