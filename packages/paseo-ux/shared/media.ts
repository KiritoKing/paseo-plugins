export type MediaKind = "image" | "video" | "audio" | "document" | "file";
export type MediaReference = {
  source: string;
  label: string;
  kind: MediaKind;
  mimeType: string | null;
  bytes: number | null;
};

type MediaDescription = { kind: MediaKind; mimeType: string | null };

const extensionInfo: Record<string, MediaDescription> = {
  ".png": { kind: "image", mimeType: "image/png" },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".gif": { kind: "image", mimeType: "image/gif" },
  ".webp": { kind: "image", mimeType: "image/webp" },
  ".avif": { kind: "image", mimeType: "image/avif" },
  ".bmp": { kind: "image", mimeType: "image/bmp" },
  ".ico": { kind: "image", mimeType: "image/x-icon" },
  ".svg": { kind: "image", mimeType: "image/svg+xml" },
  ".mp4": { kind: "video", mimeType: "video/mp4" },
  ".m4v": { kind: "video", mimeType: "video/mp4" },
  ".webm": { kind: "video", mimeType: "video/webm" },
  ".mov": { kind: "video", mimeType: "video/quicktime" },
  ".mkv": { kind: "video", mimeType: "video/x-matroska" },
  ".avi": { kind: "video", mimeType: "video/x-msvideo" },
  ".mp3": { kind: "audio", mimeType: "audio/mpeg" },
  ".wav": { kind: "audio", mimeType: "audio/wav" },
  ".ogg": { kind: "audio", mimeType: "audio/ogg" },
  ".oga": { kind: "audio", mimeType: "audio/ogg" },
  ".opus": { kind: "audio", mimeType: "audio/opus" },
  ".m4a": { kind: "audio", mimeType: "audio/mp4" },
  ".aac": { kind: "audio", mimeType: "audio/aac" },
  ".flac": { kind: "audio", mimeType: "audio/flac" },
  ".pdf": { kind: "document", mimeType: "application/pdf" },
  ".txt": { kind: "document", mimeType: "text/plain" },
  ".md": { kind: "document", mimeType: "text/markdown" },
  ".csv": { kind: "document", mimeType: "text/csv" },
  ".rtf": { kind: "document", mimeType: "application/rtf" },
  ".doc": { kind: "document", mimeType: "application/msword" },
  ".docx": {
    kind: "document",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".odt": { kind: "document", mimeType: "application/vnd.oasis.opendocument.text" },
  ".xls": { kind: "document", mimeType: "application/vnd.ms-excel" },
  ".xlsx": {
    kind: "document",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ".ods": { kind: "document", mimeType: "application/vnd.oasis.opendocument.spreadsheet" },
  ".ppt": { kind: "document", mimeType: "application/vnd.ms-powerpoint" },
  ".pptx": {
    kind: "document",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  ".odp": { kind: "document", mimeType: "application/vnd.oasis.opendocument.presentation" },
  ".json": { kind: "document", mimeType: "application/json" },
  ".xml": { kind: "document", mimeType: "application/xml" },
  ".zip": { kind: "file", mimeType: "application/zip" },
  ".gz": { kind: "file", mimeType: "application/gzip" },
  ".tar": { kind: "file", mimeType: "application/x-tar" },
  ".7z": { kind: "file", mimeType: "application/x-7z-compressed" },
  ".rar": { kind: "file", mimeType: "application/vnd.rar" },
};

const webPageExtensions = new Set([
  ".html",
  ".htm",
  ".php",
  ".asp",
  ".aspx",
  ".jsp",
  ".cgi",
  ".js",
  ".css",
]);
const portableAudioMimeTypes = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
]);
const rasterImageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
]);
const excludedStructuredKeys = new Set([
  "input",
  "arguments",
  "env",
  "headers",
  "credentials",
  "authorization",
  "cookie",
  "cookies",
  "base64",
]);
const sourceKeys = [
  "url",
  "uri",
  "path",
  "filePath",
  "file_path",
  "href",
  "src",
  "image_url",
  "file_url",
  "download_url",
  "source",
];

function normalizedMime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mime = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : null;
}

function dataUriMime(source: string): string | null {
  const match = source.match(/^data:([^;,]+);base64,/i);
  return match ? normalizedMime(match[1]) : null;
}

function mimeKind(mimeType: string): MediaKind | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType.includes("officedocument") ||
    mimeType.startsWith("application/vnd.oasis.opendocument") ||
    mimeType === "application/msword" ||
    mimeType === "application/rtf" ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  )
    return "document";
  if (mimeType.startsWith("application/")) return "file";
  return null;
}

function extensionOf(source: string): string {
  let withoutQuery = source.split(/[?#]/, 1)[0] ?? source;
  if (/^https?:\/\//i.test(source)) {
    try {
      withoutQuery = new URL(source).pathname;
    } catch {
      return "";
    }
  }
  const last = withoutQuery.split(/[\\/]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot).toLowerCase() : "";
}

/** Returns MIME and broad media category from explicit MIME metadata or a filename. */
export function mediaMetadata(
  source: string,
  mimeHint?: string | null,
  explicitKind?: MediaKind,
): MediaDescription | null {
  const mimeType = normalizedMime(mimeHint) ?? dataUriMime(source);
  if (mimeType) return { kind: mimeKind(mimeType) ?? explicitKind ?? "file", mimeType };
  const extension = extensionOf(source);
  const known = extensionInfo[extension];
  if (known) return known;
  if (extension && !webPageExtensions.has(extension) && /^\.[a-z0-9]{1,12}$/i.test(extension)) {
    return { kind: explicitKind ?? "file", mimeType: null };
  }
  return explicitKind ? { kind: explicitKind, mimeType: null } : null;
}

export function mediaKind(source: string, mimeType?: string | null): MediaKind | null {
  return mediaMetadata(source, mimeType)?.kind ?? null;
}

function allowedDataUri(source: string): boolean {
  const mime = dataUriMime(source);
  if (!mime) return false;
  return (
    rasterImageMimeTypes.has(mime) ||
    portableAudioMimeTypes.has(mime) ||
    mime.startsWith("video/") ||
    mime === "application/pdf" ||
    mime === "application/octet-stream" ||
    mime.startsWith("application/vnd.") ||
    mime === "application/zip" ||
    mime === "application/gzip"
  );
}

export function safeSource(source: string): boolean {
  if (!source || source.length > 24_000_000) return false;
  for (const character of source) if (character.charCodeAt(0) < 32) return false;
  if (/^(?:javascript|vbscript|blob):/i.test(source)) return false;
  if (/^data:/i.test(source)) return allowedDataUri(source);
  return !/^[a-z][a-z\d+.-]*:/i.test(source) || /^(?:https?:|file:)/i.test(source);
}

export function mediaLabel(source: string): string {
  if (source.startsWith("data:")) return "内嵌附件";
  let path = source.split(/[?#]/, 1)[0] ?? source;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep malformed file names readable. */
  }
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "附件";
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function codeMask(text: string): { text: string; hasCode: boolean } {
  const masked = text.split("");
  const blocked = new Uint8Array(text.length);
  let hasCode = false;
  let inFence: { char: string; length: number } | null = null;
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (inFence) {
      for (let i = lineStart; i < lineEnd; i++) {
        blocked[i] = 1;
        masked[i] = " ";
      }
      if (
        marker &&
        marker[1]![0] === inFence.char &&
        marker[1]!.length >= inFence.length &&
        /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(line)
      )
        inFence = null;
      hasCode = true;
    } else if (marker && !isEscaped(text, lineStart + marker[0].indexOf(marker[1]!))) {
      inFence = { char: marker[1]![0]!, length: marker[1]!.length };
      hasCode = true;
      for (let i = lineStart; i < lineEnd; i++) {
        blocked[i] = 1;
        masked[i] = " ";
      }
    } else if (/^(?: {4,}|\t| {0,3}>[ \t]+(?: {4,}|\t))/.test(line)) {
      hasCode = true;
      for (let i = lineStart; i < lineEnd; i++) {
        blocked[i] = 1;
        masked[i] = " ";
      }
    }
    lineStart = newline < 0 ? text.length : newline + 1;
  }

  const htmlCode = /<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  for (const htmlMatch of text.matchAll(htmlCode)) {
    hasCode = true;
    const end = htmlMatch.index + htmlMatch[0].length;
    for (let i = htmlMatch.index; i < end; i++) {
      blocked[i] = 1;
      if (text[i] !== "\n" && text[i] !== "\r") masked[i] = " ";
    }
  }

  for (let i = 0; i < text.length; ) {
    if (blocked[i] || text[i] !== "`" || isEscaped(text, i)) {
      i++;
      continue;
    }
    let runEnd = i + 1;
    while (text[runEnd] === "`") runEnd++;
    const length = runEnd - i;
    let close = runEnd;
    let end = -1;
    while (close < text.length) {
      const next = text.indexOf("`", close);
      if (next < 0) break;
      if (blocked[next] || isEscaped(text, next)) {
        close = next + 1;
        continue;
      }
      let nextEnd = next + 1;
      while (text[nextEnd] === "`") nextEnd++;
      if (nextEnd - next === length) {
        end = nextEnd;
        break;
      }
      close = nextEnd;
    }
    if (end < 0) {
      i = runEnd;
      continue;
    }
    hasCode = true;
    for (let j = i; j < end; j++) {
      blocked[j] = 1;
      if (text[j] !== "\n" && text[j] !== "\r") masked[j] = " ";
    }
    i = end;
  }
  return { text: masked.join(""), hasCode };
}

type ParsedLink = { start: number; end: number; label: string; source: string; image: boolean };

function parseLinks(text: string): { links: ParsedLink[]; maskedText: string; hasCode: boolean } {
  const { text: maskedText, hasCode } = codeMask(text);
  const links: ParsedLink[] = [];
  const start = /(!?)\[([^\]\n]*)\]\(/g;
  while (true) {
    const match = start.exec(maskedText);
    if (!match) break;
    const linkStart = match.index;
    if (isEscaped(maskedText, linkStart)) continue;
    let pos = start.lastIndex;
    while (/\s/.test(maskedText[pos] ?? "") && pos < maskedText.length) pos++;
    let source = "";
    if (maskedText[pos] === "<") {
      const end = maskedText.indexOf(">", pos + 1);
      if (end < 0 || maskedText.slice(pos, end).includes("\n")) continue;
      source = maskedText.slice(pos + 1, end);
      pos = end + 1;
    } else {
      let depth = 0;
      for (; pos < maskedText.length; pos++) {
        const ch = maskedText[pos]!;
        if (ch === "\\" && pos + 1 < maskedText.length) {
          source += maskedText[++pos];
          continue;
        }
        if (ch === "(") {
          depth++;
          source += ch;
          continue;
        }
        if (ch === ")" && depth === 0) break;
        if (/\s/.test(ch) && depth === 0) break;
        if (ch === ")") depth--;
        source += ch;
      }
    }
    while (/\s/.test(maskedText[pos] ?? "") && pos < maskedText.length) pos++;
    if (maskedText[pos] !== ")") {
      const quote = maskedText[pos];
      if (quote === '"' || quote === "'") {
        pos++;
        while (pos < maskedText.length && maskedText[pos] !== quote) pos++;
        if (maskedText[pos] !== quote) continue;
        pos++;
      } else if (quote === "(") {
        let depth = 1;
        pos++;
        while (pos < maskedText.length && depth > 0) {
          if (maskedText[pos] === "(") depth++;
          if (maskedText[pos] === ")") depth--;
          pos++;
        }
        if (depth !== 0) continue;
      }
      while (/\s/.test(maskedText[pos] ?? "") && pos < maskedText.length) pos++;
    }
    if (maskedText[pos] !== ")" || !safeSource(source)) continue;
    links.push({
      start: linkStart,
      end: pos + 1,
      label: match[2]?.trim() ?? "",
      source,
      image: match[1] === "!",
    });
    start.lastIndex = pos + 1;
  }
  return { links, maskedText, hasCode };
}

function referenceForMarkdown(link: ParsedLink): MediaReference | null {
  const description = mediaMetadata(link.source);
  if (!link.image && !description) return null;
  const resolved = description ?? { kind: "image" as const, mimeType: null };
  const label =
    link.label && !/^(?:image|图片)$/i.test(link.label) ? link.label : mediaLabel(link.source);
  return {
    source: link.source,
    label,
    kind: resolved.kind,
    mimeType: resolved.mimeType,
    bytes: null,
  };
}

/** Extract image and attachment links from Markdown, ignoring fenced and inline code. */
export function extractMedia(text: string): MediaReference[] {
  return parseLinks(text).links.flatMap((link) => {
    const reference = referenceForMarkdown(link);
    return reference ? [reference] : [];
  });
}

/** Return references only when the complete message is a whitespace-separated image gallery. */
export function extractImageOnlyMessage(text: string): MediaReference[] | null {
  const parsed = parseLinks(text);
  if (parsed.hasCode) return null;
  const images = parsed.links
    .filter((link) => link.image)
    .map(referenceForMarkdown)
    .filter((item): item is MediaReference => item?.kind === "image");
  if (!images.length) return null;
  const consumed = new Uint8Array(text.length);
  for (const link of parsed.links) {
    const reference = referenceForMarkdown(link);
    if (link.image && reference?.kind === "image") consumed.fill(1, link.start, link.end);
  }
  for (let i = 0; i < text.length; i++) if (!consumed[i] && !/\s/.test(text[i]!)) return null;
  return images;
}

function structuredKind(type: unknown): MediaKind | undefined {
  return typeof type === "string" &&
    ["image", "video", "audio", "document", "file", "attachment"].includes(type.toLowerCase())
    ? type.toLowerCase() === "attachment"
      ? "file"
      : (type.toLowerCase() as MediaKind)
    : undefined;
}

function displayLabel(value: Record<string, unknown>, source: string): string {
  for (const key of ["filename", "fileName", "name", "label", "title"]) {
    if (typeof value[key] === "string" && (value[key] as string).trim())
      return (value[key] as string).trim();
  }
  return mediaLabel(source);
}

function structuredReference(
  source: string,
  value: Record<string, unknown>,
  explicit?: MediaKind,
  mimeHint?: unknown,
): MediaReference | null {
  if (!safeSource(source)) return null;
  const mime = normalizedMime(mimeHint);
  const description = mediaMetadata(source, mime, explicit);
  if (!description) return null;
  const declared = value.bytes ?? value.size;
  const bytes =
    typeof declared === "number" && Number.isFinite(declared) && declared >= 0 ? declared : null;
  return {
    source,
    label: displayLabel(value, source),
    kind: description.kind,
    mimeType: description.mimeType,
    bytes,
  };
}

/** Collect structured attachments and Markdown embedded in user-facing tool output. */
export function collectStructuredMedia(value: unknown, budget = 1000): MediaReference[] {
  const output: MediaReference[] = [];
  const queue: unknown[] = [value];
  const visited = new WeakSet<object>();
  for (let i = 0; i < queue.length && i < budget; i++) {
    const current = queue[i];
    if (typeof current === "string") {
      if (current.length <= 24_000_000) output.push(...extractMedia(current));
      continue;
    }
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 100));
      continue;
    }
    const object = current as Record<string, unknown>;
    const type = structuredKind(object.type);
    const mime = object.mimeType ?? object.mime_type ?? object.contentType ?? object.content_type;
    for (const key of sourceKeys) {
      const source = object[key];
      if (typeof source !== "string") continue;
      const reference = structuredReference(source, object, type, mime);
      if (reference) output.push(reference);
    }
    const mimeType = normalizedMime(mime);
    if (
      typeof object.data === "string" &&
      mimeType &&
      object.data.length <= 24_000_000 &&
      /^[a-zA-Z0-9+/=\r\n]+$/.test(object.data)
    ) {
      const source = `data:${mimeType};base64,${object.data.replace(/[\r\n]/g, "")}`;
      const reference = structuredReference(source, object, type, mimeType);
      if (reference) output.push(reference);
    }
    for (const [key, child] of Object.entries(object)) {
      if (!excludedStructuredKeys.has(key.toLowerCase()) && key !== "data") queue.push(child);
    }
  }
  return output;
}

/** Kept for consumers that only need structured image references. */
export function collectStructuredImages(value: unknown, budget = 1000): MediaReference[] {
  return collectStructuredMedia(value, budget).filter((reference) => reference.kind === "image");
}

export function previewWindow<T>(items: readonly T[], limit: number, expanded: boolean) {
  const safeLimit = Math.max(1, Math.min(8, Math.floor(limit)));
  return {
    visible: expanded ? items : items.slice(0, safeLimit),
    total: items.length,
    hidden: expanded ? 0 : Math.max(0, items.length - safeLimit),
  };
}
