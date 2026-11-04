import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import type { TurnFile } from "../shared/turn-diff";

export function FileChange({
  file,
  theme,
  selected,
  onPress,
}: {
  file: TurnFile;
  theme: PluginHostProps["theme"];
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View changes: ${file.path}`}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        padding: 10,
        gap: 4,
        borderRadius: 8,
        backgroundColor: selected ? theme.colors.surface2 : theme.colors.surface1,
      }}
    >
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1 }}>
        {file.oldPath ? `${file.oldPath} → ` : ""}
        {file.path}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{file.status}</Text>
        {file.binary ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Binary</Text>
        ) : (
          <>
            <Text style={{ color: theme.colors.statusSuccess, fontSize: 12 }}>+{file.added}</Text>
            <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>−{file.removed}</Text>
          </>
        )}
        {!file.diffAvailable ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>No saved diff</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
