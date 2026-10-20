import { listSessions, restoreSession } from "./shared/sessions";
import { loadSessions, reopenSession, probeRestoreCli } from "./server/sessions";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { mediaSettings, listMedia, readMedia, clientDiagnostics } from "./shared/contracts";
import { loadMedia, readAsset, catalogs } from "./server/media";

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
