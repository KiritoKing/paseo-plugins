import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const mediaSettings = defineSettings({
  id: "media",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(true),
    previewCount: z.number().int().min(1).max(8).default(3),
  }),
});
export const assetSchema = z.object({
  id: z.string(),
  source: z.string(),
  label: z.string(),
  kind: z.literal("image"),
  timestamp: z.string(),
  origin: z.enum(["assistant", "user", "tool"]),
  seq: z.number(),
});
export type MediaAsset = z.infer<typeof assetSchema>;
export const listMedia = defineRpc({
  name: "media.list",
  input: z.object({
    agentId: z.string().min(1),
    cursor: z.object({ epoch: z.string(), seq: z.number() }).optional(),
  }),
  output: z.object({
    assets: z.array(assetSchema),
    hasOlder: z.boolean(),
    cursor: z.object({ epoch: z.string(), seq: z.number() }).nullable(),
    epoch: z.string(),
  }),
});
export const readMedia = defineRpc({
  name: "media.read",
  input: z.object({ agentId: z.string().min(1), assetId: z.string().min(1) }),
  output: z.object({ uri: z.string(), bytes: z.number().nonnegative(), mimeType: z.string() }),
});

export const clientDiagnostics = defineRpc({
  name: "diagnostics.client",
  input: z.object({ event: z.string(), detail: z.string().optional() }),
  output: z.object({ ok: z.boolean() }),
});
