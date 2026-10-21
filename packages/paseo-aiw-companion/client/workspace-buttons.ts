import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { availabilityRpc } from "../shared/contracts";

// Derive host-owned types through the provided SDK instead of resolving a separate
// client package during production plugin compilation.
type Workspaces = PluginClientContext["paseo"]["workspaces"];
type PaseoWorkspaceListResult = Awaited<ReturnType<Workspaces["list"]>>;
type PaseoWorkspace = PaseoWorkspaceListResult["entries"][number];
type PaseoWorkspaceUpdate = Parameters<Parameters<Workspaces["subscribe"]>[0]>[0];

/** One host-owned observation, batched manifest checks, and exact workspace-scoped buttons. */
export function contributeWorkspaceButtons(client: PluginClientContext, title = "AIW"): () => void {
  const known = new Map<string, PaseoWorkspace>();
  const buttons = new Map<string, PluginButtonRegistration[]>();
  const pending = new Set<string>();
  const recent = new Map<string, PaseoWorkspaceUpdate>();
  let stopped = false;
  let checking = false;
  let scanning = false;
  let rescan = false;
  let unsubscribe: (() => void) | undefined;
  let release: (() => Promise<void>) | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const remove = (id: string) => {
    for (const button of buttons.get(id) ?? []) button.remove();
    buttons.delete(id);
  };
  const register = (id: string) => {
    if (buttons.has(id) || stopped) return;
    buttons.set(id, [
      client.addHeaderButton({
        id: "open-business",
        workspaceId: id,
        button: {
          title,
          label: title,
          icon: "FolderGit2",
          behavior: {
            kind: "action",
            onPress: () => client.openPanel("business", { workspaceId: id, location: "explorer" }),
          },
        },
      }),
    ]);
  };
  const flush = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      while (!stopped && pending.size) {
        const ids = [...pending].slice(0, 200);
        for (const id of ids) pending.delete(id);
        const expected = new Map(ids.map((id) => [id, known.get(id)?.workspaceDirectory]));
        const found = await client.rpc(availabilityRpc, { workspaceIds: ids });
        if (stopped) break;
        for (const item of found) {
          const workspace = known.get(item.workspaceId);
          if (
            !expected.has(item.workspaceId) ||
            !workspace ||
            workspace.workspaceDirectory !== expected.get(item.workspaceId)
          )
            continue;
          if (item.configured && item.directory === workspace.workspaceDirectory)
            register(item.workspaceId);
          else remove(item.workspaceId);
        }
      }
    } catch (error) {
      if (!stopped) console.error("AIW workspace manifest check failed", error);
    } finally {
      checking = false;
    }
  };
  const queue = (id: string) => {
    if (stopped) return;
    pending.add(id);
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void flush();
    }, 50);
  };
  const apply = (update: PaseoWorkspaceUpdate) => {
    if (update.kind === "remove") {
      known.delete(update.id);
      pending.delete(update.id);
      remove(update.id);
    } else {
      const previous = known.get(update.workspace.id);
      known.set(update.workspace.id, update.workspace);
      if (!previous || previous.workspaceDirectory !== update.workspace.workspaceDirectory) {
        remove(update.workspace.id);
        queue(update.workspace.id);
      }
    }
  };
  const scan = async (initial?: PaseoWorkspaceListResult) => {
    if (stopped) return;
    if (scanning) {
      rescan = true;
      return;
    }
    scanning = true;
    recent.clear();
    try {
      const all = new Map<string, PaseoWorkspace>();
      const visited = new Set<string>();
      let page = initial ?? (await client.paseo.workspaces.list({ page: { limit: 200 } }));
      while (!stopped) {
        for (const workspace of page.entries) all.set(workspace.id, workspace);
        if (!page.pageInfo.hasMore) break;
        const cursor = page.pageInfo.nextCursor;
        if (!cursor || visited.has(cursor)) throw new Error("Invalid workspace directory cursor");
        visited.add(cursor);
        page = await client.paseo.workspaces.list({ page: { limit: 200, cursor } });
      }
      if (stopped) return;
      for (const update of recent.values()) {
        if (update.kind === "remove") all.delete(update.id);
        else all.set(update.workspace.id, update.workspace);
      }
      for (const id of known.keys())
        if (!all.has(id)) {
          known.delete(id);
          pending.delete(id);
          remove(id);
        }
      for (const workspace of all.values()) {
        if (known.get(workspace.id)?.workspaceDirectory !== workspace.workspaceDirectory)
          remove(workspace.id);
        known.set(workspace.id, workspace);
        queue(workspace.id);
      }
    } catch (error) {
      if (!stopped) console.error("AIW workspace observation failed", error);
    } finally {
      scanning = false;
      recent.clear();
      if (rescan && !stopped) {
        rescan = false;
        void scan();
      }
    }
  };

  void client.paseo.workspaces
    .list({ subscribe: {}, page: { limit: 200 } })
    .then(({ subscription }) => {
      release = () => subscription.release();
      if (stopped) {
        void release().catch((error) => console.error("AIW observation cleanup failed", error));
        return;
      }
      unsubscribe = subscription.subscribe({
        snapshot: (snapshot) => {
          void scan(snapshot);
        },
        update: (message) => {
          if (stopped || message.type !== "workspace_update") return;
          const update = message.payload;
          if (scanning)
            recent.set(update.kind === "remove" ? update.id : update.workspace.id, update);
          apply(update);
        },
        error: (error) => {
          if (!stopped) console.error("AIW workspace observation failed", error);
        },
      });
    })
    .catch((error) => {
      if (!stopped) console.error("AIW workspace observation failed", error);
    });
  // Refresh membership and detect manifests created/deleted without a workspace event.
  const timer = setInterval(() => {
    void scan();
  }, 60_000);
  return () => {
    stopped = true;
    clearInterval(timer);
    if (debounce !== undefined) clearTimeout(debounce);
    unsubscribe?.();
    if (release)
      void release().catch((error) => console.error("AIW observation cleanup failed", error));
    for (const id of buttons.keys()) remove(id);
    known.clear();
    pending.clear();
    recent.clear();
  };
}
