import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  type Appearance,
  appearanceSchema,
  appearanceSettings,
  defaultAppearance,
} from "../shared/appearance";
import { projectMessage } from "../shared/message-presentation";
import { projectReasoning, projectTool } from "../shared/tool-presentation";

export type PresentationKind = "tools" | "reasoning" | "messages";
export interface AppearanceSnapshot {
  status: "loading" | "ready" | "invalid" | "error" | "unavailable";
  values: Appearance;
}

/** One settings observation per installation, not one subscription per timeline row. */
export function createAppearanceController(client: PluginClientContext) {
  let snapshot: AppearanceSnapshot = { status: "loading", values: defaultAppearance };
  const listeners = new Set<() => void>();
  const registrations = new Map<PresentationKind, () => void | Promise<void>>();
  const lifetime = new AbortController();
  let disposed = false;
  let started = false;
  let reading = false;
  let requested = false;
  let available =
    typeof client.addTimelineTransformer === "function" &&
    typeof client.addTimelineRenderer === "function" &&
    typeof client.rpc === "function" &&
    typeof client.paseo?.observeEvents === "function";
  let releaseObservation: (() => void | Promise<void>) | undefined;
  let unsubscribe: (() => void) | undefined;
  let observationGeneration = 0;
  const pendingRemovals = new Set<Promise<unknown>>();

  const remove = (cleanup: () => void | Promise<void>) => {
    try {
      const pending = Promise.resolve(cleanup())
        .catch(() => {})
        .finally(() => pendingRemovals.delete(pending));
      pendingRemovals.add(pending);
    } catch {
      /* Continue releasing the other owned contributions. */
    }
  };

  const notify = (next: AppearanceSnapshot) => {
    if (
      disposed ||
      (next.status === snapshot.status &&
        JSON.stringify(next.values) === JSON.stringify(snapshot.values))
    )
      return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const clear = () => {
    for (const cleanup of registrations.values()) remove(cleanup);
    registrations.clear();
  };
  const apply = (next: AppearanceSnapshot) => {
    if (disposed) return;
    notify(next);
    const wanted = next.status === "ready" && available && next.values.enabled;
    for (const kind of ["tools", "reasoning", "messages"] as const) {
      if ((!wanted || !next.values[kind]) && registrations.has(kind)) {
        remove(registrations.get(kind)!);
        registrations.delete(kind);
      }
      if (!wanted || !next.values[kind] || registrations.has(kind)) continue;
      try {
        if (kind === "tools")
          registrations.set(
            kind,
            client.addTimelineTransformer({
              id: "readable-tools",
              query: { itemType: "tool_call" },
              transform({ item, phase }) {
                const data = projectTool(item, phase);
                return data
                  ? { items: [{ type: "plugin", kind: "readable-tool", version: 1, data }] }
                  : undefined;
              },
            }),
          );
        if (kind === "reasoning")
          registrations.set(
            kind,
            client.addTimelineTransformer({
              id: "readable-reasoning",
              query: { itemType: "reasoning" },
              transform({ item, phase }) {
                const data = projectReasoning(item, phase);
                return data
                  ? { items: [{ type: "plugin", kind: "readable-reasoning", version: 1, data }] }
                  : undefined;
              },
            }),
          );
        if (kind === "messages")
          registrations.set(
            kind,
            client.addTimelineTransformer({
              id: "readable-messages",
              query: { itemType: "assistant_message" },
              transform({ item, phase }) {
                // Keep in-flight native Markdown stable; switch presentation once complete.
                if (phase === "streaming") return undefined;
                const data = projectMessage(item, phase);
                return data
                  ? { items: [{ type: "plugin", kind: "readable-message", version: 1, data }] }
                  : undefined;
              },
            }),
          );
      } catch {
        available = false;
        clear();
        notify({ status: "unavailable", values: next.values });
        break;
      }
    }
  };

  async function reload(): Promise<void> {
    if (disposed) return;
    if (started && !releaseObservation && !observeSettings()) return;
    if (reading) {
      requested = true;
      return;
    }
    reading = true;
    try {
      do {
        requested = false;
        if (started && !releaseObservation) break;
        const generation = observationGeneration;
        try {
          const result = await client.rpc(settingsRpc(appearanceSettings.id).read, {});
          if (disposed) return;
          if (generation !== observationGeneration) continue;
          const parsed =
            result.status === "ready" ? appearanceSchema.safeParse(result.values) : null;
          if (parsed?.success)
            apply({ status: available ? "ready" : "unavailable", values: parsed.data });
          else apply({ status: "invalid", values: snapshot.values });
        } catch {
          if (!disposed && generation === observationGeneration)
            apply({ status: "error", values: snapshot.values });
        }
      } while (requested && !disposed);
    } finally {
      reading = false;
    }
  }

  function observeSettings(): boolean {
    if (disposed || !available) return false;
    if (releaseObservation) return true;
    const generation = ++observationGeneration;
    try {
      const observation = client.paseo.observeEvents(["status.plugin_settings_changed"], {
        signal: lifetime.signal,
      });
      releaseObservation = () => observation.release();
      unsubscribe = observation.subscribe({
        snapshot: () => {
          if (generation === observationGeneration) void reload();
        },
        update: (message) => {
          if (
            generation === observationGeneration &&
            message.type === "status" &&
            message.payload.status === "plugin_settings_changed" &&
            message.payload.settingsId === appearanceSettings.id
          )
            void reload();
        },
        error: () => {
          if (disposed || generation !== observationGeneration) return;
          observationGeneration++;
          unsubscribe?.();
          unsubscribe = undefined;
          const release = releaseObservation;
          releaseObservation = undefined;
          if (release) remove(release);
          apply({ status: "error", values: snapshot.values });
        },
      });
      return true;
    } catch {
      const release = releaseObservation;
      releaseObservation = undefined;
      if (release) remove(release);
      apply({ status: "error", values: snapshot.values });
      return false;
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    reload,
    unavailable() {
      available = false;
      clear();
      notify({ status: "unavailable", values: snapshot.values });
    },
    start() {
      if (disposed || started) return;
      started = true;
      if (!available) {
        notify({ status: "unavailable", values: snapshot.values });
        return;
      }
      if (observeSettings()) void reload();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      lifetime.abort();
      clear();
      listeners.clear();
      await Promise.allSettled([...pendingRemovals, Promise.resolve(releaseObservation?.())]);
    },
  };
}

export type AppearanceController = ReturnType<typeof createAppearanceController>;
