export type MediaKind = 'image' | 'video' | 'audio';
export type MediaReference = { source: string; label: string; kind: MediaKind };

const imageExtension = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg)(?:[?#].*)?$/i;
const videoExtension = /\.(?:mp4|webm|mov|m4v)(?:[?#].*)?$/i;
const audioExtension = /\.(?:mp3|wav|ogg|m4a|flac)(?:[?#].*)?$/i;

export function mediaKind(source: string): MediaKind | null {
  if (/^data:image\//i.test(source) || imageExtension.test(source)) return 'image';
  if (videoExtension.test(source)) return 'video';
  if (audioExtension.test(source)) return 'audio';
  return null;
}

export function safeSource(source: string): boolean {
  return source.length > 0 && source.length <= 24_000_000 && !/[\u0000-\u001f]/.test(source)
    && !/^(?:javascript|vbscript|blob):/i.test(source)
    && (!/^[a-z][a-z\d+.-]*:/i.test(source) || /^(?:https?:|file:|data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon);base64,)/i.test(source));
}

export function mediaLabel(source: string): string {
  if (source.startsWith('data:')) return '内嵌图片';
  let path = source.split(/[?#]/)[0] ?? source;
  try { path = decodeURIComponent(path); } catch { /* Preserve malformed filenames. */ }
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '图片';
}

/** Parse image references without treating code examples as attachments. */
export function extractMedia(text: string): MediaReference[] {
  const cleaned = text.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)/g, '$1')
    .replace(/(`+)[^\n]*?\1/g, '');
  const result: MediaReference[] = [];
  const start = /!\[([^\]\n]*)\]\(/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(cleaned))) {
    let pos = start.lastIndex;
    while (/\s/.test(cleaned[pos] ?? '') && pos < cleaned.length) pos++;
    let source = '';
    if (cleaned[pos] === '<') {
      const end = cleaned.indexOf('>', pos + 1);
      if (end < 0) continue;
      source = cleaned.slice(pos + 1, end); pos = end + 1;
    } else {
      let depth = 0;
      for (; pos < cleaned.length; pos++) {
        const ch = cleaned[pos]!;
        if (ch === '\\' && pos + 1 < cleaned.length) { source += cleaned[++pos]; continue; }
        if (ch === '(') depth++;
        if (ch === ')' && depth === 0) break;
        if (/\s/.test(ch) && depth === 0) break;
        if (ch === ')') depth--;
        source += ch;
      }
    }
    const tail = cleaned.slice(pos).match(/^\s*(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*?\))?\s*\)/);
    if (!tail || !safeSource(source)) continue;
    start.lastIndex = pos + tail[0].length;
    result.push({source, label: match[1]?.trim() || mediaLabel(source), kind: 'image'});
  }
  return result;
}

export function collectStructuredImages(value: unknown, budget = 1000): MediaReference[] {
  const output: MediaReference[] = [];
  const queue: unknown[] = [value];
  for (let i = 0; i < queue.length && i < budget; i++) {
    const current = queue[i];
    if (typeof current === 'string') {
      if (current.length < 1_000_000) output.push(...extractMedia(current));
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) { queue.push(...current.slice(0,100)); continue; }
    const object = current as Record<string, unknown>;
    const type = typeof object.type === 'string' ? object.type : '';
    const mime = typeof object.mimeType === 'string' ? object.mimeType : typeof object.mime_type === 'string' ? object.mime_type : '';
    if ((type === 'image' || mime.startsWith('image/')) && typeof object.data === 'string' && mime && /^[a-zA-Z0-9+/=\s]+$/.test(object.data)) {
      const source = `data:${mime};base64,${object.data}`;
      if (safeSource(source)) output.push({source,label:'工具返回图片',kind:'image'});
    }
    for (const key of ['image_url', 'url', 'uri', 'path', 'imagePath']) {
      const source = object[key];
      if (typeof source === 'string' && safeSource(source) && (mediaKind(source)==='image' || type==='image')) {
        output.push({source,label:mediaLabel(source),kind:'image'});
      }
    }
    for (const [key, child] of Object.entries(object)) {
      if (!['data','base64','input','arguments','env','headers'].includes(key)) queue.push(child);
    }
  }
  return output;
}

export function previewWindow<T>(items: readonly T[], limit: number, expanded: boolean) {
  const safeLimit = Math.max(1, Math.min(8, Math.floor(limit)));
  return { visible: expanded ? items : items.slice(0, safeLimit), total: items.length, hidden: expanded ? 0 : Math.max(0,items.length-safeLimit) };
}
