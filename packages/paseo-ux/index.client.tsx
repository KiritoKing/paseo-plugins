import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { makeMediaAnchor } from "./client/anchor";
import { MediaPanel } from "./client/panel";
import { makeSessionControls } from "./client/session-controls";
import { createSessionDialogs } from "./client/session-dialogs";
import { makeSessionOpener } from "./client/session-opener";
import { MediaSettings } from "./client/settings";
import { cleanupInlineMedia } from "./client/web";
import { clientDiagnostics } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const dialogs = createSessionDialogs();
  const history = (workspaceId: string, latest = false) => dialogs.open(workspaceId, latest);
  const openAgent = (agentId: string) =>
    client.openScreen({ screenId: "sessions", params: { agentId, request: String(Date.now()) } });
  const SessionIcon = makeSessionControls(dialogs, openAgent);
  const cleanups = [
    client.addScreen({
      id: "sessions",
      title: "正在打开会话",
      Component: makeSessionOpener(dialogs),
    }),
    client.addCommandCenterItem({
      id: "sessions",
      title: "Paseo UX · 恢复工作区会话",
      icon: "History",
      context: "workspace",
      onSelect: ({ workspace }) => history(workspace.id),
    }),
    client.addWorkspacePanel({
      id: "media",
      title: "会话媒体",
      icon: "Images",
      context: "agent",
      locations: ["workspace", "explorer"],
      Component: MediaPanel,
    }),
    client.addSettingsScreen({
      id: "media",
      title: "媒体预览增强",
      icon: "Images",
      Component: MediaSettings,
    }),
    client.addCommandCenterItem({
      id: "media",
      title: "Paseo UX · 会话媒体",
      icon: "Images",
      keywords: ["图片", "媒体", "gallery", "preview"],
      context: "agent",
      onSelect: ({ openPanel }) => openPanel("media", { location: "explorer" }),
    }),
    client.addSlashCommand({
      name: "media",
      argumentHint: "",
      description: "打开当前会话媒体面板",
      context: "agent",
      onSubmit: ({ openPanel }) => openPanel("media", { location: "explorer" }),
    }),
  ];
  void client.rpc(clientDiagnostics, { event: "registered" }).catch(() => {});
  let disposed = false;
  const headerButtons = new Map<string, PluginButtonRegistration>();
  const syncWorkspace = (workspace: { id: string }) => {
    if (!headerButtons.has(workspace.id))
      headerButtons.set(
        workspace.id,
        client.addHeaderButton({
          id: "sessions",
          workspaceId: workspace.id,
          button: {
            title: "恢复工作区会话",
            label: "会话",
            icon: SessionIcon,
            behavior: { kind: "action", onPress: () => history(workspace.id, false) },
          },
        }),
      );
  };
  const removeWorkspaceEvents = client.paseo.workspaces.subscribe((update) => {
    if (disposed) return;
    if (update.kind === "upsert") syncWorkspace(update.workspace);
    else {
      headerButtons.get(update.id)?.remove();
      headerButtons.delete(update.id);
      dialogs.remove(update.id);
    }
  });
  let releaseWorkspaces: (() => void) | undefined;
  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then((result) => {
      if (disposed) {
        result.subscription.release();
        return;
      }
      releaseWorkspaces = () => void result.subscription.release();
      result.entries.forEach(syncWorkspace);
    })
    .catch(() => {});
  const pills = new Map<string, { workspaceId: string; registration: PluginButtonRegistration }>();
  const openPanel = (workspaceId: string, agentId: string) =>
    client.openPanel("media", { workspaceId, agentId, location: "explorer" });
  const Anchor = makeMediaAnchor(openPanel);
  const sync = (agent: { id: string; workspaceId?: string; archivedAt?: string | null }) => {
    const current = pills.get(agent.id);
    if (agent.archivedAt || !agent.workspaceId) {
      current?.registration.remove();
      pills.delete(agent.id);
      return;
    }
    if (current?.workspaceId === agent.workspaceId) return;
    current?.registration.remove();
    const workspaceId = agent.workspaceId;
    pills.set(agent.id, {
      workspaceId,
      registration: client.addComposerPill({
        id: "media",
        workspaceId,
        agentId: agent.id,
        button: {
          title: "会话媒体",
          label: "媒体",
          icon: Anchor,
          behavior: { kind: "action", onPress: () => openPanel(workspaceId, agent.id) },
        },
      }),
    });
  };
  const removeAgentEvents = client.paseo.agents.subscribe((update) => {
    if (disposed) return;
    if (update.kind === "upsert") sync(update.agent);
    else {
      pills.get(update.agentId)?.registration.remove();
      pills.delete(update.agentId);
    }
  });
  let releaseDirectory: (() => void) | undefined;
  void client.paseo.agents
    .list({ page: { limit: 200 }, subscribe: {} })
    .then((result) => {
      if (disposed) {
        result.subscription.release();
        return;
      }
      releaseDirectory = () => void result.subscription.release();
      result.entries.forEach((entry) => {
        sync(entry.agent);
      });
      void client
        .rpc(clientDiagnostics, { event: "pills", detail: String(pills.size) })
        .catch(() => {});
    })
    .catch((error) => {
      void client
        .rpc(clientDiagnostics, {
          event: "directory-error",
          detail: error instanceof Error ? error.message : "unknown error",
        })
        .catch(() => {});
    });
  return () => {
    disposed = true;
    dialogs.dispose();
    removeWorkspaceEvents();
    releaseWorkspaces?.();
    for (const button of headerButtons.values()) button.remove();
    headerButtons.clear();
    removeAgentEvents();
    releaseDirectory?.();
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
    cleanupInlineMedia();
    for (const cleanup of cleanups) cleanup();
  };
}
