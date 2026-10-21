import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  listMedia,
  MediaAsset,
  MediaCursor,
  readMedia,
  resolveMedia,
} from "../shared/contracts";
import {
  collectStructuredMedia,
  extractMedia,
  type MediaKind,
  type MediaReference,
  mediaLabel,
  mediaMetadata,
  safeSource,
} from "../shared/media";

const MAX_BYTES = 16 * 1024 * 1024;
const PAGE_SIZE = 200;
const MAX_RESOLVE_PAGES = 20;
const MAX_RESOLVE_ENTRIES = PAGE_SIZE * MAX_RESOLVE_PAGES;
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};
const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
]);
const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
]);

type Catalog = { cwd: string; epoch: string; assets: Map<string, MediaAsset>; updated: number };
export const catalogs = new Map<string, Catalog>();

export function assetId(source: string, cwd?: string): string {
  let identity = source;
  if (/^https?:\/\//i.test(source)) {
    try {
      identity = new URL(source).href;
    } catch {
      /* Retain the original malformed source for a deterministic ID. */
    }
  } else if (cwd && !isEmbedded(source)) {
    try {
      identity = source.startsWith("file:") ? fileURLToPath(source) : resolve(cwd, source);
    } catch {
      /* Retain the raw source if it is not a local path. */
    }
  }
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function isRemote(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function isEmbedded(source: string): boolean {
  return /^data:/i.test(source);
}

function dataBytes(source: string): number | null {
  const comma = source.indexOf(",");
  if (comma < 0 || !/;base64,/i.test(source.slice(0, comma + 1))) return null;
  const data = source.slice(comma + 1);
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(data)) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function localPath(cwd: string, source: string): string {
  return source.startsWith("file:") ? fileURLToPath(source) : resolve(cwd, source);
}

async function referenceBytes(cwd: string, reference: MediaReference): Promise<number | null> {
  if (reference.bytes !== null) return reference.bytes;
  if (isEmbedded(reference.source)) return dataBytes(reference.source);
  if (isRemote(reference.source)) return null;
  try {
    const info = await stat(localPath(cwd, reference.source));
    return info.isFile() && Number.isFinite(info.size) && info.size >= 0 ? info.size : null;
  } catch {
    return null;
  }
}

function referencePreview(reference: MediaReference): MediaAsset["preview"] {
  const mime = reference.mimeType ?? mediaMetadata(reference.source)?.mimeType ?? null;
  if (isRemote(reference.source) && safeSource(reference.source)) {
    if (
      reference.kind === "image" ||
      reference.kind === "video" ||
      (reference.kind === "audio" && AUDIO_MIMES.has(mime ?? ""))
    )
      return "external";
    return "none";
  }
  if (reference.kind === "image" && mime && IMAGE_MIMES.has(mime)) return "image";
  if (reference.kind === "audio" && mime && AUDIO_MIMES.has(mime)) return "audio";
  return "none";
}

function timelineReferences(item: {
  type: string;
  text?: string;
  detail?: unknown;
}): MediaReference[] {
  if (item.type === "assistant_message" || item.type === "user_message")
    return extractMedia(item.text ?? "");
  if (item.type === "tool_call") return collectStructuredMedia(item.detail);
  return [];
}

function assertTimelinePage(
  page: {
    projection?: string;
    epoch: string;
    reset?: boolean;
    staleCursor?: boolean;
    gap?: boolean;
  },
  cursor?: MediaCursor,
) {
  // Media browsing follows the same public projection as the conversation UI.
  // 0.12 returns projected rows even for a canonical request. Keep every page
  // and read on one explicit projection so their epoch/cursors stay comparable.
  if (page.projection !== "projected")
    throw new Error("Conversation history format is unsupported. Refresh attachments to retry.");
  if (cursor && (page.epoch !== cursor.epoch || page.reset || page.staleCursor || page.gap)) {
    throw new Error("会话历史已更新，请刷新媒体列表后重试。");
  }
  if (!cursor && page.gap) throw new Error("会话历史不完整，无法建立媒体索引。");
}

async function conversationDirectory(
  ref: ReturnType<PluginHandlerContext["paseo"]["agents"]["ref"]>,
  page: { agent?: { cwd?: string } | null },
) {
  const cached = page.agent?.cwd ?? ref.cwd;
  if (cached) return cached;
  // Timeline pages may omit the agent snapshot. A fresh handle has no cached
  // cwd; fetch it through the public SDK rather than guessing a local directory.
  const current = await ref.refresh();
  if (!current?.agent.cwd)
    throw new Error("Conversation directory is unavailable. Refresh to retry.");
  return current.agent.cwd;
}

export async function loadMedia(
  input: RpcInput<typeof listMedia>,
  { paseo }: PluginHandlerContext,
) {
  const ref = paseo.agents.ref(input.agentId);
  const page = await ref.timeline.refetch({
    direction: input.cursor ? "before" : "tail",
    limit: PAGE_SIZE,
    projection: "projected",
    ...(input.cursor ? { cursor: input.cursor } : {}),
  });
  if (page.error) throw new Error(page.error);
  assertTimelinePage(page, input.cursor);
  const cwd = await conversationDirectory(ref, page);
  const epoch = page.epoch;
  let catalog = catalogs.get(input.agentId);
  if (!catalog || catalog.epoch !== epoch) {
    catalog = { cwd, epoch, assets: new Map(), updated: Date.now() };
    catalogs.set(input.agentId, catalog);
  }
  catalog.cwd = cwd;
  catalog.updated = Date.now();

  const pageAssets = new Map<string, MediaAsset>();
  for (const entry of page.entries) {
    for (const reference of timelineReferences(entry.item)) {
      if (!safeSource(reference.source)) continue;
      const id = assetId(reference.source, cwd);
      const publicAsset: MediaAsset = {
        id,
        source: isEmbedded(reference.source) ? `embedded:${id}` : reference.source,
        label: /^(?:image|图片|内嵌附件|附件)$/i.test(reference.label)
          ? mediaLabel(reference.source)
          : reference.label,
        kind: reference.kind,
        mimeType: reference.mimeType ?? mediaMetadata(reference.source)?.mimeType ?? null,
        bytes: await referenceBytes(cwd, reference),
        preview: referencePreview(reference),
        timestamp: entry.timestamp,
        origin:
          entry.item.type === "tool_call"
            ? "tool"
            : entry.item.type === "user_message"
              ? "user"
              : "assistant",
        seq: entry.seqStart,
      };
      // Keep the first timeline occurrence already seen for a resource so older
      // pages add history without replacing its original timeline provenance.
      if (!catalog.assets.has(id))
        catalog.assets.set(id, { ...publicAsset, source: reference.source });
      const listed = catalog.assets.get(id)!;
      if (!pageAssets.has(id)) pageAssets.set(id, listed);
    }
  }
  for (const [id, asset] of pageAssets) {
    if (isEmbedded(asset.source)) pageAssets.set(id, { ...asset, source: `embedded:${id}` });
  }
  for (const [id, cached] of catalogs)
    if (Date.now() - cached.updated > 30 * 60 * 1000) catalogs.delete(id);
  while (catalogs.size > 30) catalogs.delete(catalogs.keys().next().value!);
  return {
    assets: [...pageAssets.values()],
    hasOlder: page.hasOlder,
    cursor: page.startCursor,
    epoch,
  };
}

function readMime(kind: MediaKind, mimeType: string | null): string | null {
  if (!mimeType) return null;
  if (kind === "image" && IMAGE_MIMES.has(mimeType)) return mimeType;
  if (kind === "audio" && AUDIO_MIMES.has(mimeType)) return mimeType;
  return null;
}

async function readLocalFile(path: string, mimeType: string) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("附件文件不可用。");
    if (info.size > MAX_BYTES) throw new Error("附件超过 16 MiB，暂不内嵌预览。");
    // A fixed buffer caps allocation even when a file changes after stat().
    const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_BYTES + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES || length !== info.size) throw new Error("附件正在变化，请稍后重试。");
    const data = buffer.subarray(0, length);
    return { uri: `data:${mimeType};base64,${data.toString("base64")}`, bytes: length, mimeType };
  } finally {
    await handle.close();
  }
}

/** Kept as a compatibility export for callers that only read image files. */
export async function readImageFile(path: string) {
  const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()];
  if (!mimeType || !IMAGE_MIMES.has(mimeType)) throw new Error("该文件格式暂不支持图片预览。");
  return readLocalFile(path, mimeType);
}

async function readReference(reference: MediaReference, cwd: string) {
  const mimeType = reference.mimeType ?? mediaMetadata(reference.source)?.mimeType ?? null;
  if (isRemote(reference.source)) {
    if (
      !safeSource(reference.source) ||
      !(
        reference.kind === "image" ||
        reference.kind === "video" ||
        (reference.kind === "audio" && AUDIO_MIMES.has(mimeType ?? ""))
      )
    ) {
      throw new Error("该远程附件暂不支持打开。");
    }
    return {
      uri: reference.source,
      bytes: reference.bytes ?? 0,
      mimeType: mimeType ?? "application/octet-stream",
    };
  }
  if (isEmbedded(reference.source)) {
    const mime = readMime(reference.kind, mimeType);
    const bytes = dataBytes(reference.source);
    if (!mime || bytes === null) throw new Error("该内嵌附件格式暂不支持预览。");
    if (bytes > MAX_BYTES) throw new Error("附件超过 16 MiB，暂不内嵌预览。");
    return { uri: reference.source, bytes, mimeType: mime };
  }
  const mime = readMime(reference.kind, mimeType);
  if (!mime || (reference.kind !== "image" && reference.kind !== "audio"))
    throw new Error("该文件类型暂不支持预览。");
  return readLocalFile(localPath(cwd, reference.source), mime);
}

function referenceFromAsset(asset: MediaAsset): MediaReference {
  return {
    source: asset.source,
    label: asset.label,
    kind: asset.kind,
    mimeType: asset.mimeType,
    bytes: asset.bytes,
  };
}

export async function readAsset(
  input: RpcInput<typeof readMedia>,
  { paseo }: PluginHandlerContext,
) {
  const catalog = catalogs.get(input.agentId);
  const asset = catalog?.assets.get(input.assetId);
  if (!catalog || !asset) throw new Error("请先刷新当前会话的媒体列表。");
  const ref = paseo.agents.ref(input.agentId);
  const current = await ref.timeline.refetch({
    direction: "tail",
    limit: 1,
    projection: "projected",
  });
  if (current.error) throw new Error(current.error);
  assertTimelinePage(current);
  if (
    current.epoch !== catalog.epoch ||
    catalogs.get(input.agentId) !== catalog ||
    (await conversationDirectory(ref, current)) !== catalog.cwd
  ) {
    if (catalogs.get(input.agentId) === catalog) catalogs.delete(input.agentId);
    throw new Error(
      "Conversation history changed. Refresh attachments before reading this source.",
    );
  }
  // Embedded sources remain internal to this catalog; only the metadata RPC uses
  // the public `embedded:<id>` token.
  const reference = referenceFromAsset(asset);
  return readReference(reference, catalog.cwd);
}

/** Resolve and read an exact source only after finding it in the agent's timeline history. */
export async function readReferencedAsset(
  input: RpcInput<typeof resolveMedia>,
  { paseo }: PluginHandlerContext,
) {
  if (!safeSource(input.source)) throw new Error("附件来源无效。");
  const ref = paseo.agents.ref(input.agentId);
  let cursor: MediaCursor | undefined;
  let epoch: string | undefined;
  let previousStartSeq: number | undefined;
  let scanned = 0;
  for (let pageNumber = 0; pageNumber < MAX_RESOLVE_PAGES; pageNumber++) {
    const page = await ref.timeline.refetch({
      direction: cursor ? "before" : "tail",
      limit: PAGE_SIZE,
      projection: "projected",
      ...(cursor ? { cursor } : {}),
    });
    if (page.error) throw new Error(page.error);
    assertTimelinePage(page, cursor);
    if (epoch !== undefined && page.epoch !== epoch)
      throw new Error("会话历史版本已变化，无法安全解析附件。");
    if (!cursor && page.gap) throw new Error("会话历史不完整，无法安全解析附件。");
    epoch = page.epoch;
    for (const entry of page.entries) {
      scanned++;
      const match = timelineReferences(entry.item).find(
        (reference) => reference.source === input.source,
      );
      if (match) {
        const cwd = await conversationDirectory(ref, page);
        return readReference(match, cwd);
      }
    }
    if (!page.hasOlder) throw new Error("该来源不在此会话的历史中。");
    if (scanned >= MAX_RESOLVE_ENTRIES || pageNumber + 1 >= MAX_RESOLVE_PAGES) {
      throw new Error(`历史搜索超过 ${MAX_RESOLVE_ENTRIES} 条媒体记录的安全边界。`);
    }
    const next = page.startCursor;
    if (!next) throw new Error("媒体历史游标缺失，无法继续查找。");
    if (next.epoch !== epoch || (previousStartSeq !== undefined && next.seq >= previousStartSeq)) {
      throw new Error("媒体历史游标没有向更早记录推进。");
    }
    previousStartSeq = next.seq;
    cursor = next;
  }
  throw new Error(`历史搜索超过 ${MAX_RESOLVE_ENTRIES} 条媒体记录的安全边界。`);
}
