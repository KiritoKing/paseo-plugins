import type { PluginServerContext } from "@getpaseo/plugin/server";
import { appearanceSettings } from "./shared/appearance";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(appearanceSettings);
  return () => {};
}
