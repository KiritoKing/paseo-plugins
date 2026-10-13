import { defineRpc, defineSettings } from '@getpaseo/plugin';
import { z } from 'zod';

export const scopeSchema = z.enum(['all', 'branch', 'working']);
export const originSchema = z.enum(['branch', 'combined', 'staged', 'unstaged', 'untracked']);
export const repoSchema = z.object({
  id: z.string(), name: z.string(), path: z.string(), branch: z.string(), head: z.string(),
  baseSha: z.string(), ready: z.boolean(), error: z.string().nullable(),
});
export const catalogSchema = z.object({
  root: z.string(), projectKey: z.string(), branch: z.string(), readAt: z.string(),
  aiwVersion: z.string(), repos: z.array(repoSchema),
});
export const entrySchema = z.object({ name: z.string(), path: z.string(), directory: z.boolean(), symlink: z.boolean() });
export const fileSchema = z.object({
  path: z.string(), content: z.string(), startLine: z.number(), totalLines: z.number(),
  binary: z.boolean(), truncated: z.boolean(), head: z.string(), contentHash: z.string(),
});
export const changedSchema = z.object({
  repoId: z.string(), path: z.string(), oldPath: z.string().optional(),
  status: z.enum(['A', 'M', 'D', 'R', 'C', 'conflict']), origin: originSchema,
  additions: z.number().nullable(), deletions: z.number().nullable(), binary: z.boolean(),
});
export const changeGroupSchema = z.object({
  repo: repoSchema, baseline: z.string(), head: z.string(), snapshotId: z.string(),
  files: z.array(changedSchema), error: z.string().nullable(),
});
export const changesSchema = z.object({ groups: z.array(changeGroupSchema), readAt: z.string() });
export const patchSchema = z.object({ patch: z.string(), binary: z.boolean(), truncated: z.boolean(), before: z.string(), after: z.string() });
export const searchSchema = z.object({
  hits: z.array(z.object({ repoId: z.string(), path: z.string(), line: z.number(), text: z.string() })),
  errors: z.array(z.object({ repoId: z.string(), error: z.string() })), truncated: z.boolean(), readAt: z.string(),
});
const workspace = { workspaceId: z.string().min(1) };
const locator = { ...workspace, repoId: z.string().min(1), path: z.string() };
export const catalogRpc = defineRpc({ name: 'aiw.catalog', input: z.object(workspace), output: catalogSchema });
export const availabilityRpc = defineRpc({ name: 'aiw.availability', input: z.object({ workspaceIds: z.array(z.string().min(1)).max(200) }), output: z.array(z.object({ workspaceId: z.string(), directory: z.string().nullable(), configured: z.boolean() })) });
export const treeRpc = defineRpc({ name: 'aiw.tree', input: z.object({ ...locator, showIgnored: z.boolean().default(false) }), output: z.object({ entries: z.array(entrySchema), truncated: z.boolean() }) });
export const fileRpc = defineRpc({ name: 'aiw.file', input: z.object({ ...locator, startLine: z.number().int().positive().default(1) }), output: fileSchema });
export const changesRpc = defineRpc({ name: 'aiw.changes', input: z.object({ ...workspace, scope: scopeSchema, baselineOverride: z.string().optional() }), output: changesSchema });
export const patchRpc = defineRpc({ name: 'aiw.patch', input: z.object({ ...locator, oldPath: z.string().optional(), origin: originSchema, scope: scopeSchema, expectedSnapshot: z.string(), baselineOverride: z.string().optional() }), output: patchSchema });
export const searchRpc = defineRpc({ name: 'aiw.search', input: z.object({ ...workspace, repoIds: z.array(z.string()).min(1).max(32), query: z.string().min(1).max(256), regex: z.boolean().default(false), caseSensitive: z.boolean().default(false), include: z.array(z.string()).default([]), exclude: z.array(z.string()).default([]) }), output: searchSchema });

export const legacyDefaultIncludes = ['**/requirements/**', '**/changes/**', '**/specs/**', '**/plans/**'];
export const legacyV2Includes = [
  '**/openspec/**/*.md', '**/openspec/**/*.yaml', '**/openspec/**/*.yml',
  '**/.aiw/**/*.md', '**/.aiw/change.yaml', '**/aiw.yaml', ...legacyDefaultIncludes,
];
const extensions = (...values: string[]) => values.map(extension => `**/*.${extension}`);
export const patternPresets = [
  { id: 'documents', label: '常见文档', patterns: extensions('md', 'mdx', 'markdown', 'txt', 'rst', 'adoc', 'org', 'tex', 'rmd', 'qmd') },
  { id: 'openspec', label: 'OpenSpec 文档', patterns: ['**/openspec/**/*.md', '**/openspec/**/*.yaml', '**/openspec/**/*.yml'] },
  { id: 'aiw', label: 'AIW 文档', patterns: ['**/.aiw/**/*.md', '**/.aiw/change.yaml', '**/aiw.yaml'] },
  { id: 'requirements', label: '结构化需求与方案', patterns: ['requirements', 'changes', 'specs', 'plans'].flatMap(directory => ['yaml', 'yml', 'json'].map(extension => `**/${directory}/**/*.${extension}`)) },
];
export const codePatternPresets = [
  { id: 'web', label: 'Web 与样式', patterns: extensions('ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'less') },
  { id: 'services', label: '服务端与脚本', patterns: extensions('go', 'py', 'pyi', 'rs', 'java', 'kt', 'kts', 'scala', 'rb', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'lua', 'pl', 'ex', 'exs', 'erl', 'hs', 'r', 'R') },
  { id: 'native', label: '原生与接口', patterns: extensions('c', 'h', 'cc', 'hh', 'cpp', 'hpp', 'cxx', 'hxx', 'cs', 'swift', 'm', 'mm', 'dart', 'sql', 'proto', 'graphql', 'gql') },
];
export const defaultIncludes = [...new Set(patternPresets.flatMap(preset => preset.patterns))];
export const defaultCodeIncludes = [...new Set(codePatternPresets.flatMap(preset => preset.patterns))];
/** Upgrade unchanged defaults; retain custom rules, including an empty list. */
export function effectiveIncludes(saved: readonly string[] | undefined): string[] {
  if (!saved || [legacyDefaultIncludes, legacyV2Includes].some(previous => saved.length === previous.length && previous.every(pattern => saved.includes(pattern)))) return defaultIncludes;
  return [...saved];
}
export const projectPreferenceSchema = z.object({
  include: z.array(z.string()).default(defaultIncludes), exclude: z.array(z.string()).default([]),
  codeInclude: z.array(z.string()).default(defaultCodeIncludes), codeExclude: z.array(z.string()).default([]),
});
export const preferences = defineSettings({ id: 'preferences', scope: 'host', version: 1, schema: z.object({
  projects: z.record(z.string(), projectPreferenceSchema).default({}),
}) });
export type ProjectPreference = z.infer<typeof projectPreferenceSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type Repo = z.infer<typeof repoSchema>;
export type FileEntry = z.infer<typeof entrySchema>;
export type FileContent = z.infer<typeof fileSchema>;
export type ChangedFile = z.infer<typeof changedSchema>;
export type ChangeGroup = z.infer<typeof changeGroupSchema>;
export type Changes = z.infer<typeof changesSchema>;
export type Patch = z.infer<typeof patchSchema>;
export type SearchResult = z.infer<typeof searchSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type Origin = z.infer<typeof originSchema>;
