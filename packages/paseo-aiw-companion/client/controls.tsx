import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export type PanelStyles = ReturnType<typeof makeStyles>;

export function makeStyles(theme: PluginTheme, compact: boolean) {
  return {
    screen: {
      flex: 1,
      minWidth: 0,
      padding: compact ? 10 : 14,
      gap: 10,
      backgroundColor: theme.colors.surface0,
    },
    row: {
      flexDirection: "row" as const,
      flexWrap: compact ? ("wrap" as const) : ("nowrap" as const),
      alignItems: "center" as const,
      gap: 7,
    },
    stack: { gap: 7 },
    surface: {
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
    },
    button: {
      minHeight: 30,
      paddingVertical: 6,
      paddingHorizontal: 9,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface2,
    },
    activeButton: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    text: { color: theme.colors.foreground },
    muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
    title: { color: theme.colors.foreground, fontSize: 15, fontWeight: "700" as const },
    input: {
      minHeight: 36,
      padding: 8,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface0,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 6,
    },
  };
}

export function Button({
  theme,
  label,
  text = label,
  onPress,
  active = false,
  disabled = false,
  small = false,
}: {
  theme: PluginTheme;
  label: string;
  text?: string;
  onPress(): void;
  active?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  const styles = makeStyles(theme, false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        small ? { minHeight: 26, paddingVertical: 4, paddingHorizontal: 7 } : undefined,
        active ? styles.activeButton : undefined,
        disabled ? { opacity: 0.45 } : undefined,
      ]}
    >
      <Text
        style={[
          styles.text,
          small ? { fontSize: 12 } : undefined,
          active ? { color: theme.colors.accentForeground } : undefined,
        ]}
      >
        {text}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  theme,
  label,
  icon,
  onPress,
  disabled = false,
}: {
  theme: PluginTheme;
  label: string;
  icon: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        borderRadius: 5,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
        backgroundColor: pressed ? theme.colors.surface2 : undefined,
      })}
    >
      <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

export function Empty({ theme, children }: { theme: PluginTheme; children: string }) {
  return <Text style={{ color: theme.colors.foregroundMuted, padding: 10 }}>{children}</Text>;
}
export function ErrorText({ theme, error }: { theme: PluginTheme; error: unknown }) {
  return (
    <Text style={{ color: theme.colors.statusDanger, padding: 6 }}>
      {error instanceof Error ? error.message : String(error)}
    </Text>
  );
}

export function Badge({
  theme,
  value,
  tone = "muted",
}: {
  theme: PluginTheme;
  value: string;
  tone?: "muted" | "success" | "danger" | "warning";
}) {
  const color =
    tone === "success"
      ? theme.colors.statusSuccess
      : tone === "danger"
        ? theme.colors.statusDanger
        : tone === "warning"
          ? theme.colors.statusWarning
          : theme.colors.foregroundMuted;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: color,
        borderRadius: 4,
        paddingHorizontal: 4,
        paddingVertical: 1,
      }}
    >
      <Text style={{ color, fontSize: 11 }}>{value}</Text>
    </View>
  );
}
