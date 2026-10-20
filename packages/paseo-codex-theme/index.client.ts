import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createAppearanceController } from "./client/controller";
import { createAppearanceSettings } from "./client/settings";
import { codexThemes } from "./client/themes";
import { createPresentationViews } from "./client/views";
import { messagePresentationSchema } from "./shared/message-presentation";
import { reasoningPresentationSchema, toolPresentationSchema } from "./shared/tool-presentation";

export default function contribute(client: PluginClientContext) {
  const cleanups = codexThemes.map((theme) => client.addTheme(theme));
  const controller = createAppearanceController(client);
  const views = createPresentationViews(controller);
  // A source is claimed only after all renderer schemas have registered successfully.
  try {
    cleanups.push(
      client.addTimelineRenderer({
        kind: "readable-tool",
        version: 1,
        schema: toolPresentationSchema,
        Component: views.Tool,
      }),
    );
    cleanups.push(
      client.addTimelineRenderer({
        kind: "readable-reasoning",
        version: 1,
        schema: reasoningPresentationSchema,
        Component: views.Reasoning,
      }),
    );
    cleanups.push(
      client.addTimelineRenderer({
        kind: "readable-message",
        version: 1,
        schema: messagePresentationSchema,
        Component: views.Message,
      }),
    );
  } catch {
    controller.unavailable();
  }
  if (typeof client.addSettingsScreen === "function")
    cleanups.push(
      client.addSettingsScreen({
        id: "appearance",
        title: "会话外观",
        icon: "Type",
        Component: createAppearanceSettings(controller),
      }),
    );
  controller.start();
  return async () => {
    await controller.dispose();
    for (const cleanup of cleanups.reverse()) await cleanup();
  };
}
