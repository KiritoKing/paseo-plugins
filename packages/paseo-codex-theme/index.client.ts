import type { PluginClientContext } from "@getpaseo/plugin/client";
import { codexThemes } from "./client/themes";

export default function contribute(client: PluginClientContext) {
  const cleanups = codexThemes.map((theme) => client.addTheme(theme));
  return () => {
    for (const cleanup of cleanups) void cleanup();
  };
}
