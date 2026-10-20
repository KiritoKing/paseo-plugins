import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { BusinessPanel, SearchPanel } from "./client/aiw";
import { type FileLocator, requestFile } from "./client/navigation";
import { contributeWorkspaceButtons } from "./client/workspace-buttons";

export default function contribute(client: PluginClientContext) {
  function Business(props: PluginWorkspacePanelProps) {
    return <BusinessPanel {...props} />;
  }
  function Search(props: PluginWorkspacePanelProps) {
    return (
      <SearchPanel
        {...props}
        openBusiness={(locator: FileLocator) => {
          requestFile(locator);
          client.openPanel("business", { workspaceId: locator.workspaceId, location: "explorer" });
        }}
      />
    );
  }
  const cleanup = [
    client.addWorkspacePanel({
      id: "business",
      title: "AIW 业务仓",
      icon: "FolderGit2",
      context: "workspace",
      locations: ["workspace", "explorer"],
      Component: Business,
    }),
    client.addWorkspacePanel({
      id: "search",
      title: "AIW 跨仓搜索",
      icon: "Search",
      context: "workspace",
      locations: ["workspace", "explorer"],
      Component: Search,
    }),
    client.addCommandCenterItem({
      id: "aiw-business",
      title: "AIW 业务仓",
      icon: "FolderGit2",
      context: "workspace",
      keywords: ["aiw", "business", "repo"],
      onSelect: (context) => context.openPanel("business"),
    }),
    client.addCommandCenterItem({
      id: "aiw-search",
      title: "AIW 跨仓搜索",
      icon: "Search",
      context: "workspace",
      keywords: ["aiw", "search"],
      onSelect: (context) => context.openPanel("search"),
    }),
    client.addSlashCommand({
      name: "aiw",
      description: "打开 AIW 业务仓",
      argumentHint: "",
      context: "workspace",
      onSubmit: (context) => context.openPanel("business"),
    }),
    client.addSlashCommand({
      name: "aiw-search",
      description: "打开 AIW 跨仓搜索",
      argumentHint: "",
      context: "workspace",
      onSubmit: (context) => context.openPanel("search"),
    }),
  ];
  cleanup.push(contributeWorkspaceButtons(client));
  return () => {
    for (const dispose of cleanup) void dispose();
  };
}
