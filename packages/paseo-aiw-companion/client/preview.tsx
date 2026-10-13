import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { copyText, Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import type { PluginTheme } from '@getpaseo/plugin';
import type { FileQuery, PatchQuery, Reader, ReaderMode } from './model';
import { parseDiff, type DiffRow } from './diff-model';
import { highlightCode, languageFor, tint, tokenColor, type Segment } from './syntax';

const ROW_HEIGHT = 21;
const FONT = Platform.OS === 'ios' ? 'Menlo' : Platform.OS === 'web' ? 'SFMono-Regular, Consolas, Liberation Mono, monospace' : 'monospace';
type CodeRow = { key: string; kind: DiffRow['kind'] | 'source'; text: string; oldLine?: number; newLine?: number; tokens: Segment[]; target?: boolean };

function Action({ label, onPress, theme, selected = false, disabled = false }: { label: string; onPress(): void; theme: PluginTheme; selected?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 5, backgroundColor: selected ? theme.colors.surface2 : undefined, opacity: disabled ? 0.4 : 1 }}><Text style={{ color: selected ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 12, fontWeight: selected ? '600' : '400' }}>{label}</Text></Pressable>;
}

function rowBackground(row: CodeRow, theme: PluginTheme): string {
  if (row.kind === 'addition') return tint(theme.colors.statusSuccess, theme.colors.surface0);
  if (row.kind === 'deletion') return tint(theme.colors.statusDanger, theme.colors.surface0);
  if (row.kind === 'hunk' || row.target) return tint(theme.colors.accent, theme.colors.surface0, 0.08);
  return theme.colors.surface0;
}

function CodeText({ row, theme, wrap }: { row: CodeRow; theme: PluginTheme; wrap: boolean }) {
  const special = row.kind === 'hunk' || row.kind === 'note';
  return <Text selectable style={{ fontFamily: FONT, fontSize: 13, lineHeight: ROW_HEIGHT, color: special ? theme.colors.foregroundMuted : theme.colors.foreground, paddingHorizontal: 12, ...(wrap ? { flex: 1, minWidth: 0 } : {}) }}>{special ? row.text : row.tokens.length ? row.tokens.map((token, index) => <Text key={index} style={{ color: tokenColor(token.classes, theme), ...(token.classes.includes('comment') ? { fontStyle: 'italic' as const } : {}), ...(token.classes.includes('bold') ? { fontWeight: '600' as const } : {}) }}>{token.text.replace(/\t/g, '    ')}</Text>) : ' '}</Text>;
}

function Gutter({ row, diff, theme }: { row: CodeRow; diff: boolean; theme: PluginTheme }) {
  const color = row.kind === 'addition' ? theme.colors.statusSuccess : row.kind === 'deletion' ? theme.colors.statusDanger : theme.colors.foregroundMuted;
  const numberStyle = { color: theme.colors.foregroundMuted, fontFamily: FONT, fontSize: 11, lineHeight: ROW_HEIGHT, textAlign: 'right' as const, width: 40, paddingRight: 8 };
  return <View style={{ width: diff ? 98 : 52, minHeight: ROW_HEIGHT, flexDirection: 'row', borderRightWidth: 1, borderColor: theme.colors.border, backgroundColor: rowBackground(row, theme) }}>
    {diff ? <Text style={numberStyle}>{row.oldLine ?? ''}</Text> : null}<Text style={{ ...numberStyle, width: diff ? 40 : 51 }}>{row.newLine ?? ''}</Text>
    {diff ? <Text style={{ color, fontFamily: FONT, fontSize: 12, lineHeight: ROW_HEIGHT, width: 17, textAlign: 'center' }}>{row.kind === 'addition' ? '+' : row.kind === 'deletion' ? '−' : ''}</Text> : null}
  </View>;
}

/** Both axes scroll independently. In non-wrapping mode the line gutters stay fixed. */
function CodeEditor({ rows, diff, theme, wrap }: { rows: CodeRow[]; diff: boolean; theme: PluginTheme; wrap: boolean }) {
  const width = useMemo(() => rows.reduce((widest, row) => Math.max(widest, [...row.text].reduce((total, char) => total + (char === '\t' ? 4 : (char.codePointAt(0) ?? 0) > 255 ? 2 : 1), 0) * 8 + 32), 320), [rows]);
  if (wrap) return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingVertical: 6 }}><View>{rows.map(row => <View key={row.key} style={{ flexDirection: 'row', minHeight: ROW_HEIGHT, backgroundColor: rowBackground(row, theme) }}><Gutter row={row} diff={diff} theme={theme} /><CodeText row={row} theme={theme} wrap /></View>)}</View></ScrollView>;
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingVertical: 6 }}><View style={{ flexDirection: 'row' }}>
    <View style={{ width: diff ? 98 : 52, flexShrink: 0 }}>{rows.map(row => <Gutter key={row.key} row={row} diff={diff} theme={theme} />)}</View>
    <ScrollView horizontal style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ minWidth: '100%' }}><View style={{ width, minWidth: '100%' }}>{rows.map(row => <View key={row.key} style={{ height: ROW_HEIGHT, backgroundColor: rowBackground(row, theme) }}><CodeText row={row} theme={theme} wrap={false} /></View>)}</View></ScrollView>
  </View></ScrollView>;
}

function diffRows(patch: string, before: string, after: string, path: string): CodeRow[] {
  const old = highlightCode(before, path).lines; const next = highlightCode(after, path).lines;
  return parseDiff(patch).map((row, index) => {
    const tokens = row.kind === 'deletion' ? old[(row.oldLine ?? 0) - 1] : next[(row.newLine ?? 0) - 1];
    const matching = tokens?.map(token => token.text).join('') === row.text;
    return { ...row, key: `diff-${index}`, tokens: matching ? tokens : highlightCode(row.text, path).lines[0] ?? [] };
  });
}

function comparison(reader: Reader): string {
  const origin = reader.change?.origin;
  if (origin === 'untracked') return '新文件';
  if (origin === 'staged') return 'HEAD → 暂存区';
  if (origin === 'unstaged') return '暂存区 → 工作区';
  return `${reader.group?.baseline.slice(0, 8) ?? '基线'} → ${origin === 'branch' ? reader.group?.head.slice(0, 8) ?? 'HEAD' : '工作区'}`;
}

export function PreviewPane({ theme, compact, reader, readerMode, setReaderMode, file, patch, onMore }: { theme: PluginTheme; compact: boolean; reader: Reader | null; readerMode: ReaderMode; setReaderMode(mode: ReaderMode): void; file: FileQuery; patch: PatchQuery; onMore(): void }) {
  const [wrap, setWrap] = useState(false); const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState<string | null>(null);
  const deleted = reader?.change?.status === 'D'; const diff = readerMode === 'diff';
  const content = deleted ? patch.data?.before ?? '' : file.data?.content ?? '';
  const start = deleted ? 1 : file.data?.startLine ?? 1;
  const path = reader?.locator.path ?? '';
  const highlighted = useMemo(() => highlightCode(content, path), [content, path]);
  const rows = useMemo<CodeRow[]>(() => diff && patch.data ? diffRows(patch.data.patch, patch.data.before, patch.data.after, path) : highlighted.lines.map((tokens, index) => ({ key: `source-${start + index}`, kind: 'source', text: tokens.map(token => token.text).join(''), tokens, newLine: start + index, target: start + index === reader?.locator.line })), [diff, patch.data, path, highlighted.lines, start, reader?.locator.line]);
  useEffect(() => { setCopied(false); setCopyError(null); }, [path, readerMode, content, patch.data?.patch]);
  const copy = async () => { try { await copyText(diff ? patch.data?.patch ?? '' : content); setCopied(true); setCopyError(null); } catch (error) { setCopyError(error instanceof Error ? error.message : '无法复制内容'); } };
  const background = theme.colors.surface0;
  if (!reader) return <View style={{ flex: 1, minWidth: 0, minHeight: 220, backgroundColor: background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, alignItems: 'center', justifyContent: 'center', gap: 10 }}><Icon name="FileCode2" size={28} color={theme.colors.foregroundMuted} /><Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>选择文件查看代码，或选择改动查看 Diff</Text></View>;
  const error = diff || deleted ? patch.error : file.error;
  const loading = diff || deleted ? patch.isLoading : file.isLoading;
  const binary = diff || deleted ? patch.data?.binary : file.data?.binary;
  const repo = reader.group?.repo.name ?? (reader.locator.repoId === '$root' ? '根仓' : reader.locator.repoId);
  const dataReady = diff || deleted ? Boolean(patch.data) : Boolean(file.data);
  return <View style={{ flex: 1, minWidth: 0, minHeight: 220, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, backgroundColor: background }}>
    <View style={{ paddingHorizontal: 12, paddingVertical: 9, gap: 6, borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: compact ? 'wrap' : 'nowrap' }}><Icon name="FileCode2" size={16} color={theme.colors.foregroundMuted} /><Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: '600', flex: 1, minWidth: 70 }}>{path.split('/').pop()}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 5, borderWidth: 1, borderColor: theme.colors.border }}><Action label="全文" onPress={() => setReaderMode('file')} theme={theme} selected={!diff} /><Action label="Diff" onPress={() => setReaderMode('diff')} theme={theme} selected={diff} disabled={!reader.change || !reader.group} /></View>
        <Action label={wrap ? '取消折行' : '折行'} onPress={() => setWrap(value => !value)} theme={theme} selected={wrap} /><Action label={copied ? '已复制' : '复制'} onPress={() => void copy()} theme={theme} disabled={!dataReady || Boolean(binary)} />
      </View>
      <Text selectable numberOfLines={1} ellipsizeMode="middle" style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{repo} / {path}</Text>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}><Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{languageFor(path).toUpperCase()}{diff ? ` · ${comparison(reader)}` : ` · ${deleted ? '删除前内容' : `${file.data?.totalLines ?? '—'} 行`}`}</Text>{reader.change?.additions != null ? <Text style={{ color: theme.colors.statusSuccess, fontSize: 11 }}>+{reader.change.additions}</Text> : null}{reader.change?.deletions != null ? <Text style={{ color: theme.colors.statusDanger, fontSize: 11 }}>−{reader.change.deletions}</Text> : null}</View>
    {loading || error || binary ? <View style={{ padding: 16 }}><Text style={{ color: error ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 13 }}>{loading ? '正在读取…' : error ? error instanceof Error ? error.message : String(error) : '二进制文件无法显示文本内容'}</Text></View> : dataReady ? rows.length ? <CodeEditor key={`${reader.locator.repoId}:${path}:${readerMode}:${start}`} rows={rows} diff={diff} theme={theme} wrap={wrap} /> : <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>没有文本差异（可能仅文件名或属性发生变化）</Text> : null}
    {copyError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12, padding: 8 }}>{copyError}</Text> : null}
    {(diff && patch.data?.truncated) || (!diff && !deleted && file.data?.truncated) || highlighted.limited ? <View style={{ borderTopWidth: 1, borderColor: theme.colors.border, padding: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{diff ? 'Diff 已达到大小上限，当前显示部分内容' : highlighted.limited ? '当前分段较大，暂以纯文本显示' : '文件分段读取；超大文件仅扫描前 16 MiB'}</Text>{!diff && !deleted && file.data && start + file.data.content.split('\n').length - 1 < file.data.totalLines ? <Action label="读取下一段" onPress={onMore} theme={theme} /> : null}</View> : null}
  </View>;
}
