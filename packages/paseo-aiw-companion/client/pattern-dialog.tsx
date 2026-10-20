import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  type Catalog,
  type ChangeGroup,
  codePatternPresets,
  defaultCodeIncludes,
  effectiveIncludes,
  type ProjectPreference,
  patternPresets,
  preferences,
} from "../shared/contracts";
import type { PatternKind } from "../shared/file-filters";
import { matchesPatterns } from "../shared/patterns";
import { Button, ErrorText, makeStyles } from "./controls";

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}
function countMatches(groups: ChangeGroup[], include: string[], exclude: string[]): number {
  return groups.reduce(
    (total, group) =>
      total +
      group.files.filter((file) => matchesPatterns(file.path, file.oldPath, include, exclude))
        .length,
    0,
  );
}
type Draft = Record<PatternKind, { include: string; exclude: string }>;
function draftFrom(saved?: ProjectPreference): Draft {
  return {
    documents: {
      include: effectiveIncludes(saved?.include).join("\n"),
      exclude: (saved?.exclude ?? []).join("\n"),
    },
    code: {
      include: (saved?.codeInclude ?? defaultCodeIncludes).join("\n"),
      exclude: (saved?.codeExclude ?? []).join("\n"),
    },
  };
}

export function PatternDialog({
  open,
  onOpenChange,
  theme,
  compact,
  catalog,
  groups,
  initialKind,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  compact: boolean;
  catalog: Catalog;
  groups: ChangeGroup[];
  initialKind: PatternKind;
}) {
  const settings = useSettings(preferences);
  const saved =
    settings.status === "ready" ? settings.values.projects[catalog.projectKey] : undefined;
  const [kind, setKind] = useState<PatternKind>(initialKind);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved));
  const [saveError, setSaveError] = useState<string | null>(null);
  const styles = makeStyles(theme, compact);
  const revision = settings.status === "ready" ? settings.revision : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset the draft only when the saved settings revision changes.
  useEffect(() => {
    if (!open || settings.status !== "ready") return;
    setDraft(draftFrom(settings.values.projects[catalog.projectKey]));
    setSaveError(null);
  }, [open, revision, settings.status, catalog.projectKey]);
  const active = draft[kind];
  const label = kind === "code" ? "代码文件" : "文档文件";
  const includeList = lines(active.include);
  const excludeList = lines(active.exclude);
  const presets = kind === "code" ? codePatternPresets : patternPresets;
  const setRule = (field: "include" | "exclude", value: string) =>
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], [field]: value } }));
  const mergePresets = () =>
    setDraft((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        include: [
          ...new Set([
            ...lines(current[kind].include),
            ...presets.flatMap((preset) => preset.patterns),
          ]),
        ].join("\n"),
      },
    }));
  const restore = () => {
    setDraft((current) => ({ ...current, [kind]: draftFrom()[kind] }));
    setSaveError(null);
  };
  const save = async () => {
    if (settings.status !== "ready") {
      setSaveError("偏好设置尚未准备好，请稍后重试。");
      return;
    }
    setSaveError(null);
    try {
      const savedValue = await settings.save(
        {
          projects: {
            ...settings.values.projects,
            [catalog.projectKey]: {
              include: lines(draft.documents.include),
              exclude: lines(draft.documents.exclude),
              codeInclude: lines(draft.code.include),
              codeExclude: lines(draft.code.exclude),
            },
          },
        },
        settings.revision,
      );
      if (savedValue) onOpenChange(false);
      else setSaveError(settings.saveError ?? "无法保存 Pattern 设置，请重试。");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "无法保存 Pattern 设置，请重试。");
    }
  };
  return (
    <Modal title="文件类型 Pattern" open={open} onOpenChange={onOpenChange}>
      <Modal.Content contentContainerStyle={{ gap: 9 }}>
        <View style={styles.row}>
          <Button
            theme={theme}
            label="代码文件规则"
            text="代码文件"
            onPress={() => setKind("code")}
            active={kind === "code"}
            small
          />
          <Button
            theme={theme}
            label="文档文件规则"
            text="文档文件"
            onPress={() => setKind("documents")}
            active={kind === "documents"}
            small
          />
        </View>
        <Text style={styles.muted}>
          两类规则独立保存。每行一个路径模式；exclude 优先。当前变更匹配{" "}
          {countMatches(groups, includeList, excludeList)} 个{label}。
        </Text>
        <Text style={styles.text}>Include</Text>
        <TextInput
          multiline
          value={active.include}
          onChangeText={(value) => setRule("include", value)}
          accessibilityLabel={`${label} Include patterns`}
          style={[styles.input, { minHeight: 110 }]}
        />
        <Text style={styles.text}>Exclude</Text>
        <TextInput
          multiline
          value={active.exclude}
          onChangeText={(value) => setRule("exclude", value)}
          accessibilityLabel={`${label} Exclude patterns`}
          placeholder="每行一个排除模式"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[styles.input, { minHeight: 76 }]}
        />
        <Text style={styles.muted}>{presets.map((preset) => preset.label).join(" · ")}</Text>
        <View style={styles.row}>
          <Button theme={theme} label="合并常用预设" onPress={mergePresets} small />
          <Button theme={theme} label="恢复默认" onPress={restore} small />
        </View>
        <View style={styles.row}>
          <Button theme={theme} label="保存" onPress={() => void save()} active />
          <Button theme={theme} label="取消" onPress={() => onOpenChange(false)} />
        </View>
        {saveError ? <ErrorText theme={theme} error={saveError} /> : null}
        {settings.status === "error" || settings.status === "invalid" ? (
          <ErrorText theme={theme} error={settings.error} />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
