import { useEffect, useState, useRef } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { View, Text, Pressable } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  listSessions,
  restoreSession,
  orderedClosed,
  isClosed,
  type WorkspaceSession,
} from "../shared/sessions";

export function SessionHistory({
  workspaceId,
  latest,
  theme,
  onClose,
  onOpenAgent,
}: {
  workspaceId: string;
  latest: boolean;
  theme: PluginTheme;
  onClose: () => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const list = useRpc(listSessions);
  const restore = useRpc(restoreSession);
  const [workspaceName, setWorkspaceName] = useState("当前工作区");
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const generation = useRef(0);
  const busyRef = useRef(false);
  const open = async (agentId?: string, epoch = generation.current) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(agentId ?? "latest");
    setError("");
    try {
      const result = await restore({ workspaceId, ...(agentId ? { agentId } : {}) });
      if (generation.current === epoch) {
        onClose();
        onOpenAgent(result.agentId);
      }
    } catch (cause) {
      if (generation.current === epoch)
        setError(cause instanceof Error ? cause.message : "会话恢复失败");
    } finally {
      busyRef.current = false;
      if (generation.current === epoch) setBusy(null);
    }
  };
  useEffect(() => {
    const epoch = ++generation.current;
    let live = true;
    setBusy(null);
    setLoading(true);
    setWorkspaceName("当前工作区");
    setSessions([]);
    setError("");
    void list({ workspaceId })
      .then((result) => {
        if (!live) return;
        setSessions(result.sessions);
        setWorkspaceName(result.workspaceName);
        if (latest) void open(undefined, epoch);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : "会话列表读取失败");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      generation.current++;
    };
  }, [workspaceId, latest, list]);
  const refresh = () => {
    const epoch = generation.current;
    setLoading(true);
    void list({ workspaceId })
      .then((result) => {
        if (generation.current !== epoch) return;
        setSessions(result.sessions);
        setWorkspaceName(result.workspaceName);
        setError("");
      })
      .catch((cause) => {
        if (generation.current === epoch)
          setError(cause instanceof Error ? cause.message : "会话列表读取失败");
      })
      .finally(() => {
        if (generation.current === epoch) setLoading(false);
      });
  };
  const shown = sessions.filter((session) =>
    `${session.title} ${session.provider}`.toLowerCase().includes(search.toLowerCase()),
  );
  const closed = orderedClosed(shown, false);
  const current = shown.filter((session) => !isClosed(session));
  const row = (session: WorkspaceSession) => (
    <Pressable
      key={session.id}
      accessibilityRole="button"
      accessibilityLabel={`恢复会话 ${session.title}`}
      disabled={!!busy || (!session.canRestore && isClosed(session))}
      onPress={() => void open(session.id)}
      style={{
        padding: 14,
        gap: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        opacity: !session.canRestore && isClosed(session) ? 0.5 : 1,
      }}
    >
      <Text numberOfLines={2} style={{ color: theme.colors.foreground, fontSize: 14 }}>
        {session.title}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        {session.provider} · {isClosed(session) ? "已关闭" : "可直接打开"} ·{" "}
        {new Date(session.archivedAt ?? session.updatedAt).toLocaleString()}
      </Text>
      {busy === session.id ? (
        <Text style={{ color: theme.colors.accent }}>正在恢复原会话…</Text>
      ) : null}
    </Pressable>
  );
  return (
    <Modal
      title="恢复工作区会话"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content
        scrollable={false}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        style={{ backgroundColor: theme.colors.surface0 }}
      >
        <View
          testID="paseo-ux-session-history"
          style={{
            minHeight: 280,
            maxHeight: 520,
            gap: 14,
            backgroundColor: theme.colors.surface0,
          }}
        >
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
          >
            <View>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {workspaceName} · {sessions.length} 个会话
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新会话列表"
              onPress={refresh}
              disabled={loading}
            >
              <Icon name="RefreshCw" size={18} color={theme.colors.foreground} />
            </Pressable>
          </View>
          <TextInput
            autoFocus
            value={search}
            onChangeText={setSearch}
            placeholder="搜索会话名称或 provider"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{
              padding: 10,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 8,
              color: theme.colors.foreground,
            }}
          />
          {busy === "latest" ? (
            <Text style={{ color: theme.colors.foreground }}>正在恢复刚关闭的会话…</Text>
          ) : null}
          {error ? <Text style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }}>
            {loading ? (
              <Text style={{ color: theme.colors.foregroundMuted }}>正在读取当前工作区的会话…</Text>
            ) : null}
            <Text style={{ color: theme.colors.foregroundMuted }}>最近关闭 · {closed.length}</Text>
            {closed.map(row)}
            <Text style={{ color: theme.colors.foregroundMuted }}>当前会话 · {current.length}</Text>
            {current.map(row)}
            {!loading && !shown.length ? (
              <Text style={{ color: theme.colors.foregroundMuted }}>没有匹配的会话</Text>
            ) : null}
          </ScrollView>
        </View>
      </Modal.Content>
    </Modal>
  );
}
