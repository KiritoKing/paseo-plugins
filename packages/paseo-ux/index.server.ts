import type { PluginServerContext } from "@getpaseo/plugin/server";
import { catalogs, loadMedia, readAsset, readReferencedAsset } from "./server/media";
import { loadSessions, reopenSession } from "./server/sessions";
import {
  listMedia,
  mediaSettings,
  readFeatures,
  readMedia,
  resolveMedia,
} from "./shared/contracts";
import { listSessions, restoreSession } from "./shared/sessions";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(mediaSettings);
  const features = async () => {
    const current = await settings.read();
    if (current.status !== "ready")
      throw new Error(
        "Essentials settings need attention. Open Features to reload or restore defaults.",
      );
    return current.values;
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
  return () => catalogs.clear();
}
