import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { listMedia, MediaAsset, readMedia } from "../shared/contracts";
import { collectStructuredImages, extractMedia, mediaLabel, safeSource } from "../shared/media";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
const MAX_BYTES = 16 * 1024 * 1024;
type Catalog = { cwd: string; epoch: string; assets: Map<string, MediaAsset>; updated: number };
export const catalogs = new Map<string, Catalog>();

export function assetId(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 24);
}

export async function loadMedia(
  input: RpcInput<typeof listMedia>,
  { paseo }: PluginHandlerContext,
) {
  const ref = paseo.agents.ref(input.agentId);
  const page = await ref.timeline.refetch({
    direction: input.cursor ? "before" : "tail",
    limit: 200,
    projection: "canonical",
    ...(input.cursor ? { cursor: input.cursor } : {}),
  });
  if (page.error) throw new Error(page.error);
  const cwd = page.agent?.cwd ?? ref.cwd;
  if (!cwd) throw new Error("会话目录暂不可用，请稍后重试。");
  const epoch = page.startCursor?.epoch ?? page.endCursor?.epoch ?? input.cursor?.epoch ?? "empty";
  let catalog = catalogs.get(input.agentId);
  if (!catalog || catalog.epoch !== epoch) {
    catalog = { cwd, epoch, assets: new Map(), updated: Date.now() };
    catalogs.set(input.agentId, catalog);
  }
  catalog.cwd = cwd;
  catalog.updated = Date.now();
  const assets: MediaAsset[] = [];
  for (const entry of page.entries) {
    const item = entry.item;
    const references =
      item.type === "assistant_message" || item.type === "user_message"
        ? extractMedia(item.text)
        : item.type === "tool_call"
          ? collectStructuredImages(item.detail)
          : [];
    const origin =
      item.type === "tool_call" ? "tool" : item.type === "user_message" ? "user" : "assistant";
    for (const reference of references) {
      if (!safeSource(reference.source)) continue;
      const id = assetId(reference.source);
      const asset: MediaAsset = {
        id,
        source: reference.source.startsWith("data:") ? `embedded:${id}` : reference.source,
        label: /^(?:image|图片)$/i.test(reference.label)
          ? mediaLabel(reference.source)
          : reference.label,
        kind: "image",
        timestamp: entry.timestamp,
        origin,
        seq: entry.seqStart,
      };
      // Keep bytes inside the daemon catalog, never include them in a metadata listing.
      catalog.assets.set(id, { ...asset, source: reference.source });
      if (!assets.some((x) => x.id === id)) assets.push(asset);
    }
  }
  for (const [id, cached] of catalogs)
    if (Date.now() - cached.updated > 30 * 60 * 1000) catalogs.delete(id);
  while (catalogs.size > 30) catalogs.delete(catalogs.keys().next().value!);
  return { assets, hasOlder: page.hasOlder, cursor: page.startCursor, epoch };
}

export async function readImageFile(path: string) {
  const mimeType = MIME[extname(path).toLowerCase()];
  if (!mimeType) throw new Error("该文件格式暂不支持图片预览。");
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("图片文件不可用。");
    if (info.size > MAX_BYTES) throw new Error("图片超过 16 MiB，暂不内嵌预览。");
    // A fixed buffer bounds allocation even if the file grows after stat().
    const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_BYTES + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES || length > info.size) throw new Error("图片正在变化，请稍后重试。");
    const data = buffer.subarray(0, length);
    return { uri: `data:${mimeType};base64,${data.toString("base64")}`, bytes: length, mimeType };
  } finally {
    await handle.close();
  }
}

export async function readAsset(input: RpcInput<typeof readMedia>) {
  const catalog = catalogs.get(input.agentId);
  const asset = catalog?.assets.get(input.assetId);
  if (!catalog || !asset) throw new Error("请先刷新当前会话的媒体列表。");
  const source = asset.source;
  if (/^https?:\/\//i.test(source)) return { uri: source, bytes: 0, mimeType: "image/*" };
  if (source.startsWith("data:")) {
    const bytes = Math.floor((source.split(",")[1]!.length * 3) / 4);
    if (bytes > MAX_BYTES) throw new Error("图片超过 16 MiB，暂不内嵌预览。");
    return { uri: source, bytes, mimeType: source.slice(5, source.indexOf(";")) };
  }
  const path = source.startsWith("file:") ? fileURLToPath(source) : resolve(catalog.cwd, source);
  return readImageFile(path);
}
