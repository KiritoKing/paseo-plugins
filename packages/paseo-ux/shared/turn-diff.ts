import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const turnFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum(["added", "modified", "deleted", "renamed", "typechange"]),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  binary: z.boolean(),
  diffAvailable: z.boolean(),
});
export type TurnFile = z.infer<typeof turnFileSchema>;

export const turnCommitSchema = z.object({ sha: z.string(), subject: z.string() });
export type TurnCommit = z.infer<typeof turnCommitSchema>;

export const turnSummarySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  outcome: z.enum(["completed", "failed", "canceled"]),
  files: z.array(turnFileSchema),
  totalFiles: z.number().int().nonnegative(),
  commits: z.array(turnCommitSchema),
  warnings: z.array(z.string()),
});
export type TurnSummary = z.infer<typeof turnSummarySchema>;

export const turnCardSchema = z.object({
  kind: z.literal("turn-changes"),
  version: z.literal(1),
  turnId: z.string(),
  totalFiles: z.number().int().nonnegative(),
  totalCommits: z.number().int().nonnegative(),
  files: z.array(turnFileSchema).max(20),
  commits: z.array(turnCommitSchema).max(10),
  warnings: z.array(z.string()),
});
export type TurnCard = z.infer<typeof turnCardSchema>;

export const listTurnChanges = defineRpc({
  name: "turn_changes.list",
  input: z.object({
    agentId: z.string().min(1),
    cursor: z.string().optional(),
    turnId: z.string().optional(),
  }),
  output: z.object({ turns: z.array(turnSummarySchema), nextCursor: z.string().nullable() }),
});

export const readTurnDiff = defineRpc({
  name: "turn_changes.read",
  input: z.object({
    agentId: z.string().min(1),
    turnId: z.string().min(1),
    path: z.string().min(1),
  }),
  output: z.object({
    kind: z.enum(["text", "image", "binary", "unavailable"]),
    patch: z.string(),
    truncated: z.boolean(),
    beforeUri: z.string().nullable(),
    afterUri: z.string().nullable(),
    notice: z.string().optional(),
  }),
});
