import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { BusinessPanel } from "./client/aiw";
import { requestSearchFocus } from "./client/navigation";
import { DisplaySettings } from "./client/settings";
import { contributeWorkspaceButtons } from "./client/workspace-buttons";
import { displayRpcs, displaySchema } from "./shared/display";

export default function contribute(client: PluginClientContext) {
  let stopped = false;
  const cleanup = [
    client.addSettingsScreen({
      id: "display",
      title: "AIW 面板",
      icon: "FolderGit2",
      Component: DisplaySettings,
    }),
  ];
  function Business(props: PluginWorkspacePanelProps) {
    return <BusinessPanel key={props.workspaceId} {...props} />;
  }
  // Panel titles are static in the SDK. Read the saved name once per plugin activation.
  const register = (title: string) => {
    if (stopped) return;
    cleanup.push(
      // Keep the business identity so existing business tabs and saved layouts survive.
      client.addWorkspacePanel({
        id: "business",
        title,
        icon: "FolderGit2",
        context: "workspace",
        locations: ["workspace", "explorer"],
        Component: Business,
      }),
      client.addCommandCenterItem({
        id: "aiw-business",
        title,
        icon: "FolderGit2",
        context: "workspace",
        keywords: ["aiw", "business", "repo"],
        onSelect: (context) => context.openPanel("business"),
      }),
      client.addCommandCenterItem({
        id: "aiw-search",
        title: "AIW 搜索",
        icon: "Search",
        context: "workspace",
        keywords: ["aiw", "search"],
        onSelect: (context) => {
          context.openPanel("business");
          requestSearchFocus(context.workspace.id);
        },
      }),
      client.addSlashCommand({
        name: "aiw",
        description: "打开 AIW 面板",
        argumentHint: "",
        context: "workspace",
        onSubmit: (context) => context.openPanel("business"),
      }),
      client.addSlashCommand({
        name: "aiw-search",
        description: "聚焦 AIW 搜索栏",
        argumentHint: "",
        context: "workspace",
        onSubmit: (context) => {
          context.openPanel("business");
          requestSearchFocus(context.workspace.id);
        },
      }),
      contributeWorkspaceButtons(client, title),
    );
  };
  const title = client.rpc(displayRpcs.read, {}).then(
    (snapshot) => {
      const parsed = snapshot.status === "ready" ? displaySchema.safeParse(snapshot.values) : null;
      return parsed?.success ? parsed.data.tabTitle : "AIW";
    },
    (error) => {
      console.error("AIW display settings could not be loaded", error);
      return "AIW";
    },
  );
  void title.then(register).catch((error) => console.error("AIW panel registration failed", error));
  return () => {
    stopped = true;
    for (const dispose of cleanup) void dispose();
  };
}
