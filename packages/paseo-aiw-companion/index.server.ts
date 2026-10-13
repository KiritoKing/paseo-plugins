import type { PluginServerContext, PluginHandlerContext } from '@getpaseo/plugin/server';
import { availabilityRpc, catalogRpc, treeRpc, fileRpc, changesRpc, patchRpc, searchRpc, preferences } from './shared/contracts';
import { layoutPreferences } from './shared/layout';
import { hasAiwConfig } from './server/availability';
import { catalog, tree, readFile, changes, patch, search, stopSearches } from './server/service';

async function workspaceRoot(workspaceId: string, { paseo }: PluginHandlerContext): Promise<string> {
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new Error('当前工作区已不可用，请重新打开工作区。');
  return workspace.workspaceDirectory;
}

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  server.registerSettings(layoutPreferences);
  server.handle(availabilityRpc, async ({ workspaceIds }, { paseo }) => {
    const requested = new Set(workspaceIds);
    const roots = new Map<string, string>();
    let cursor: string | undefined;
    const visited = new Set<string>();
    do {
      const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
      for (const entry of page.entries) if (requested.has(entry.id) && entry.workspaceDirectory) roots.set(entry.id, entry.workspaceDirectory);
      if (roots.size === requested.size || !page.pageInfo.hasMore) break;
      const next = page.pageInfo.nextCursor;
      if (!next || visited.has(next)) throw new Error('工作区分页游标无效，请稍后重试。');
      visited.add(next); cursor = next;
    } while (true);
    return [...requested].map(workspaceId => {
      const directory = roots.get(workspaceId) ?? null;
      return { workspaceId, directory, configured: directory !== null && hasAiwConfig(directory) };
    });
  });
  server.handle(catalogRpc, async (input, context) => catalog(await workspaceRoot(input.workspaceId, context)));
  server.handle(treeRpc, async (input, context) => tree(await workspaceRoot(input.workspaceId, context), input.repoId, input.path, input.showIgnored));
  server.handle(fileRpc, async (input, context) => readFile(await workspaceRoot(input.workspaceId, context), input.repoId, input.path, input.startLine));
  server.handle(changesRpc, async (input, context) => changes(await workspaceRoot(input.workspaceId, context), input.scope, input.baselineOverride));
  server.handle(patchRpc, async (input, context) => patch(await workspaceRoot(input.workspaceId, context), input.repoId, input.path, input.oldPath, input.origin, input.scope, input.expectedSnapshot, input.baselineOverride));
  server.handle(searchRpc, async (input, context) => search(await workspaceRoot(input.workspaceId, context), input.repoIds, input.query, input.regex, input.caseSensitive, input.include, input.exclude));
  console.log('AIW Companion read-only handlers registered');
  return () => { stopSearches(); };
}
