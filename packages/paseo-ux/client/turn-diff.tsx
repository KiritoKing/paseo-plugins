import {
  type PluginClientContext,
  type PluginTimelineItemProps,
  useAgent,
  useSettings,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { mediaSettings } from "../shared/contracts";
import { type TurnCard, turnCardSchema } from "../shared/turn-diff";
import { FileChange } from "./turn-diff-file";
import { TurnChangesPanel } from "./turn-diff-panel";
import { createTurnSelections } from "./turn-diff-selection";

export function TurnChangesCard({
  item,
  theme,
  onSelect,
}: PluginTimelineItemProps<TurnCard> & { onSelect: (turnId: string, path?: string) => void }) {
  const data = item.data;
  return (
    <View
      style={{
        padding: 14,
        gap: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 12,
        backgroundColor: theme.colors.surface0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Icon name="GitCompareArrows" size={18} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Turn changes</Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {data.totalFiles} files · {data.totalCommits} commits
        </Text>
      </View>
      {data.warnings.map((warning) => (
        <Text key={warning} style={{ color: theme.colors.statusWarning }}>
          {warning}
        </Text>
      ))}
      {data.files.map((file) => (
        <FileChange
          key={file.path}
          file={file}
          theme={theme}
          onPress={() => onSelect(data.turnId, file.path)}
        />
      ))}
      {data.commits.map((commit) => (
        <Text key={commit.sha} selectable style={{ color: theme.colors.foregroundMuted }}>
          {commit.sha.slice(0, 8)} {commit.subject}
        </Text>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View all turn changes"
        onPress={() => onSelect(data.turnId)}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: theme.colors.accent }}>View all changes</Text>
      </Pressable>
    </View>
  );
}

export function registerTurnChanges(client: PluginClientContext) {
  const selections = createTurnSelections();
  let stopCommand: (() => void | Promise<void>) | undefined;
  let enabled = false;
  let disposed = false;
  function Card(props: PluginTimelineItemProps<TurnCard>) {
    const settings = useSettings(mediaSettings);
    const workspaceId = useAgent(props.agentId, (agent) => agent.workspaceId);
    if (settings.status !== "ready" || !settings.values.turnDiffEnabled || !workspaceId)
      return null;
    return (
      <TurnChangesCard
        {...props}
        onSelect={(turnId, path) => {
          selections.select(props.agentId, turnId, path);
          client.openPanel("turn-changes", { workspaceId, agentId: props.agentId });
        }}
      />
    );
  }
  const removers = [
    client.addWorkspacePanel({
      id: "turn-changes",
      title: "Turn changes",
      icon: "GitCompareArrows",
      context: "agent",
      locations: ["workspace", "explorer"],
      Component: (props) => (
        <TurnChangesPanel
          {...props}
          selections={selections}
          onOpenSettings={() => client.openSettings("media")}
        />
      ),
    }),
    client.addTimelineRenderer({
      kind: "turn-changes",
      version: 1,
      schema: turnCardSchema,
      Component: Card,
    }),
  ];
  return {
    update(next: boolean) {
      if (disposed || next === enabled) return;
      enabled = next;
      if (next) {
        stopCommand = client.addCommandCenterItem({
          id: "turn-changes",
          title: "Essentials · Open turn changes",
          icon: "GitCompareArrows",
          keywords: ["git", "diff", "commits", "history", "变更", "回合"],
          context: "agent",
          onSelect: ({ agent, openPanel }) => {
            selections.select(agent.id, null);
            openPanel("turn-changes");
          },
        });
      } else {
        void stopCommand?.();
        stopCommand = undefined;
        selections.clear();
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await stopCommand?.();
      selections.dispose();
      await Promise.allSettled(removers.reverse().map((remove) => Promise.resolve().then(remove)));
    },
  };
}
