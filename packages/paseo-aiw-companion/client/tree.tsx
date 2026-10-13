import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { treeRpc, type ChangeGroup, type ChangedFile, type Repo } from "../shared/contracts";
import type { FileLocator } from "./navigation";
import { Badge, Empty, ErrorText, makeStyles } from "./controls";

export type Expanded = ReadonlySet<string>;
export type Toggle = (key: string) => void;
const fileIcon = (path: string): string => /\.(tsx?|jsx?|mjs|cjs|vue|svelte|go|py|rs|java|kt|swift|sh|sql|proto)$/i.test(path) ? "FileCode2" : /\.(json|yaml|yml)$/i.test(path) ? "FileJson" : "FileText";
const treeKey = (repoId: string, path: string) => `${repoId}:${path}`;
const changeKey = (file: ChangedFile) => `${file.repoId}:${file.origin}:${file.path}:${file.oldPath ?? ""}`;
const tone = (status: ChangedFile["status"]): "success" | "danger" | "warning" | "muted" => status === "A" ? "success" : status === "D" ? "danger" : status === "conflict" ? "warning" : "muted";
const origin = (file: ChangedFile) => file.origin === "staged" ? "暂存" : file.origin === "unstaged" ? "未暂存" : file.origin === "untracked" ? "未跟踪" : file.origin === "branch" ? "分支" : "全部";

function Chevron({ expanded, theme }: { expanded: boolean; theme: PluginTheme }) { return <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />; }
function RepoHeader({ repo, expanded, onToggle, theme, count }: { repo: Repo; expanded: boolean; onToggle(): void; theme: PluginTheme; count?: number }) {
  const styles = makeStyles(theme, false);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${repo.name} ${expanded ? "收起" : "展开"}`} onPress={onToggle} style={{ paddingHorizontal: 8, paddingVertical: 7, gap: 2, backgroundColor: expanded ? theme.colors.surface2 : undefined, borderBottomWidth: 1, borderColor: theme.colors.border }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Chevron expanded={expanded} theme={theme} /><Icon name="FolderGit2" size={14} color={theme.colors.foregroundMuted} /><Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>{repo.name}</Text>{!repo.ready || repo.error ? <Badge theme={theme} value="未就绪" tone="warning" /> : null}{count === undefined ? null : <Badge theme={theme} value={`${count}`} />}</View>
    <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.muted, { paddingLeft: 34 }]}>{repo.branch} · {repo.head.slice(0, 8)}</Text>
  </Pressable>;
}

function DirectoryNode({ workspaceId, repo, path, depth, showIgnored, expanded, toggle, selected, onOpen, theme, refreshKey }: { workspaceId: string; repo: Repo; path: string; depth: number; showIgnored: boolean; expanded: Expanded; toggle: Toggle; selected?: FileLocator; onOpen(locator: FileLocator): void; theme: PluginTheme; refreshKey: number }) {
  const call = useRpc(treeRpc); const nodeKey = treeKey(repo.id, path); const open = expanded.has(nodeKey); const query = useQuery({ queryKey: ["aiw", "tree", workspaceId, repo.id, path, showIgnored, refreshKey], queryFn: () => call({ workspaceId, repoId: repo.id, path, showIgnored }), enabled: open }); const styles = makeStyles(theme, false);
  return <>{path ? <Pressable accessibilityRole="button" accessibilityLabel={`${path} ${open ? "收起" : "展开"}`} onPress={() => toggle(nodeKey)} style={{ minHeight: 26, paddingLeft: 8 + depth * 14, paddingRight: 7, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: open ? theme.colors.surface2 : undefined }}><Chevron expanded={open} theme={theme} /><Icon name={open ? "FolderOpen" : "Folder"} size={14} color={theme.colors.foregroundMuted} /><Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>{path.split("/").at(-1)}</Text></Pressable> : null}
    {open ? <>{query.isLoading ? <Text style={[styles.muted, { paddingLeft: 14 + depth * 14 }]}>读取目录…</Text> : null}{query.error ? <ErrorText theme={theme} error={query.error} /> : null}{query.data?.entries.map(entry => entry.directory ? <DirectoryNode key={entry.path} workspaceId={workspaceId} repo={repo} path={entry.path} depth={depth + 1} showIgnored={showIgnored} expanded={expanded} toggle={toggle} selected={selected} onOpen={onOpen} theme={theme} refreshKey={refreshKey} /> : <Pressable key={entry.path} accessibilityRole="button" accessibilityLabel={`打开 ${entry.path}`} onPress={() => onOpen({ workspaceId, repoId: repo.id, path: entry.path })} style={{ minHeight: 26, paddingLeft: 23 + (depth + 1) * 14, paddingRight: 7, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: selected?.repoId === repo.id && selected.path === entry.path ? theme.colors.surface2 : undefined }}><Icon name={fileIcon(entry.path)} size={13} color={theme.colors.foregroundMuted} /><Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>{entry.name}{entry.symlink ? " ↗" : ""}</Text></Pressable>)}{query.data?.truncated ? <Text style={[styles.muted, { paddingLeft: 14 + depth * 14 }]}>目录结果已截断</Text> : null}</> : null}
  </>;
}

export function FileTree({ workspaceId, repos, showIgnored, expanded, toggle, selected, onOpen, theme, refreshKey }: { workspaceId: string; repos: Repo[]; showIgnored: boolean; expanded: Expanded; toggle: Toggle; selected?: FileLocator; onOpen(locator: FileLocator): void; theme: PluginTheme; refreshKey: number }) {
  return <View>{repos.map(repo => { const open = expanded.has(treeKey(repo.id, "")); return <View key={repo.id}><RepoHeader repo={repo} expanded={open} onToggle={() => toggle(treeKey(repo.id, ""))} theme={theme} />{open ? !repo.ready || repo.error ? <ErrorText theme={theme} error={repo.error ?? "业务仓未就绪"} /> : <DirectoryNode workspaceId={workspaceId} repo={repo} path="" depth={0} showIgnored={showIgnored} expanded={expanded} toggle={toggle} selected={selected} onOpen={onOpen} theme={theme} refreshKey={refreshKey} /> : null}</View>; })}</View>;
}

type ChangeNode = { files: ChangedFile[]; children: Map<string, ChangeNode> };
function rootFor(files: ChangedFile[]): ChangeNode { const root: ChangeNode = { files: [], children: new Map() }; for (const file of files) { let node = root; const parts = file.path.split("/"); for (const part of parts.slice(0, -1)) { let child = node.children.get(part); if (!child) { child = { files: [], children: new Map() }; node.children.set(part, child); } node = child; } node.files.push(file); } return root; }
export function changeTreeExpansionKeys(groups: ChangeGroup[]): string[] { const keys: string[] = []; for (const group of groups) { if (!group.files.length) continue; keys.push(`changes:${group.repo.id}`); for (const file of group.files) { const parts = file.path.split("/"); let path = ""; for (const part of parts.slice(0, -1)) { path = path ? `${path}/${part}` : part; keys.push(`changes:${group.repo.id}:${path}`); } } } return keys; }

function ChangeRow({ file, group, selected, selectedChange, onOpen, theme, depth }: { file: ChangedFile; group: ChangeGroup; selected?: FileLocator; selectedChange?: ChangedFile; onOpen(group: ChangeGroup, file: ChangedFile): void; theme: PluginTheme; depth: number }) {
  const styles = makeStyles(theme, false); const label = file.oldPath ? `${file.oldPath.split("/").at(-1)} → ${file.path.split("/").at(-1)}` : file.path.split("/").at(-1); const active = selected?.repoId === file.repoId && selected.path === file.path && (!selectedChange || changeKey(selectedChange) === changeKey(file));
  return <Pressable accessibilityRole="button" accessibilityLabel={`查看改动 ${file.path}`} onPress={() => onOpen(group, file)} style={{ minHeight: 26, paddingLeft: 10 + depth * 14, paddingRight: 7, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: active ? theme.colors.surface2 : undefined }}><Badge theme={theme} value={file.status} tone={tone(file.status)} /><Icon name={fileIcon(file.path)} size={13} color={theme.colors.foregroundMuted} /><Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>{label}</Text><Badge theme={theme} value={file.binary ? "二进制" : origin(file)} />{file.additions !== null ? <Text style={{ color: theme.colors.statusSuccess, fontSize: 11 }}>+{file.additions}</Text> : null}{file.deletions !== null ? <Text style={{ color: theme.colors.statusDanger, fontSize: 11 }}>−{file.deletions}</Text> : null}</Pressable>;
}

function ChangeNodes({ node, group, path, depth, expanded, toggle, selected, selectedChange, onOpen, theme }: { node: ChangeNode; group: ChangeGroup; path: string; depth: number; expanded: Expanded; toggle: Toggle; selected?: FileLocator; selectedChange?: ChangedFile; onOpen(group: ChangeGroup, file: ChangedFile): void; theme: PluginTheme }) {
  const styles = makeStyles(theme, false);
  return <>{[...node.children.entries()].map(([name, child]) => { const childPath = path ? `${path}/${name}` : name; const key = `changes:${group.repo.id}:${childPath}`; const open = expanded.has(key); return <View key={childPath}><Pressable accessibilityRole="button" accessibilityLabel={`${childPath} ${open ? "收起" : "展开"}`} onPress={() => toggle(key)} style={{ minHeight: 26, paddingLeft: 8 + depth * 14, paddingRight: 7, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: open ? theme.colors.surface2 : undefined }}><Chevron expanded={open} theme={theme} /><Icon name={open ? "FolderOpen" : "Folder"} size={14} color={theme.colors.foregroundMuted} /><Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>{name}</Text></Pressable>{open ? <ChangeNodes node={child} group={group} path={childPath} depth={depth + 1} expanded={expanded} toggle={toggle} selected={selected} selectedChange={selectedChange} onOpen={onOpen} theme={theme} /> : null}</View>; })}{node.files.map(file => <ChangeRow key={changeKey(file)} file={file} group={group} selected={selected} selectedChange={selectedChange} onOpen={onOpen} theme={theme} depth={depth} />)}</>;
}

export function ChangeTree({ groups, expanded, toggle, selected, selectedChange, onOpen, theme, empty }: { groups: ChangeGroup[]; expanded: Expanded; toggle: Toggle; selected?: FileLocator; selectedChange?: ChangedFile; onOpen(group: ChangeGroup, file: ChangedFile): void; theme: PluginTheme; empty?: string }) {
  const trees = useMemo(() => groups.map(group => ({ group, tree: rootFor(group.files) })), [groups]); const styles = makeStyles(theme, false);
  if (!trees.length) return <Empty theme={theme}>{empty ?? "当前范围没有变更。"}</Empty>;
  return <View>{trees.map(({ group, tree }) => { const open = expanded.has(`changes:${group.repo.id}`); return <View key={group.repo.id}><RepoHeader repo={group.repo} count={group.files.length} expanded={open} onToggle={() => toggle(`changes:${group.repo.id}`)} theme={theme} />{open ? <>{group.error ? <ErrorText theme={theme} error={group.error} /> : null}<Text style={[styles.muted, { paddingHorizontal: 8, paddingVertical: 4 }]}>基线 {group.baseline.slice(0, 12)} · HEAD {group.head.slice(0, 12)}</Text><ChangeNodes node={tree} group={group} path="" depth={0} expanded={expanded} toggle={toggle} selected={selected} selectedChange={selectedChange} onOpen={onOpen} theme={theme} /></> : null}</View>; })}</View>;
}
