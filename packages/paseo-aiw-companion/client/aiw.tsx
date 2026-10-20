import { useSettings, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  catalogRpc,
  changesRpc,
  fileRpc,
  patchRpc,
  preferences,
  searchRpc,
  type ChangeGroup,
  type ChangedFile,
  type Scope,
} from "../shared/contracts";
import { filterChangeGroups, matchesFileFilter, type FileFilter } from "../shared/file-filters";
import { subscribeToFileRequests, type FileLocator } from "./navigation";
import type { Reader, ReaderMode } from "./model";
import { patchQueryKey, retainPatchData } from "./reader-cache";
import { PreviewPane } from "./preview";
import { ChangeTree, FileTree, changeTreeExpansionKeys, type Expanded } from "./tree";
import { Button, IconButton, Empty, ErrorText, makeStyles } from "./controls";
import { PatternDialog } from "./pattern-dialog";
import { SplitPane } from "./split-pane";

type ViewTab = "files" | "changes";
const POLL_MS = 20_000;

function useCatalog(workspaceId: string) {
  const call = useRpc(catalogRpc);
  return useQuery({
    queryKey: ["aiw", "catalog", workspaceId],
    queryFn: () => call({ workspaceId }),
    staleTime: 5_000,
  });
}
function changeKey(file: ChangedFile): string {
  return `${file.repoId}:${file.origin}:${file.path}:${file.oldPath ?? ""}`;
}
function Choice({
  theme,
  label,
  selected,
  onPress,
  disabled = false,
}: {
  theme: PluginTheme;
  label: string;
  selected: boolean;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Button
      theme={theme}
      label={label}
      onPress={onPress}
      active={selected}
      disabled={disabled}
      small
    />
  );
}

export function BusinessPanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const compact = layout.compact || (panelWidth !== null && panelWidth < 720);
  const styles = makeStyles(theme, compact);
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const catalog = useCatalog(workspaceId);
  const changesCall = useRpc(changesRpc);
  const fileCall = useRpc(fileRpc);
  const patchCall = useRpc(patchRpc);
  const [tab, setTab] = useState<ViewTab>("files");
  const [scope, setScope] = useState<Scope>("all");
  const [filter, setFilter] = useState<FileFilter>("all");
  const [showIgnored, setShowIgnored] = useState(false);
  const [reader, setReader] = useState<Reader | null>(null);
  const [readerMode, setReaderMode] = useState<ReaderMode>("file");
  const [expanded, setExpanded] = useState<Expanded>(new Set());
  const [filesInitialized, setFilesInitialized] = useState(false);
  const [changesInitialized, setChangesInitialized] = useState(false);
  const [revision, setRevision] = useState(0);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const changes = useQuery({
    queryKey: ["aiw", "changes", workspaceId, scope],
    queryFn: () => changesCall({ workspaceId, scope }),
    enabled: Boolean(catalog.data),
  });
  const settings = useSettings(preferences);
  const saved =
    catalog.data && settings.status === "ready"
      ? settings.values.projects[catalog.data.projectKey]
      : undefined;
  const file = useQuery({
    queryKey: [
      "aiw",
      "file",
      workspaceId,
      reader?.locator.repoId,
      reader?.locator.path,
      reader?.locator.line,
    ],
    queryFn: () =>
      fileCall({
        workspaceId,
        repoId: reader!.locator.repoId,
        path: reader!.locator.path,
        startLine: reader!.locator.line ?? 1,
      }),
    enabled: readerMode === "file" && Boolean(reader),
  });
  const patchKey = patchQueryKey(workspaceId, reader, scope);
  const patch = useQuery({
    queryKey: patchKey,
    queryFn: () =>
      patchCall({
        workspaceId,
        repoId: reader!.locator.repoId,
        path: reader!.locator.path,
        oldPath: reader!.change?.oldPath,
        origin: reader!.change?.origin ?? "combined",
        scope,
        expectedSnapshot: reader!.group!.snapshotId,
      }),
    enabled: Boolean(reader?.group) && (readerMode === "diff" || reader?.change?.status === "D"),
    placeholderData: (previous, previousQuery) =>
      retainPatchData(previous, previousQuery?.queryKey, patchKey),
  });
  const groups = useMemo(() => changes.data?.groups ?? [], [changes.data]);
  const visibleGroups = useMemo(
    () => filterChangeGroups(groups, filter, saved),
    [groups, filter, saved],
  );
  const countFiles = (kind: FileFilter) =>
    groups.reduce(
      (count, group) =>
        count + group.files.filter((file) => matchesFileFilter(file, kind, saved)).length,
      0,
    );
  const toggle = useCallback(
    (key: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const refresh = useCallback(
    (manual = false) => {
      void catalog.refetch();
      void changes.refetch();
      if (readerMode === "file" && reader) void file.refetch();
      if (manual) setRevision((value) => value + 1);
    },
    [catalog.refetch, changes.refetch, readerMode, reader, file.refetch],
  );
  // Poll in the background without changing reader query identities or resetting the timer.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const timer = setInterval(() => refreshRef.current(), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () =>
      subscribeToFileRequests((locator) => {
        if (locator.workspaceId !== workspaceId) return;
        setExpanded((current) => {
          const next = new Set(current);
          next.add(`${locator.repoId}:`);
          const parts = locator.path.split("/");
          let path = "";
          for (const part of parts.slice(0, -1)) {
            path = path ? `${path}/${part}` : part;
            next.add(`${locator.repoId}:${path}`);
          }
          return next;
        });
        setReader({ locator });
        setReaderMode("file");
        setTab("files");
      }),
    [workspaceId],
  );
  useEffect(() => {
    if (!filesInitialized && catalog.data?.repos[0]) {
      setExpanded(new Set([`${catalog.data.repos[0].id}:`]));
      setFilesInitialized(true);
    }
  }, [filesInitialized, catalog.data]);
  useEffect(() => {
    if (!changesInitialized && changes.data) {
      setExpanded(
        (current) => new Set([...current, ...changeTreeExpansionKeys(changes.data.groups)]),
      );
      setChangesInitialized(true);
    }
  }, [changesInitialized, changes.data]);
  useEffect(() => {
    if (!reader?.change) return;
    const group = changes.data?.groups.find((item) => item.repo.id === reader.change!.repoId);
    const change = group?.files.find((item) => changeKey(item) === changeKey(reader.change!));
    if (!group || !change || !matchesFileFilter(change, filter, saved)) {
      setReader(null);
      setReaderMode("file");
      return;
    }
    if (reader.group !== group || reader.change !== change)
      setReader((current) => (current ? { ...current, group, change } : current));
  }, [changes.data, reader, filter, saved]);
  const openFile = (locator: FileLocator) => {
    setReader({ locator });
    setReaderMode("file");
  };
  const openChange = (group: ChangeGroup, change: ChangedFile) => {
    setReader({
      locator: { workspaceId, repoId: change.repoId, path: change.path },
      group,
      change,
    });
    setReaderMode("diff");
  };
  const selectScope = (next: Scope) => {
    setScope(next);
    if (reader?.change) {
      setReader(null);
      setReaderMode("file");
    }
  };
  const onMore = () => {
    if (!file.data?.truncated) return;
    setReader((current) =>
      current
        ? {
            ...current,
            locator: {
              ...current.locator,
              line: file.data.startLine + file.data.content.split("\n").length,
            },
          }
        : current,
    );
  };
  return (
    <View onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)} style={styles.screen}>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Text style={styles.title}>AIW 业务仓</Text>
          <Text numberOfLines={1} style={styles.muted}>
            {directory ?? workspaceId}
          </Text>
        </View>
        <IconButton
          theme={theme}
          label="设置"
          icon="Settings"
          disabled={!catalog.data}
          onPress={() => setPatternsOpen(true)}
        />
      </View>
      <View style={styles.row}>
        <Choice
          theme={theme}
          label="文件"
          selected={tab === "files"}
          onPress={() => setTab("files")}
        />
        <Choice
          theme={theme}
          label="改动"
          selected={tab === "changes"}
          onPress={() => setTab("changes")}
        />
      </View>
      {tab === "changes" ? (
        <>
          <View style={styles.row}>
            <Text style={styles.muted}>对比范围</Text>
            {(["all", "branch", "working"] as Scope[]).map((value) => (
              <Choice
                key={value}
                theme={theme}
                selected={scope === value}
                label={value === "all" ? "全部变更" : value === "branch" ? "分支已提交" : "未提交"}
                onPress={() => selectScope(value)}
              />
            ))}
          </View>
          <View style={styles.row}>
            <Text style={styles.muted}>文件类型</Text>
            <Choice
              theme={theme}
              label="全部文件"
              selected={filter === "all"}
              onPress={() => setFilter("all")}
            />
            <Choice
              theme={theme}
              label={`代码文件 ${countFiles("code")}`}
              selected={filter === "code"}
              onPress={() => setFilter("code")}
            />
            <Choice
              theme={theme}
              label={`文档文件 ${countFiles("documents")}`}
              selected={filter === "documents"}
              onPress={() => setFilter("documents")}
            />
          </View>
        </>
      ) : null}
      {catalog.isLoading ? <Empty theme={theme}>正在读取 AIW 仓库目录…</Empty> : null}
      {catalog.error ? <ErrorText theme={theme} error={catalog.error} /> : null}
      <SplitPane
        key={workspaceId}
        workspaceId={workspaceId}
        theme={theme}
        compact={compact}
        first={({ stacked, toggleDirection }) => (
          <View
            style={[styles.surface, { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }]}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderBottomWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={[styles.muted, { flex: 1 }]}>
                {tab === "files" ? "文件树" : "改动树"}
              </Text>
              {tab === "files" ? (
                <>
                  <Text style={styles.muted}>忽略文件</Text>
                  <Switch
                    accessibilityLabel="显示忽略文件"
                    value={showIgnored}
                    onValueChange={setShowIgnored}
                  />
                </>
              ) : null}
              <IconButton
                theme={theme}
                label="刷新"
                icon="RefreshCw"
                onPress={() => refresh(true)}
              />
              <IconButton
                theme={theme}
                label={stacked ? "左右分栏" : "上下分栏"}
                icon={stacked ? "Columns2" : "Rows2"}
                onPress={toggleDirection}
              />
              <IconButton
                theme={theme}
                label="折叠全部"
                icon="ChevronsUp"
                onPress={() =>
                  setExpanded(
                    (current) =>
                      new Set(
                        [...current].filter((key) =>
                          tab === "changes"
                            ? !key.startsWith("changes:")
                            : key.startsWith("changes:"),
                        ),
                      ),
                  )
                }
              />
            </View>
            <ScrollView contentContainerStyle={{ paddingVertical: 2 }}>
              {tab === "files" && catalog.data ? (
                <FileTree
                  workspaceId={workspaceId}
                  repos={catalog.data.repos}
                  showIgnored={showIgnored}
                  expanded={expanded}
                  toggle={toggle}
                  selected={reader?.locator}
                  onOpen={openFile}
                  theme={theme}
                  refreshKey={revision}
                />
              ) : null}
              {tab === "changes" ? (
                <>
                  {changes.isLoading ? <Empty theme={theme}>读取改动中…</Empty> : null}
                  {changes.error ? <ErrorText theme={theme} error={changes.error} /> : null}
                  <ChangeTree
                    groups={visibleGroups}
                    expanded={expanded}
                    toggle={toggle}
                    selected={reader?.locator}
                    selectedChange={reader?.change}
                    onOpen={openChange}
                    theme={theme}
                    empty={
                      filter === "all"
                        ? undefined
                        : `该对比范围没有匹配的${filter === "code" ? "代码" : "文档"}文件。`
                    }
                  />
                </>
              ) : null}
            </ScrollView>
          </View>
        )}
        second={
          <PreviewPane
            theme={theme}
            compact={compact}
            reader={reader}
            readerMode={readerMode}
            setReaderMode={setReaderMode}
            file={file}
            patch={patch}
            onMore={onMore}
          />
        }
      />
      {patternsOpen && catalog.data ? (
        <PatternDialog
          initialKind={filter === "code" ? "code" : "documents"}
          open={patternsOpen}
          onOpenChange={setPatternsOpen}
          theme={theme}
          compact={compact}
          catalog={catalog.data}
          groups={groups}
        />
      ) : null}
    </View>
  );
}

export function SearchPanel({
  workspaceId,
  theme,
  layout,
  openBusiness,
}: PluginWorkspacePanelProps & { openBusiness(locator: FileLocator): void }) {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const compact = layout.compact || (panelWidth !== null && panelWidth < 720);
  const styles = makeStyles(theme, compact);
  const catalog = useCatalog(workspaceId);
  const searchCall = useRpc(searchRpc);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeText, setIncludeText] = useState("");
  const [excludeText, setExcludeText] = useState("");
  const [repoIds, setRepoIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [submitted, setSubmitted] = useState<null | {
    query: string;
    repoIds: string[];
    regex: boolean;
    caseSensitive: boolean;
    include: string[];
    exclude: string[];
  }>(null);
  useEffect(() => {
    if (!initialized && catalog.data) {
      setRepoIds(
        catalog.data.repos.filter((repo) => repo.ready && !repo.error).map((repo) => repo.id),
      );
      setInitialized(true);
    }
  }, [initialized, catalog.data]);
  const search = useQuery({
    queryKey: ["aiw", "search", workspaceId, submitted],
    queryFn: () => searchCall({ workspaceId, ...submitted! }),
    enabled: submitted !== null && submitted.repoIds.length > 0,
  });
  const split = (text: string) =>
    text
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
  const run = () => {
    const value = query.trim();
    if (value && repoIds.length)
      setSubmitted({
        query: value,
        repoIds,
        regex,
        caseSensitive,
        include: split(includeText),
        exclude: split(excludeText),
      });
  };
  const toggleRepo = (id: string) =>
    setRepoIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const names = useMemo(
    () => new Map(catalog.data?.repos.map((repo) => [repo.id, repo.name]) ?? []),
    [catalog.data],
  );
  return (
    <ScrollView
      onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)}
      style={styles.screen}
      contentContainerStyle={styles.stack}
    >
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AIW 跨仓搜索</Text>
          <Text style={styles.muted}>独立于业务仓的变更筛选与对比范围</Text>
        </View>
        <Button theme={theme} label="刷新目录" onPress={() => void catalog.refetch()} small />
      </View>
      <View style={[styles.surface, { padding: 10, gap: 8 }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={run}
          accessibilityLabel="搜索文本"
          placeholder="搜索文本或正则表达式"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
        />
        <View style={styles.row}>
          <Text style={styles.muted}>正则</Text>
          <Switch value={regex} onValueChange={setRegex} />
          <Text style={styles.muted}>区分大小写</Text>
          <Switch value={caseSensitive} onValueChange={setCaseSensitive} />
          <Button
            theme={theme}
            label="搜索"
            onPress={run}
            active
            disabled={!query.trim() || repoIds.length === 0}
          />
        </View>
        <Text style={styles.muted}>仓库范围</Text>
        <View style={styles.row}>
          {catalog.data?.repos.map((repo) => (
            <Choice
              key={repo.id}
              theme={theme}
              label={!repo.ready || repo.error ? `${repo.name}（未就绪）` : repo.name}
              disabled={!repo.ready || Boolean(repo.error)}
              selected={repoIds.includes(repo.id)}
              onPress={() => toggleRepo(repo.id)}
            />
          ))}
        </View>
        <TextInput
          multiline
          value={includeText}
          onChangeText={setIncludeText}
          accessibilityLabel="搜索 include 路径"
          placeholder="包含路径（每行一条，可选）"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[styles.input, { minHeight: 52 }]}
        />
        <TextInput
          multiline
          value={excludeText}
          onChangeText={setExcludeText}
          accessibilityLabel="搜索 exclude 路径"
          placeholder="排除路径（每行一条，可选）"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[styles.input, { minHeight: 52 }]}
        />
      </View>
      {catalog.error ? <ErrorText theme={theme} error={catalog.error} /> : null}
      {search.isLoading ? <Empty theme={theme}>正在跨仓搜索…</Empty> : null}
      {search.error ? <ErrorText theme={theme} error={search.error} /> : null}
      {search.data ? (
        <View style={[styles.surface, { paddingHorizontal: 10 }]}>
          <Text style={[styles.muted, { paddingVertical: 8 }]}>
            {search.data.hits.length} 个命中 · {search.data.truncated ? "结果已截断" : "读取完成"}
          </Text>
          {search.data.errors.map((item) => (
            <Text key={item.repoId} style={{ color: theme.colors.statusWarning }}>
              {item.repoId}: {item.error}
            </Text>
          ))}
          {search.data.hits.map((hit) => (
            <Pressable
              key={`${hit.repoId}:${hit.path}:${hit.line}:${hit.text}`}
              accessibilityRole="button"
              accessibilityLabel={`打开 ${hit.path} 第 ${hit.line} 行`}
              onPress={() =>
                openBusiness({ workspaceId, repoId: hit.repoId, path: hit.path, line: hit.line })
              }
              style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: theme.colors.border }}
            >
              <Text style={styles.muted}>
                {names.get(hit.repoId) ?? "未知仓"} · {hit.repoId}
              </Text>
              <Text style={styles.text}>
                {hit.path}:{hit.line}
              </Text>
              <Text
                numberOfLines={2}
                style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}
              >
                {hit.text}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
