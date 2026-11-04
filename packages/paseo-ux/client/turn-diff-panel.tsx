import type { RpcOutput } from "@getpaseo/plugin";
import {
  type PluginAgentPanelProps,
  type PluginHostProps,
  usePaseo,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { mediaSettings } from "../shared/contracts";
import { listTurnChanges, readTurnDiff, type TurnSummary } from "../shared/turn-diff";
import { diffRows } from "../shared/turn-diff-presentation";
import { FileChange } from "./turn-diff-file";
import type { TurnSelections } from "./turn-diff-selection";

type PanelProps = PluginAgentPanelProps & {
  selections: TurnSelections;
  onOpenSettings: () => void;
};

function Action({
  title,
  theme,
  onPress,
  disabled = false,
}: {
  title: string;
  theme: PluginHostProps["theme"];
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: "center" }}
    >
      <Text style={{ color: disabled ? theme.colors.foregroundMuted : theme.colors.accent }}>
        {title}
      </Text>
    </Pressable>
  );
}

export function TurnChangesPanel(props: PanelProps) {
  const settings = useSettings(mediaSettings);
  if (settings.status !== "ready" || !settings.values.turnDiffEnabled) {
    return (
      <View style={{ padding: 20, gap: 12, backgroundColor: props.theme.colors.surface0 }}>
        <Text style={{ color: props.theme.colors.foreground }}>
          {settings.status === "loading"
            ? "Loading preferences…"
            : settings.status === "ready"
              ? "Turn changes are turned off."
              : settings.error}
        </Text>
        <Action
          title="Open Essentials Features"
          theme={props.theme}
          onPress={props.onOpenSettings}
        />
      </View>
    );
  }
  return <TurnHistory key={`${props.host.id}:${props.agentId}`} {...props} />;
}

function TurnHistory({ agentId, host, theme, layout, selections }: PanelProps) {
  const subscribe = useCallback(
    (listener: () => void) => selections.subscribe(agentId, listener),
    [selections, agentId],
  );
  const snapshot = useCallback(() => selections.get(agentId), [selections, agentId]);
  const selected = useSyncExternalStore(subscribe, snapshot, snapshot);
  const list = useRpc(listTurnChanges);
  const read = useRpc(readTurnDiff);
  const paseo = usePaseo();
  const cache = useQueryClient();
  const [connectionError, setConnectionError] = useState(false);
  const history = useInfiniteQuery({
    queryKey: ["essentials.turn-history", host.id, agentId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => list({ agentId, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !selected.turnId,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["essentials.turn-detail", host.id, agentId, selected.turnId],
    queryFn: () => list({ agentId, turnId: selected.turnId! }),
    enabled: !!selected.turnId,
    staleTime: Infinity,
    retry: false,
  });
  const diff = useQuery({
    queryKey: ["essentials.turn-diff", host.id, agentId, selected.turnId, selected.path],
    queryFn: () => read({ agentId, turnId: selected.turnId!, path: selected.path! }),
    enabled: !!selected.turnId && !!selected.path,
    // A saved snapshot is immutable; only an explicit retry should replace an error.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    // Image payloads should leave the cache promptly when the preview closes.
    gcTime: 0,
  });
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: ["essentials.turn-history", host.id, agentId] });
    };
    const stop = paseo.agents.ref(agentId).timeline.subscribe((event) => {
      if (disposed) return;
      if (event.event.type === "error") {
        setConnectionError(true);
        return;
      }
      setConnectionError(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 600);
    });
    void stop.ready.catch(() => {
      if (!disposed) setConnectionError(true);
    });
    return () => {
      disposed = true;
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [agentId, cache, host.id, paseo]);

  const current = detail.data?.turns[0];
  const turns = history.data?.pages.flatMap((page) => page.turns) ?? [];
  const request = selected.turnId ? detail : history;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 12 : 18, gap: 12 }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Text
          accessibilityRole="header"
          style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "600" }}
        >
          {selected.turnId ? "Turn changes" : "All turns"}
        </Text>
        {selected.turnId ? (
          <Action
            title="All turns"
            theme={theme}
            onPress={() => selections.select(agentId, null)}
          />
        ) : null}
        <Action
          title="Refresh turn changes"
          theme={theme}
          disabled={request.isFetching}
          onPress={() => {
            void request.refetch();
            if (selected.path) void diff.refetch();
          }}
        />
      </View>
      {connectionError ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>
          Live updates are unavailable. Refresh to check saved changes.
        </Text>
      ) : null}
      {request.isPending ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>Loading turn changes…</Text>
      ) : null}
      {request.error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
          {request.error.message}
        </Text>
      ) : null}
      {!selected.turnId && !history.isPending && !history.error && !turns.length ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          No recorded changes. Future turns in a Git repository with an existing commit appear here
          when they change files or create commits.
        </Text>
      ) : null}
      {!selected.turnId
        ? turns.map((turn) => (
            <Pressable
              key={turn.id}
              accessibilityRole="button"
              accessibilityLabel={`Open turn ${turn.id}`}
              onPress={() => selections.select(agentId, turn.id)}
              style={{
                padding: 14,
                gap: 6,
                borderRadius: 10,
                backgroundColor: theme.colors.surface1,
              }}
            >
              <Text style={{ color: theme.colors.foreground }}>
                {new Date(turn.endedAt).toLocaleString()}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted }}>
                {turn.totalFiles} files · {turn.commits.length} commits · {turn.outcome}
              </Text>
              {turn.commits[0] ? (
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {turn.commits[0].subject}
                </Text>
              ) : null}
            </Pressable>
          ))
        : null}
      {!selected.turnId && history.hasNextPage ? (
        <Action
          title="Load older turns"
          theme={theme}
          disabled={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        />
      ) : null}
      {selected.turnId && !detail.isPending && !detail.error && !current ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          This turn is no longer retained. Open All turns to view saved history.
        </Text>
      ) : null}
      {selected.turnId && current ? (
        <TurnDetails
          turn={current}
          selectedPath={selected.path}
          theme={theme}
          onSelect={(path) => selections.select(agentId, current.id, path)}
        />
      ) : null}
      {selected.turnId && selected.path ? (
        <View style={{ gap: 10 }}>
          <Text selectable style={{ color: theme.colors.foreground, fontWeight: "600" }}>
            {selected.path}
          </Text>
          {diff.isPending ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>Loading saved diff…</Text>
          ) : null}
          {diff.error ? (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
                {diff.error.message}
              </Text>
              <Action title="Retry saved diff" theme={theme} onPress={() => void diff.refetch()} />
            </View>
          ) : null}
          {diff.data ? (
            <SavedDiff value={diff.data} theme={theme} compact={layout.compact} />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function TurnDetails({
  turn,
  selectedPath,
  theme,
  onSelect,
}: {
  turn: TurnSummary;
  selectedPath: string | null;
  theme: PluginHostProps["theme"];
  onSelect: (path: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>
        {new Date(turn.endedAt).toLocaleString()} · {turn.outcome} · {turn.totalFiles} files
      </Text>
      {turn.warnings.map((warning) => (
        <Text key={warning} style={{ color: theme.colors.statusWarning }}>
          {warning}
        </Text>
      ))}
      {turn.files.map((file) => (
        <FileChange
          key={file.path}
          file={file}
          theme={theme}
          selected={selectedPath === file.path}
          onPress={() => onSelect(file.path)}
        />
      ))}
      {turn.totalFiles > turn.files.length ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          Only {turn.files.length} of {turn.totalFiles} files are listed.
        </Text>
      ) : null}
      {turn.commits.map((commit) => (
        <Text key={commit.sha} selectable style={{ color: theme.colors.foregroundMuted }}>
          {commit.sha.slice(0, 8)} {commit.subject}
        </Text>
      ))}
    </View>
  );
}

export function SavedDiff({
  value,
  theme,
  compact,
}: {
  value: RpcOutput<typeof readTurnDiff>;
  theme: PluginHostProps["theme"];
  compact: boolean;
}) {
  const parsed = useMemo(() => diffRows(value.patch), [value.patch]);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const images = [
    { title: "Before", uri: value.beforeUri },
    { title: "After", uri: value.afterUri },
  ];
  return (
    <View style={{ gap: 10 }}>
      {value.notice ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>{value.notice}</Text>
      ) : null}
      {value.kind === "image" ? (
        <View style={{ flexDirection: compact ? "column" : "row", gap: 12 }}>
          {images.map(({ title, uri }) => (
            <View key={title} style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <Text style={{ color: theme.colors.foregroundMuted }}>{title}</Text>
              {uri && !failedImages.includes(uri) ? (
                <Image
                  accessibilityLabel={`${title} image`}
                  source={{ uri }}
                  resizeMode="contain"
                  onError={() => setFailedImages((previous) => [...previous, uri])}
                  style={{
                    height: compact ? 200 : 260,
                    width: "100%",
                    backgroundColor: theme.colors.surface1,
                  }}
                />
              ) : (
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {uri ? "Image preview unavailable." : "No image on this side."}
                </Text>
              )}
            </View>
          ))}
        </View>
      ) : null}
      {value.kind === "image" && failedImages.length ? (
        <Action title="Retry image previews" theme={theme} onPress={() => setFailedImages([])} />
      ) : null}
      {value.kind === "binary" ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          Binary file changed. No text diff is available.
        </Text>
      ) : null}
      {value.kind === "unavailable" ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          No saved diff is available for this file.
        </Text>
      ) : null}
      {value.kind === "text" && !value.patch ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          No text changes in the saved snapshots.
        </Text>
      ) : null}
      {value.kind === "text" && value.patch ? (
        <ScrollView
          horizontal
          style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 }}
        >
          <View style={{ padding: 10 }}>
            {parsed.rows.map((row) => (
              <Text
                key={`${row.kind}:${row.before}:${row.after}:${row.text}`}
                testID="turn-diff-row"
                selectable
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  lineHeight: 19,
                  color:
                    row.kind === "added"
                      ? theme.colors.statusSuccess
                      : row.kind === "removed"
                        ? theme.colors.statusDanger
                        : row.kind === "header"
                          ? theme.colors.foregroundMuted
                          : theme.colors.foreground,
                }}
              >
                {String(row.before ?? "").padStart(5)} {String(row.after ?? "").padStart(5)}{" "}
                {row.text}
              </Text>
            ))}
          </View>
        </ScrollView>
      ) : null}
      {value.truncated || parsed.truncated ? (
        <Text style={{ color: theme.colors.statusWarning }}>
          Diff preview truncated. At most 200,000 characters and 2,000 rows are shown.
        </Text>
      ) : null}
    </View>
  );
}
