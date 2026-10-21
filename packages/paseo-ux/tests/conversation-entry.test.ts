import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { settingsRpc } from "@getpaseo/plugin";
import type {
  PluginClientContext,
  PluginTimelineTransformerContribution,
} from "@getpaseo/plugin/client";
import { featureValuesSchema } from "../shared/contracts";
import { defaultAppearance } from "../shared/conversation/appearance";

type Phase = "streaming" | "complete";
type TransformResult = { items: Array<{ kind?: string; data?: unknown }> } | undefined;
type EventObserver = {
  snapshot(value: unknown): void;
  update(value: unknown): void;
  error(value: unknown): void;
};

const appearanceReadName = settingsRpc("appearance").read.name;
const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
type ResolveFilename = (
  request: string,
  parent: object,
  isMain?: boolean,
  options?: object,
) => string;
const runtimeModule = createRequire(`${process.cwd()}/package.json`)("node:module") as {
  _resolveFilename: ResolveFilename;
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function settle() {
  await flush();
  await flush();
}

async function loadContribution() {
  const resolveFilename = runtimeModule._resolveFilename;
  runtimeModule._resolveFilename = (request, parent, isMain, options) =>
    resolveFilename(
      request === "react-native" ? "react-native-web" : request,
      parent,
      isMain,
      options,
    );
  try {
    return (await import("../index.client")).default;
  } finally {
    runtimeModule._resolveFilename = resolveFilename;
  }
}

function harness(
  order: "media-first" | "appearance-first" = "media-first",
  failConversationRenderer = false,
) {
  const transformers = new Map<string, PluginTimelineTransformerContribution>();
  const renderers = new Map<string, unknown>();
  const screens = new Map<string, unknown>();
  const commands = new Map<string, unknown>();
  const headerButtons = new Map<string, unknown>();
  const observers = new Set<EventObserver>();
  const mediaRegistered = defer();
  const appearanceRegistered = defer();
  const registrationOrder: string[] = [];
  let featureValues = featureValuesSchema.parse({
    enabled: true,
    attachmentsEnabled: false,
    sessionsEnabled: true,
  });
  let appearanceValues = { ...defaultAppearance, tools: true };
  const client = {
    rpc: async (contract: { name: string }) => {
      if (contract.name === "features.read") {
        if (order === "appearance-first") await appearanceRegistered.promise;
        return featureValues;
      }
      if (contract.name === appearanceReadName) {
        if (order === "media-first") await mediaRegistered.promise;
        return { status: "ready", revision: "1", values: appearanceValues };
      }
      throw new Error(`Unexpected RPC: ${contract.name}`);
    },
    openScreen() {},
    openSettings() {},
    addScreen(definition: { id: string }) {
      screens.set(definition.id, definition);
      return () => screens.delete(definition.id);
    },
    addSettingsScreen() {
      return () => {};
    },
    addCommandCenterItem(definition: { id: string }) {
      commands.set(definition.id, definition);
      return () => commands.delete(definition.id);
    },
    addWorkspacePanel() {
      return () => {};
    },
    addTimelineRenderer(definition: { kind: string }) {
      if (failConversationRenderer && definition.kind.startsWith("readable-"))
        throw new Error("Synthetic conversation renderer failure");
      renderers.set(definition.kind, definition);
      return () => renderers.delete(definition.kind);
    },
    addTimelineTransformer(definition: PluginTimelineTransformerContribution) {
      transformers.set(definition.id, definition);
      registrationOrder.push(definition.id);
      if (definition.id === "assistant-images") mediaRegistered.resolve();
      if (definition.id === "readable-messages") appearanceRegistered.resolve();
      return () => transformers.delete(definition.id);
    },
    addHeaderButton(definition: { id: string; workspaceId: string }) {
      const key = `${definition.id}:${definition.workspaceId}`;
      headerButtons.set(key, definition);
      return {
        remove: () => headerButtons.delete(key),
        update() {},
      };
    },
    paseo: {
      observeEvents() {
        let subscribed: EventObserver | undefined;
        return {
          ready: Promise.resolve({}),
          subscribe(observer: EventObserver) {
            subscribed = observer;
            observers.add(observer);
            return () => observers.delete(observer);
          },
          async release() {
            if (subscribed) observers.delete(subscribed);
          },
        };
      },
      workspaces: {
        subscribe() {
          return () => {};
        },
        async list() {
          return {
            entries: [{ id: "synthetic-workspace" }],
            subscription: { async release() {} },
          };
        },
      },
    },
  } as unknown as PluginClientContext;

  return {
    client,
    transformers,
    renderers,
    screens,
    commands,
    headerButtons,
    registrationOrder,
    observerCount: () => observers.size,
    setAppearance(values: typeof appearanceValues) {
      appearanceValues = values;
    },
    setMedia(values: Partial<typeof featureValues>) {
      featureValues = featureValuesSchema.parse({ ...featureValues, ...values });
    },
    emit(settingsId: "appearance" | "media") {
      for (const observer of observers) {
        observer.update({
          type: "status",
          payload: { status: "plugin_settings_changed", settingsId },
        });
      }
    },
  };
}

function run(
  transformers: Map<string, PluginTimelineTransformerContribution>,
  id: string,
  item: unknown,
  phase: Phase,
): TransformResult {
  const transform = transformers.get(id)?.transform as
    | ((input: { item: unknown; phase: Phase }) => TransformResult)
    | undefined;
  return transform?.({ item, phase });
}

test("Essentials coordinates image-only galleries, prose, mixed content, and streaming", async () => {
  const contribute = await loadContribution();
  for (const order of ["media-first", "appearance-first"] as const) {
    const h = harness(order);
    const stop = contribute(h.client);
    await settle();
    const imageOrder = h.registrationOrder.indexOf("assistant-images");
    const proseOrder = h.registrationOrder.indexOf("readable-messages");
    assert.ok(imageOrder >= 0 && proseOrder >= 0);
    assert.equal(imageOrder < proseOrder, order === "media-first");

    const imageOnly = {
      type: "assistant_message",
      text: "![sample](https://example.test/a.png)",
    };
    assert.equal(
      run(h.transformers, "assistant-images", imageOnly, "complete")?.items[0]?.kind,
      "image-gallery",
    );
    assert.equal(run(h.transformers, "readable-messages", imageOnly, "complete"), undefined);

    const prose = { type: "assistant_message", text: "A readable **answer**." };
    assert.equal(run(h.transformers, "assistant-images", prose, "complete"), undefined);
    assert.equal(
      run(h.transformers, "readable-messages", prose, "complete")?.items[0]?.kind,
      "readable-message",
    );

    const mixed = {
      type: "assistant_message",
      text: "Diagram: ![sample](https://example.test/a.png)",
    };
    assert.equal(run(h.transformers, "assistant-images", mixed, "complete"), undefined);
    assert.equal(run(h.transformers, "readable-messages", mixed, "complete"), undefined);
    assert.equal(run(h.transformers, "assistant-images", mixed, "streaming"), undefined);
    assert.equal(run(h.transformers, "readable-messages", mixed, "streaming"), undefined);
    assert.equal(run(h.transformers, "assistant-images", prose, "streaming"), undefined);
    assert.equal(run(h.transformers, "readable-messages", prose, "streaming"), undefined);

    await stop();
  }
});

test("output-only mode hides activity and restores saved categories while galleries stay enabled", async () => {
  const h = harness();
  const contribute = await loadContribution();
  const stop = contribute(h.client);
  await settle();
  const tool = {
    type: "tool_call",
    callId: "shell-1",
    name: "shell",
    detail: { type: "shell", command: "echo ready", cwd: "/tmp", output: "ready", exitCode: 0 },
    status: "completed",
    error: null,
  };

  h.setAppearance({ ...defaultAppearance, tools: true, activityMode: "output-only" });
  h.emit("appearance");
  await settle();
  assert.deepEqual(run(h.transformers, "readable-tools", tool, "complete"), { items: [] });
  assert.ok(h.transformers.has("assistant-images"));

  h.setAppearance({ ...defaultAppearance, tools: true, activityMode: "custom" });
  h.emit("appearance");
  await settle();
  assert.equal(
    run(h.transformers, "readable-tools", tool, "complete")?.items[0]?.kind,
    "readable-tool",
  );
  assert.ok(h.transformers.has("assistant-images"));

  await stop();
});

test("appearance and media switches are independent and unload releases registrations and observers", async () => {
  const h = harness();
  const contribute = await loadContribution();
  const stop = contribute(h.client);
  await settle();
  assert.ok(h.transformers.has("readable-messages"));
  assert.ok(h.transformers.has("assistant-images"));
  assert.ok(h.observerCount() >= 2);

  h.setAppearance({ ...defaultAppearance, tools: true, enabled: false });
  h.emit("appearance");
  await settle();
  for (const id of ["readable-messages", "readable-reasoning", "readable-tools"])
    assert.equal(h.transformers.has(id), false);
  assert.ok(h.transformers.has("assistant-images"));
  assert.ok(h.commands.has("sessions"));
  assert.ok(h.headerButtons.size > 0);

  h.setMedia({ enabled: false });
  h.emit("media");
  await settle();
  assert.equal(h.transformers.has("assistant-images"), false);
  assert.ok(h.commands.has("sessions"));
  assert.ok(h.headerButtons.size > 0);

  h.setAppearance({ ...defaultAppearance, tools: true, enabled: true });
  h.emit("appearance");
  await settle();
  assert.ok(h.transformers.has("readable-messages"));
  assert.equal(h.transformers.has("assistant-images"), false);

  await stop();
  await settle();
  assert.equal(h.transformers.size, 0);
  assert.equal(h.renderers.size, 0);
  assert.equal(h.screens.size, 0);
  assert.equal(h.commands.size, 0);
  assert.equal(h.headerButtons.size, 0);
  assert.equal(h.observerCount(), 0);
});

test("optional conversation registration failures leave Essentials media and sessions available", async () => {
  const h = harness("media-first", true);
  const contribute = await loadContribution();
  const stop = contribute(h.client);
  await settle();

  assert.ok(h.transformers.has("assistant-images"));
  assert.ok(h.commands.has("sessions"));
  assert.ok(h.headerButtons.size > 0);
  assert.equal(h.transformers.has("readable-messages"), false);

  await stop();
  await settle();
  assert.equal(h.transformers.size, 0);
  assert.equal(h.renderers.size, 0);
  assert.equal(h.observerCount(), 0);
});
