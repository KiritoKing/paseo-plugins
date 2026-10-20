import assert from "node:assert/strict";
import test from "node:test";
import type {
  PluginClientContext,
  PluginTimelineTransformerContribution,
} from "@getpaseo/plugin/client";
import { createAppearanceController } from "../client/controller";
import { defaultAppearance } from "../shared/appearance";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  let result: unknown = { status: "ready", values: defaultAppearance, revision: "1" };
  let rejectRead = false;
  let reader: (() => Promise<unknown>) | undefined;
  let observer:
    | { snapshot(value: unknown): void; update(value: unknown): void; error(error: unknown): void }
    | undefined;
  const active = new Map<string, PluginTimelineTransformerContribution>();
  const calls = { reads: 0, observations: 0, removed: 0, released: 0, unsubscribed: 0 };
  let signal: AbortSignal | undefined;
  const client = {
    rpc: async () => {
      calls.reads++;
      if (rejectRead) throw Error("offline");
      return reader ? reader() : result;
    },
    addTimelineRenderer() {},
    addTimelineTransformer(definition: PluginTimelineTransformerContribution) {
      active.set(definition.id, definition);
      return async () => {
        active.delete(definition.id);
        await flush();
        calls.removed++;
      };
    },
    paseo: {
      observeEvents(events: string[], options: { signal: AbortSignal }) {
        assert.deepEqual(events, ["status.plugin_settings_changed"]);
        calls.observations++;
        signal = options.signal;
        return {
          subscribe(value: typeof observer) {
            observer = value;
            return () => {
              calls.unsubscribed++;
            };
          },
          release: async () => {
            calls.released++;
          },
        };
      },
    },
  } as unknown as PluginClientContext;
  return {
    client,
    calls,
    active,
    get signal() {
      return signal;
    },
    setResult(value: unknown) {
      result = value;
    },
    setReader(value: typeof reader) {
      reader = value;
    },
    failRead() {
      rejectRead = true;
    },
    event(settingsId = "appearance") {
      observer?.update({
        type: "status",
        payload: { status: "plugin_settings_changed", settingsId },
      });
    },
    observationError() {
      observer?.error(Error("subscription failed"));
    },
    reconnect() {
      observer?.snapshot({ subscriptionId: "new-connection" });
    },
  };
}

test("one public settings observation; defaults preserve native tool groups and own supported prose", async () => {
  const h = harness();
  const controller = createAppearanceController(h.client);
  controller.start();
  controller.start();
  await flush();
  assert.equal(h.calls.observations, 1);
  assert.equal(controller.getSnapshot().status, "ready");
  assert.deepEqual([...h.active.keys()].sort(), ["readable-messages", "readable-reasoning"]);
  await controller.dispose();
  assert.equal(h.active.size, 0);
  assert.equal(h.calls.removed, 2);
  assert.equal(h.calls.released, 1);
  assert.equal(h.calls.unsubscribed, 1);
  assert.equal(h.signal?.aborted, true);
  await controller.dispose();
  assert.equal(h.calls.released, 1);
});

test("disable and per-type ownership release native source; unknown shell details are not claimed", async () => {
  const h = harness();
  h.setResult({
    status: "ready",
    values: { ...defaultAppearance, tools: true, messages: false },
    revision: "1",
  });
  const controller = createAppearanceController(h.client);
  controller.start();
  await flush();
  const transformer = h.active.get("readable-tools")!;
  const transform = transformer.transform as (input: {
    item: unknown;
    phase: "complete";
  }) => unknown;
  assert.equal(
    transform({ item: { type: "tool_call", detail: { type: "image" } }, phase: "complete" }),
    undefined,
  );
  h.setResult({
    status: "ready",
    values: { ...defaultAppearance, tools: false, messages: true },
    revision: "2",
  });
  h.event();
  await flush();
  assert.deepEqual([...h.active.keys()].sort(), ["readable-messages", "readable-reasoning"]);
  const message = h.active.get("readable-messages")!;
  const present = message.transform as (input: {
    item: unknown;
    phase: "streaming" | "complete";
  }) => unknown;
  assert.equal(
    present({ item: { type: "assistant_message", text: "Streaming text" }, phase: "streaming" }),
    undefined,
  );
  assert.ok(
    present({ item: { type: "assistant_message", text: "Complete text" }, phase: "complete" }),
  );
  h.setResult({ status: "ready", values: { ...defaultAppearance, enabled: false }, revision: "3" });
  h.event();
  await flush();
  assert.equal(h.active.size, 0);
  await controller.dispose();
});

test("invalid settings and failed reads stop claiming source items", async () => {
  const h = harness();
  const controller = createAppearanceController(h.client);
  controller.start();
  await flush();
  h.setResult({ status: "ready", values: { enabled: "yes" }, revision: "2" });
  await controller.reload();
  assert.equal(controller.getSnapshot().status, "invalid");
  assert.equal(h.active.size, 0);
  h.failRead();
  await controller.reload();
  assert.equal(controller.getSnapshot().status, "error");
  assert.equal(h.active.size, 0);
  await controller.dispose();
});

test("settings change and reconnect reload; unrelated settings do not; live font changes retain source registration", async () => {
  const h = harness();
  const controller = createAppearanceController(h.client);
  controller.start();
  await flush();
  const original = h.active.get("readable-messages");
  const reads = h.calls.reads;
  h.event("another-document");
  await flush();
  assert.equal(h.calls.reads, reads);
  h.setResult({ status: "ready", values: { ...defaultAppearance, fontSize: "16" }, revision: "2" });
  h.reconnect();
  await flush();
  assert.equal(controller.getSnapshot().values.fontSize, "16");
  assert.equal(h.active.get("readable-messages"), original);
  await controller.dispose();
});

test("a pending settings response cannot register after teardown", async () => {
  const h = harness();
  let finish!: (value: unknown) => void;
  h.setReader(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = createAppearanceController(h.client);
  controller.start();
  await controller.dispose();
  finish({ status: "ready", values: defaultAppearance, revision: "1" });
  await flush();
  assert.equal(h.active.size, 0);
  assert.equal(controller.getSnapshot().status, "loading");
});

test("manual retry re-establishes a failed owned observation", async () => {
  const h = harness();
  const controller = createAppearanceController(h.client);
  controller.start();
  await flush();
  h.observationError();
  await flush();
  assert.equal(controller.getSnapshot().status, "error");
  assert.equal(h.active.size, 0);
  await controller.reload();
  assert.equal(h.calls.observations, 2);
  assert.equal(controller.getSnapshot().status, "ready");
  assert.equal(h.active.size, 2);
  await controller.dispose();
  assert.equal(h.calls.released, 2);
});

test("a settings read from a failed observation cannot re-enable presentation", async () => {
  const h = harness();
  let finish!: (value: unknown) => void;
  h.setReader(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = createAppearanceController(h.client);
  controller.start();
  h.observationError();
  finish({ status: "ready", values: defaultAppearance, revision: "1" });
  await flush();
  assert.equal(controller.getSnapshot().status, "error");
  assert.equal(h.active.size, 0);
  await controller.dispose();
});

test("missing public capability retains native content", async () => {
  const h = harness();
  const controller = createAppearanceController({
    ...h.client,
    addTimelineTransformer: undefined,
  } as unknown as PluginClientContext);
  controller.start();
  await flush();
  assert.equal(controller.getSnapshot().status, "unavailable");
  assert.equal(h.calls.reads, 0);
  assert.equal(h.active.size, 0);
  await controller.dispose();
});
