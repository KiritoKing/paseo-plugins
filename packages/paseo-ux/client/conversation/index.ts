import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { messagePresentationSchema } from "../../shared/conversation/message-presentation";
import {
  reasoningPresentationSchema,
  toolPresentationSchema,
} from "../../shared/conversation/tool-presentation";
import { createAppearanceController } from "./controller";
import { createAppearanceSettings } from "./settings";
import { createPresentationViews } from "./views";

/**
 * Registers the optional conversation presentation layer. Each capability is
 * isolated so a host registration failure leaves the rest of Essentials live.
 */
export function registerConversation(client: PluginClientContext): PluginCleanup {
  const cleanups: PluginCleanup[] = [];
  const pendingCleanups = new Set<Promise<void>>();
  const controller = createAppearanceController(client);
  const views = createPresentationViews(controller);
  let disposed = false;

  const release = (cleanup: PluginCleanup) => {
    try {
      const pending = Promise.resolve()
        .then(cleanup)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => pendingCleanups.delete(pending));
      pendingCleanups.add(pending);
    } catch {
      // Continue releasing registrations owned by this module.
    }
  };

  let rendererRegistrationFailed = false;
  if (
    typeof client.addTimelineRenderer !== "function" ||
    typeof client.addTimelineTransformer !== "function"
  ) {
    rendererRegistrationFailed = true;
  } else {
    const registerRenderers = [
      () =>
        client.addTimelineRenderer({
          kind: "readable-tool",
          version: 1,
          schema: toolPresentationSchema,
          Component: views.Tool,
        }),
      () =>
        client.addTimelineRenderer({
          kind: "readable-reasoning",
          version: 1,
          schema: reasoningPresentationSchema,
          Component: views.Reasoning,
        }),
      () =>
        client.addTimelineRenderer({
          kind: "readable-message",
          version: 1,
          schema: messagePresentationSchema,
          Component: views.Message,
        }),
    ];
    for (const register of registerRenderers) {
      try {
        cleanups.push(register());
      } catch {
        rendererRegistrationFailed = true;
        break;
      }
    }
  }
  if (rendererRegistrationFailed) {
    controller.unavailable();
    for (const cleanup of cleanups.splice(0)) release(cleanup);
  }

  try {
    if (typeof client.addSettingsScreen === "function") {
      cleanups.push(
        client.addSettingsScreen({
          id: "appearance",
          title: "会话阅读 / Conversation display",
          icon: "Type",
          Component: createAppearanceSettings(controller),
        }),
      );
    }
  } catch {
    // Settings access is optional; timeline and the rest of Essentials stay live.
  }

  try {
    if (typeof client.addCommandCenterItem === "function") {
      cleanups.push(
        client.addCommandCenterItem({
          id: "conversation-appearance",
          title: "Essentials · 会话阅读",
          icon: "Type",
          context: "global",
          onSelect: () => client.openSettings("appearance"),
        }),
      );
    }
  } catch {
    // The settings page remains available from Paseo's plugin settings list.
  }

  controller.start();
  return async () => {
    if (disposed) return;
    disposed = true;
    await controller.dispose();
    for (const cleanup of cleanups.splice(0).reverse()) release(cleanup);
    await Promise.allSettled([...pendingCleanups]);
  };
}
