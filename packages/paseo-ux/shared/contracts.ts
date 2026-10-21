import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const featureValuesSchema = z.object({
  // Preserve the original inline-gallery preference and settings document ID.
  enabled: z.boolean().default(true),
  previewCount: z.number().int().min(1).max(8).default(3),
  attachmentsEnabled: z.boolean().default(true),
  imageGesturesEnabled: z.boolean().default(true),
  sessionsEnabled: z.boolean().default(true),
  audioPlaybackEnabled: z.boolean().default(true),
});
export type FeatureValues = z.infer<typeof featureValuesSchema>;

export const mediaSettings = defineSettings({
  id: "media",
  scope: "host",
  version: 2,
  schema: featureValuesSchema,
  migrate: (values) => featureValuesSchema.parse(values),
});

export const readFeatures = defineRpc({
  name: "features.read",
  input: z.object({}),
  output: featureValuesSchema,
});

export const mediaKindSchema = z.enum(["image", "video", "audio", "document", "file"]);
export const mediaCursorSchema = z.object({ epoch: z.string(), seq: z.number() });
export type MediaCursor = z.infer<typeof mediaCursorSchema>;
export const assetSchema = z.object({
  id: z.string(),
  source: z.string(),
  label: z.string(),
  kind: mediaKindSchema,
  mimeType: z.string().nullable().default(null),
  bytes: z.number().nonnegative().nullable().default(null),
  preview: z.enum(["image", "audio", "external", "none"]).default("none"),
  timestamp: z.string(),
  origin: z.enum(["assistant", "user", "tool"]),
  seq: z.number(),
});
export type MediaAsset = z.infer<typeof assetSchema>;

export const listMedia = defineRpc({
  name: "media.list",
  input: z.object({ agentId: z.string().min(1), cursor: mediaCursorSchema.optional() }),
  output: z.object({
    assets: z.array(assetSchema),
    hasOlder: z.boolean(),
    cursor: mediaCursorSchema.nullable(),
    epoch: z.string(),
  }),
});

const mediaReadSchema = z.object({
  uri: z.string(),
  bytes: z.number().nonnegative(),
  mimeType: z.string(),
});
export const readMedia = defineRpc({
  name: "media.read",
  input: z.object({ agentId: z.string().min(1), assetId: z.string().min(1) }),
  output: mediaReadSchema,
});
// Inline galleries supply a source, but the server must find it in the selected
// conversation's public timeline before reading a local file. This is not a path-read RPC.
export const resolveMedia = defineRpc({
  name: "media.resolve",
  input: z.object({ agentId: z.string().min(1), source: z.string().min(1).max(24_000_000) }),
  output: mediaReadSchema,
});
