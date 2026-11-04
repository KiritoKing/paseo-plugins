import type { PluginServerContext } from "@getpaseo/plugin/server";
import { catalogs, loadMedia, readAsset, readReferencedAsset } from "./server/media";
import { loadSessions, reopenSession } from "./server/sessions";
import { TurnDiffStore } from "./server/turn-diff";
import {
  listMedia,
  mediaSettings,
  readFeatures,
  readMedia,
  resolveMedia,
} from "./shared/contracts";
import { appearanceSettings } from "./shared/conversation/appearance";
import { listSessions, restoreSession } from "./shared/sessions";
import { listTurnChanges, readTurnDiff } from "./shared/turn-diff";

export default function contribute(server: PluginServerContext) {
  try {
    // Keep the old setting ID and version so saved conversation preferences
    // remain compatible when the feature moves into Essentials.
    server.registerSettings(appearanceSettings);
  } catch {
    // Presentation is optional; a settings registration failure must not block
    // the existing media and session RPC handlers.
  }
  const settings = server.registerSettings(mediaSettings);
  const turnDiff = new TurnDiffStore();
  let subscribedTurnDiffEnabled: boolean | null = null;
  let settingsUnsubscribe: () => void | Promise<void> = () => undefined;
  try {
    settingsUnsubscribe = settings.subscribe((state) => {
      const enabled = state.status === "ready" && state.values.turnDiffEnabled;
      subscribedTurnDiffEnabled = enabled;
      if (!enabled) return turnDiff.clearPending();
    });
  } catch {
    subscribedTurnDiffEnabled = false;
  }
  const features = async () => {
    const current = await settings.read();
    if (current.status !== "ready")
      throw new Error(
        "Essentials settings need attention. Open Features to reload or restore defaults.",
      );
    return current.values;
  };
  const turnDiffEnabled = async () => {
    try {
      const current = await settings.read();
      if (
        current.status !== "ready" ||
        !current.values.turnDiffEnabled ||
        subscribedTurnDiffEnabled === false
      ) {
        await turnDiff.clearPending();
        return false;
      }
      return true;
    } catch {
      await turnDiff.clearPending();
      return false;
    }
  };
  server.handle(readFeatures, features);
  server.handle(listSessions, async (input, context) => {
    if (!(await features()).sessionsEnabled)
      throw new Error("Session history is disabled in Essentials Features.");
    return loadSessions(input, context);
  });
  server.handle(restoreSession, async (input, context) => {
    if (!(await features()).sessionsEnabled)
      throw new Error("Session history is disabled in Essentials Features.");
    return reopenSession(input, context);
  });
  server.handle(listMedia, async (input, context) => {
    if (!(await features()).attachmentsEnabled)
      throw new Error("Conversation attachments are disabled in Essentials Features.");
    return loadMedia(input, context);
  });
  server.handle(readMedia, async (input, context) => {
    const current = await features();
    if (!current.attachmentsEnabled)
      throw new Error("Conversation attachments are disabled in Essentials Features.");
    if (
      catalogs.get(input.agentId)?.assets.get(input.assetId)?.kind === "audio" &&
      !current.audioPlaybackEnabled
    )
      throw new Error("Audio playback is disabled in Essentials Features.");
    const result = await readAsset(input, context);
    if (result.mimeType.startsWith("audio/") && !current.audioPlaybackEnabled)
      throw new Error("Audio playback is disabled in Essentials Features.");
    return result;
  });
  server.handle(resolveMedia, async (input, context) => {
    const current = await features();
    if (!current.enabled && !current.attachmentsEnabled)
      throw new Error("Image viewing is disabled in Essentials Features.");
    const result = await readReferencedAsset(input, context);
    if (!result.mimeType.startsWith("image/"))
      throw new Error("This gallery only previews images.");
    return result;
  });
  server.handle(listTurnChanges, async (input) => {
    if (!(await features()).turnDiffEnabled)
      throw new Error("Turn changes are disabled in Essentials Features.");
    return turnDiff.list(input);
  });
  server.handle(readTurnDiff, async (input) => {
    if (!(await features()).turnDiffEnabled)
      throw new Error("Turn changes are disabled in Essentials Features.");
    return turnDiff.read(input);
  });
  const stopTurnStarted = server.on("agent.turn_started", async (event) => {
    if (!(await turnDiffEnabled())) return;
    await turnDiff.start(event);
  });
  const stopTurnEnded = server.on("agent.turn_ended", async (event, context) => {
    if (!(await turnDiffEnabled())) return;
    const card = await turnDiff.end(event);
    if (!card) return;
    try {
      const agent = context.paseo.agents.ref(event.agent.id);
      await agent.timeline.append({
        id: `turn-diff:${event.agent.id}:${card.turnId}`,
        type: "plugin",
        kind: "turn-changes",
        version: 1,
        data: card,
      });
    } catch {
      // The durable journal remains available through RPC if timeline append fails.
    }
  });
  return () => {
    settingsUnsubscribe();
    stopTurnStarted();
    stopTurnEnded();
    catalogs.clear();
  };
}
