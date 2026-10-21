import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useSyncExternalStore } from "react";
import { View } from "react-native";
import type { SessionDialogs } from "./session-dialogs";
import { SessionHistory } from "./sessions";

export function makeSessionControls(
  dialogs: SessionDialogs,
  onOpenAgent: (agentId: string) => void,
) {
  return function SessionControls(props: PluginButtonIconProps) {
    const subscribe = useCallback(
      (listener: () => void) => dialogs.subscribe(props.workspaceId, listener),
      [props.workspaceId],
    );
    const snapshot = useCallback(() => dialogs.get(props.workspaceId), [props.workspaceId]);
    const request = useSyncExternalStore(subscribe, snapshot, snapshot);
    return (
      <View>
        <Icon name="History" size={props.size} color={props.color} />
        {request ? (
          <SessionHistory
            key={request.id}
            workspaceId={props.workspaceId}
            latest={request.latest}
            theme={props.theme}
            onClose={() => dialogs.close(props.workspaceId, request.id)}
            onOpenAgent={onOpenAgent}
          />
        ) : null}
      </View>
    );
  };
}
