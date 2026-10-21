import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { displayPreferences, displaySchema } from "../shared/display";
import { Button, Empty, ErrorText, makeStyles } from "./controls";

export function DisplaySettings({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(displayPreferences);
  const [draft, setDraft] = useState<{ tabTitle: string; revision: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const styles = makeStyles(theme, layout.compact);
  useEffect(() => {
    if (settings.status === "ready")
      setDraft(
        (current) => current ?? { tabTitle: settings.values.tabTitle, revision: settings.revision },
      );
  }, [settings]);
  if (settings.status === "loading" || (settings.status === "ready" && !draft))
    return <Empty theme={theme}>正在读取 AIW 设置…</Empty>;
  if (settings.status !== "ready" || !draft)
    return (
      <ErrorText
        theme={theme}
        error={
          settings.status === "error" || settings.status === "invalid"
            ? settings.error
            : "设置尚未准备好"
        }
      />
    );
  const save = async () => {
    const parsed = displaySchema.safeParse({ tabTitle: draft.tabTitle });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0].message);
      return;
    }
    if (await settings.save(parsed.data, draft.revision)) {
      setDraft(null);
      setMessage("已保存。重载 AIW Companion 插件后，Tab 和工作区入口使用新名称。");
    }
  };
  return (
    <View style={{ gap: 10, padding: 16 }}>
      <Text style={styles.title}>AIW 面板</Text>
      <Text style={styles.text}>Tab 名称</Text>
      <TextInput
        accessibilityLabel="AIW Tab 名称"
        value={draft.tabTitle}
        onChangeText={(tabTitle) => {
          setDraft({ ...draft, tabTitle });
          setMessage(null);
        }}
        placeholder="AIW"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.input}
      />
      <Text style={styles.muted}>默认 AIW。同一 host 的工作区共用此名称，保存后重载插件生效。</Text>
      <Button
        theme={theme}
        label="保存 Tab 名称"
        onPress={() => void save()}
        disabled={settings.saving}
        active
      />
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {message}
        </Text>
      ) : null}
      {settings.saveError ? <ErrorText theme={theme} error={settings.saveError} /> : null}
    </View>
  );
}
