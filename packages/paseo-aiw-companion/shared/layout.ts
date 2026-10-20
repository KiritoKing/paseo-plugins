import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const workspaceLayoutSchema = z.object({
  direction: z.enum(["auto", "row", "column"]).default("auto"),
  treeWidth: z.number().finite().min(80).max(4000).default(304),
  treeHeight: z.number().finite().min(80).max(4000).default(280),
});
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;
export const layoutValuesSchema = z.object({
  workspaces: z.record(z.string(), workspaceLayoutSchema).default({}),
});
// Separate settings keep layout saves independent of the Pattern modal's revision.
export const layoutPreferences = defineSettings({
  id: "layout",
  scope: "host",
  version: 1,
  schema: layoutValuesSchema,
});
export const layoutRpcs = settingsRpc(layoutPreferences.id);
export const DIVIDER_SIZE = 12;

export function splitSize(extent: number, preferred: number, stacked: boolean): number {
  const available = Math.max(0, extent - DIVIDER_SIZE);
  const minimum = Math.min(stacked ? 100 : 180, available * 0.4);
  const previewMinimum = Math.min(stacked ? 140 : 240, available * 0.4);
  return Math.max(minimum, Math.min(preferred, available - previewMinimum));
}

export function stackLayout(
  direction: WorkspaceLayout["direction"],
  compact: boolean,
  width: number,
): boolean {
  if (width > 0 && width < 480) return true;
  return (
    direction === "column" || (direction === "auto" && (compact || (width > 0 && width < 720)))
  );
}
