import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { type TextInput as NativeTextInput, Pressable, Text, View } from "react-native";
import { type Catalog, type SearchResult, searchRpc } from "../shared/contracts";
import { Button, Empty, ErrorText, IconButton, makeStyles } from "./controls";
import { type FileLocator, subscribeToSearchFocus } from "./navigation";

type SearchInput = {
  query: string;
  repoIds: string[];
  regex: boolean;
  caseSensitive: boolean;
  include: string[];
  exclude: string[];
};
const lines = (text: string) =>
  text
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

export function useAiwSearch({
  workspaceId,
  catalog,
  onSearch,
  onClear,
}: {
  workspaceId: string;
  catalog?: Catalog;
  onSearch(): void;
  onClear(): void;
}) {
  const call = useRpc(searchRpc);
  const input = useRef<NativeTextInput>(null);
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeText, setIncludeText] = useState("");
  const [excludeText, setExcludeText] = useState("");
  // null follows all ready repositories, including ones discovered on refresh.
  const [selection, setSelection] = useState<string[] | null>(null);
  const ready =
    catalog?.repos.filter((repo) => repo.ready && !repo.error).map((repo) => repo.id) ?? [];
  const repoIds = selection === null ? ready : ready.filter((id) => selection.includes(id));
  const [submitted, setSubmitted] = useState<SearchInput | null>(null);
  const search = useQuery({
    queryKey: ["aiw", "search", workspaceId, submitted],
    queryFn: () => call({ workspaceId, ...submitted! }),
    enabled: submitted !== null,
    retry: false,
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToSearchFocus(workspaceId, () => {
      if (timer !== undefined) clearTimeout(timer);
      // Let opening/activating a cached tab commit before requesting native focus.
      timer = setTimeout(() => input.current?.focus(), 0);
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [workspaceId]);
  const run = () => {
    if (!query.trim() || !repoIds.length || query.length > 256) return;
    const next = {
      query,
      repoIds,
      regex,
      caseSensitive,
      include: lines(includeText),
      exclude: lines(excludeText),
    };
    // Repeating Enter retries errors and refreshes the same query against current files.
    if (submitted && JSON.stringify(next) === JSON.stringify(submitted)) void search.refetch();
    else setSubmitted(next);
    onSearch();
  };
  const clear = () => {
    setQuery("");
    setSubmitted(null);
    onClear();
    input.current?.focus();
  };
  const toggleRepo = (id: string) =>
    setSelection(repoIds.includes(id) ? repoIds.filter((value) => value !== id) : [...repoIds, id]);
  return {
    input,
    query,
    setQuery: (value: string) => {
      setQuery(value);
      if (!value) {
        setSubmitted(null);
        onClear();
      }
    },
    advanced,
    setAdvanced,
    regex,
    setRegex,
    caseSensitive,
    setCaseSensitive,
    includeText,
    setIncludeText,
    excludeText,
    setExcludeText,
    repoIds,
    toggleRepo,
    allRepos: () => setSelection(null),
    submitted,
    search,
    run,
    clear,
  };
}

type SearchState = ReturnType<typeof useAiwSearch>;
function SearchOption({
  theme,
  label,
  text,
  selected,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  text: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        width: 28,
        height: 30,
        borderWidth: 1,
        borderRadius: 4,
        borderColor: selected ? theme.colors.accent : "transparent",
        backgroundColor: selected ? theme.colors.surface2 : undefined,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: selected ? theme.colors.accent : theme.colors.foregroundMuted,
          fontSize: 12,
        }}
      >
        {text}
      </Text>
    </Pressable>
  );
}

export function SearchBar({
  state,
  catalog,
  theme,
  compact,
}: {
  state: SearchState;
  catalog?: Catalog;
  theme: PluginTheme;
  compact: boolean;
}) {
  const styles = makeStyles(theme, compact);
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索配置"
          accessibilityState={{ expanded: state.advanced }}
          onPress={() => state.setAdvanced(!state.advanced)}
          style={{ width: 24, height: 34, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={styles.muted}>{state.advanced ? "▾" : "▸"}</Text>
        </Pressable>
        <View
          style={[
            styles.input,
            { flex: 1, minWidth: 0, padding: 2, flexDirection: "row", alignItems: "center" },
          ]}
        >
          <TextInput
            ref={state.input}
            value={state.query}
            onChangeText={state.setQuery}
            onSubmitEditing={state.run}
            accessibilityLabel="搜索文本"
            placeholder="跨仓搜索"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{ flex: 1, minWidth: 0, padding: 5, color: theme.colors.foreground }}
          />
          <SearchOption
            theme={theme}
            label="区分大小写"
            text="Aa"
            selected={state.caseSensitive}
            onPress={() => state.setCaseSensitive(!state.caseSensitive)}
          />
          <SearchOption
            theme={theme}
            label="使用正则表达式"
            text=".*"
            selected={state.regex}
            onPress={() => state.setRegex(!state.regex)}
          />
        </View>
        {state.query || state.submitted ? (
          <IconButton theme={theme} label="清除搜索" icon="X" onPress={state.clear} />
        ) : null}
        <IconButton
          theme={theme}
          label="搜索"
          icon="Search"
          disabled={!state.query.trim() || state.repoIds.length === 0 || state.query.length > 256}
          onPress={state.run}
        />
      </View>
      {state.advanced ? (
        <ScrollView
          style={{ maxHeight: compact ? 200 : 260 }}
          contentContainerStyle={{ gap: 7, padding: 7 }}
        >
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            <Text style={styles.muted}>仓库范围</Text>
            <Button theme={theme} label="全部可用仓库" onPress={state.allRepos} small />
            {catalog?.repos.map((repo) => (
              <Button
                key={repo.id}
                theme={theme}
                label={!repo.ready || repo.error ? `${repo.name}（未就绪）` : repo.name}
                disabled={!repo.ready || Boolean(repo.error)}
                active={state.repoIds.includes(repo.id)}
                onPress={() => state.toggleRepo(repo.id)}
                small
              />
            ))}
          </View>
          <TextInput
            multiline
            value={state.includeText}
            onChangeText={state.setIncludeText}
            accessibilityLabel="搜索 include 路径"
            placeholder="包含的文件（每行一个 glob，可选）"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={[styles.input, { minHeight: 40 }]}
          />
          <TextInput
            multiline
            value={state.excludeText}
            onChangeText={state.setExcludeText}
            accessibilityLabel="搜索 exclude 路径"
            placeholder="排除的文件（每行一个 glob，可选）"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={[styles.input, { minHeight: 40 }]}
          />
          <Text style={styles.muted}>
            路径和仓库范围独立于下方 Diff 筛选，按 Enter 或搜索按钮应用。
          </Text>
        </ScrollView>
      ) : null}
      {state.repoIds.length === 0 && catalog ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
          请选择至少一个可用仓库。{!state.advanced ? "展开搜索配置调整范围。" : ""}
        </Text>
      ) : null}
      {state.query.length > 256 ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
          搜索文本最多 256 个字符。
        </Text>
      ) : null}
      {!state.advanced &&
      (state.includeText.trim() ||
        state.excludeText.trim() ||
        state.repoIds.length !==
          catalog?.repos.filter((repo) => repo.ready && !repo.error).length) ? (
        <Text style={styles.muted}>已启用搜索范围限制 · 展开配置查看</Text>
      ) : null}
    </View>
  );
}

export function SearchResults({
  state,
  catalog,
  workspaceId,
  theme,
  onOpen,
}: {
  state: SearchState;
  catalog?: Catalog;
  workspaceId: string;
  theme: PluginTheme;
  onOpen(locator: FileLocator): void;
}) {
  const styles = makeStyles(theme, false);
  const names = useMemo(
    () => new Map(catalog?.repos.map((repo) => [repo.id, repo.name]) ?? []),
    [catalog],
  );
  const data = state.search.data;
  const groups = useMemo(() => {
    const result = new Map<string, { repoId: string; path: string; hits: SearchResult["hits"] }>();
    for (const hit of data?.hits ?? []) {
      const key = `${hit.repoId}:${hit.path}`;
      const group = result.get(key) ?? { repoId: hit.repoId, path: hit.path, hits: [] };
      group.hits.push(hit);
      result.set(key, group);
    }
    return [...result.values()];
  }, [data]);
  return (
    <View>
      {state.search.isFetching ? <Empty theme={theme}>正在跨仓搜索…</Empty> : null}
      {state.search.error ? <ErrorText theme={theme} error={state.search.error} /> : null}
      {data ? (
        <>
          <Text style={[styles.muted, { padding: 8 }]}>
            {data.hits.length} 个命中 · {groups.length} 个文件
            {data.truncated ? " · 结果已截断，请缩小范围" : ""}
          </Text>
          {data.errors.map((item) => (
            <Text key={item.repoId} style={{ color: theme.colors.statusWarning, padding: 8 }}>
              {names.get(item.repoId) ?? item.repoId}: {item.error}
            </Text>
          ))}
          {!data.hits.length ? (
            <Empty theme={theme}>
              {data.errors.length
                ? "部分仓库搜索失败，其余范围没有匹配结果。"
                : "没有匹配结果，请调整搜索文本或范围。"}
            </Empty>
          ) : null}
          {groups.map((group) => (
            <View
              key={`${group.repoId}:${group.path}`}
              style={{ borderTopWidth: 1, borderColor: theme.colors.border, paddingVertical: 5 }}
            >
              <Text style={[styles.muted, { paddingHorizontal: 8 }]}>
                {names.get(group.repoId) ?? group.repoId} · {group.path}
              </Text>
              {group.hits.map((hit) => (
                <Pressable
                  key={`${hit.line}:${hit.text}`}
                  accessibilityRole="button"
                  accessibilityLabel={`打开 ${names.get(hit.repoId) ?? hit.repoId} ${hit.path} 第 ${hit.line} 行`}
                  onPress={() =>
                    onOpen({ workspaceId, repoId: hit.repoId, path: hit.path, line: hit.line })
                  }
                  style={({ pressed }) => ({
                    paddingVertical: 5,
                    paddingHorizontal: 10,
                    backgroundColor: pressed ? theme.colors.surface2 : undefined,
                  })}
                >
                  <Text
                    numberOfLines={2}
                    style={{
                      color: theme.colors.foreground,
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  >
                    {hit.line}: {hit.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}
