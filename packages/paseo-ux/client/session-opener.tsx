import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useLayoutEffect, useRef } from "react";
import { Text } from "react-native";
import type { SessionDialogs } from "./session-dialogs";

// Header icons have no navigation capability. Hand off only after selection to a
// navigable SDK surface, before paint; selection itself stays over the workspace.
export function makeSessionOpener(dialogs: SessionDialogs) {
  return function SessionOpener({ params, host, navigation, theme }: PluginScreenProps) {
    const handled = useRef("");
    const key = JSON.stringify([host.id, params.agentId, params.workspaceId, params.request]);
    const available = !!navigation && (!!params.agentId || !!params.workspaceId);
    useLayoutEffect(() => {
      if (!available || !navigation || handled.current === key) return;
      handled.current = key;
      if (params.agentId) {
        navigation.openAgent({ agentId: params.agentId, serverId: host.id });
        return;
      }
      // Upgrade an already-open legacy full-page picker back to its workspace.
      navigation.openWorkspace({ workspaceId: params.workspaceId, serverId: host.id });
      dialogs.open(params.workspaceId, params.restore === "last");
    }, [key, available, navigation, host.id, params.agentId, params.workspaceId, params.restore]);
    return available ? null : (
      <Text style={{ padding: 20, color: theme.colors.statusDanger }}>
        当前客户端无法打开会话，请升级 Paseo。
      </Text>
    );
  };
}
