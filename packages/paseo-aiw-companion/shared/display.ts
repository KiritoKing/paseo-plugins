import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const displaySchema = z.object({
  tabTitle: z
    .string()
    .trim()
    .min(1, "请输入 Tab 名称")
    .max(40, "Tab 名称最多 40 个字符")
    .default("AIW"),
});
export const displayPreferences = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: displaySchema,
});
export const displayRpcs = settingsRpc(displayPreferences.id);
