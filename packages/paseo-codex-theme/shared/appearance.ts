import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const appearanceSchema = z
  .object({
    enabled: z.boolean().default(true),
    tools: z.boolean().default(false),
    reasoning: z.boolean().default(true),
    messages: z.boolean().default(true),
    density: z.enum(["comfortable", "compact"]).default("comfortable"),
    fontSize: z.enum(["14", "15", "16"]).default("15"),
    readingWidth: z.enum(["normal", "wide"]).default("normal"),
    expandTools: z.enum(["failed", "all", "none"]).default("failed"),
    expandReasoning: z.boolean().default(false),
    wrapCode: z.boolean().default(false),
  })
  .strict();

export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: Appearance = appearanceSchema.parse({});
export const appearanceSettings = defineSettings({
  id: "appearance",
  scope: "host",
  version: 1,
  schema: appearanceSchema,
});
