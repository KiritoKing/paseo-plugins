import type { PluginServerContext } from "@getpaseo/plugin/server";
import { catalogs, loadMedia, readAsset } from "./server/media";
import { loadSessions, probeRestoreCli, reopenSession } from "./server/sessions";
import { clientDiagnostics, listMedia, mediaSettings, readMedia } from "./shared/contracts";
import { listSessions, restoreSession } from "./shared/sessions";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(mediaSettings);
  server.handle(listSessions, loadSessions);
  server.handle(restoreSession, reopenSession);
  server.handle(clientDiagnostics, async ({ event, detail }) => {
    if (event === "restore-cli-probe") {
      console.info("[Paseo UX restore CLI]", await probeRestoreCli());
    }
    console.info("[Paseo UX client]", event, detail ?? "");
    return { ok: true };
  });
  server.handle(listMedia, loadMedia);
  server.handle(readMedia, readAsset);
  return () => catalogs.clear();
}
