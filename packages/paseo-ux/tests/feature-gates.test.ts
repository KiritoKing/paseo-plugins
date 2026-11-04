import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { listTurnChanges, readTurnDiff } from "../shared/turn-diff";

function harness(values: Record<string, unknown> = {}, status = "ready") {
  const handlers = new Map<unknown, (input: never, context: never) => Promise<unknown>>();
  let state = { status, values: featureValuesSchema.parse(values) };
  const settingsListeners = new Set<(next: typeof state) => void | Promise<void>>();
  const lifecycle = new Map<string, (event: never, context: never) => void | Promise<void>>();
  const appended: unknown[] = [];
  const home = join(tmpdir(), `paseo-ux-feature-gates-${randomUUID()}`);
  const previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  let reads = 0;
  const context = {
    paseo: {
      agents: {
        ref() {
          reads++;
          return {
            timeline: {
              refetch: async () => {
                throw new Error("SDK read reached");
              },
              append: async (item: unknown) => {
                appended.push(item);
              },
            },
          };
        },
      },
    },
  };
  const cleanup = contribute({
    registerSettings: (definition: { id: string }) => ({
      read: async () =>
        definition.id === "appearance" ? { status: "ready", values: defaultAppearance } : state,
      subscribe: (listener: (next: typeof state) => void | Promise<void>) => {
        if (definition.id !== "appearance") settingsListeners.add(listener);
        return () => settingsListeners.delete(listener);
      },
    }),
    handle: (rpc: unknown, handler: (input: never, context: never) => Promise<unknown>) => {
      handlers.set(rpc, handler);
    },
    on: (name: string, handler: (event: never, context: never) => void | Promise<void>) => {
      lifecycle.set(name, handler);
      return () => lifecycle.delete(name);
    },
  } as never);
  return {
    call: (rpc: unknown, input = {}) => handlers.get(rpc)!(input as never, context as never),
    reads: () => reads,
    appended,
    emit: (name: string, event: unknown) => lifecycle.get(name)!(event as never, context as never),
    setSettings: async (nextValues: Record<string, unknown>, nextStatus = "ready") => {
      state = {
        status: nextStatus,
        values: featureValuesSchema.parse({ ...state.values, ...nextValues }),
      };
      await Promise.all([...settingsListeners].map((listener) => listener(state)));
    },
    cleanup: async () => {
      cleanup();
      if (previousHome === undefined) delete process.env.PASEO_HOME;
      else process.env.PASEO_HOME = previousHome;
      await rm(home, { recursive: true, force: true });
    },
  };
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
    encoding: "utf8",
  });
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
    await app.cleanup();
  }
});

test("turn change RPCs fail closed when the feature switch is off", async () => {
  const app = harness({ turnDiffEnabled: false });
  try {
    await assert.rejects(app.call(listTurnChanges, { agentId: "a" }), /Turn changes are disabled/);
    await assert.rejects(
      app.call(readTurnDiff, { agentId: "a", turnId: "t", path: "file.txt" }),
      /Turn changes are disabled/,
    );
  } finally {
    await app.cleanup();
  }
});

test("turn lifecycle hooks append recorded cards and clear pending snapshots when disabled", async () => {
  const base = await mkdtemp(join(tmpdir(), "paseo-ux-turn-hooks-"));
  const repo = join(base, "repo");
  await mkdir(repo);
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Turn Hook Test");
  git(repo, "config", "user.email", "turn-hook@example.test");
  await writeFile(join(repo, "file.txt"), "before\n");
  git(repo, "add", "file.txt");
  git(repo, "commit", "-m", "baseline");
  const app = harness();
  try {
    await app.emit("agent.turn_started", { agent: { id: "agent", cwd: repo }, turnId: "recorded" });
    await writeFile(join(repo, "file.txt"), "after\n");
    await app.emit("agent.turn_ended", {
      agent: { id: "agent", cwd: repo },
      turnId: "recorded",
      outcome: { kind: "completed" },
      timeline: [],
    });
    assert.equal(app.appended.length, 1);
    const card = app.appended[0] as { kind: string; version: number; data: { turnId: string } };
    assert.equal(card.kind, "turn-changes");
    assert.equal(card.version, 1);
    assert.equal(card.data.turnId, "recorded");

    await app.emit("agent.turn_started", { agent: { id: "agent", cwd: repo }, turnId: "cleared" });
    await app.setSettings({ turnDiffEnabled: false });
    await writeFile(join(repo, "file.txt"), "disabled change\n");
    await app.emit("agent.turn_ended", {
      agent: { id: "agent", cwd: repo },
      turnId: "cleared",
      outcome: { kind: "completed" },
      timeline: [],
    });
    assert.equal(app.appended.length, 1);
    const journal = JSON.parse(
      await readFile(
        join(process.env.PASEO_HOME!, "plugin-data", "paseo-ux", "turn-diff", "journal.json"),
        "utf8",
      ),
    ) as { turns: unknown[]; pending: unknown[] };
    assert.equal(journal.turns.length, 1);
    assert.deepEqual(journal.pending, []);
  } finally {
    await app.cleanup();
    await rm(base, { recursive: true, force: true });
  }
});

test("unavailable preferences fail closed and audio off blocks cached audio before file access", async () => {
  const invalid = harness({}, "error");
  await assert.rejects(invalid.call(listMedia, { agentId: "a" }), /settings need attention/);
  assert.equal(invalid.reads(), 0);
  await invalid.cleanup();
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
    await app.cleanup();
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
      await app.cleanup();
    }
  }
});
