import type { Token, Tokens } from "marked";
import { z } from "zod";
import { Marked } from "./vendor/marked";

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_PRESENTATION_NODES = 4096;
const MAX_PRESENTATION_DEPTH = 32;

export type InlineNode =
  | { type: "text" | "code"; text: string }
  | { type: "strong" | "em" | "del"; children: InlineNode[] }
  | { type: "link"; url: string; children: InlineNode[] }
  | { type: "break" };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: number; children: InlineNode[] }
  | { type: "code"; text: string; language?: string }
  | { type: "blockquote"; blocks: BlockNode[] }
  | { type: "list"; ordered: boolean; start?: number; items: BlockNode[][] }
  | { type: "hr" };

export type MessagePresentation = {
  sourceText: string;
  blocks: BlockNode[];
  phase: "streaming" | "complete";
};

const markdown = new Marked({ gfm: true, breaks: false });
const invalidPresentationInput = Symbol("invalid presentation input");

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > MAX_SOURCE_BYTES) return bytes;
  }
  return bytes;
}

function isSafeHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || value.trim() !== value) {
    return false;
  }
  // Reject controls, whitespace and backslashes before URL normalization.
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return false;
  }

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

const httpUrlSchema = z.string().refine(isSafeHttpUrl, "Expected an absolute HTTP(S) URL");

const inlineSchemaCache = new Map<number, z.ZodType<InlineNode>>();
function inlineNodeSchemaAt(depth: number): z.ZodType<InlineNode> {
  const cached = inlineSchemaCache.get(depth);
  if (cached) return cached;

  const children =
    depth < MAX_PRESENTATION_DEPTH
      ? z.array(z.lazy(() => inlineNodeSchemaAt(depth + 1))).max(MAX_PRESENTATION_NODES)
      : z.array(z.never()).max(0);

  const schema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }).strict(),
    z.object({ type: z.literal("code"), text: z.string() }).strict(),
    z.object({ type: z.literal("strong"), children }).strict(),
    z.object({ type: z.literal("em"), children }).strict(),
    z.object({ type: z.literal("del"), children }).strict(),
    z.object({ type: z.literal("link"), url: httpUrlSchema, children }).strict(),
    z.object({ type: z.literal("break") }).strict(),
  ]) as z.ZodType<InlineNode>;

  inlineSchemaCache.set(depth, schema);
  return schema;
}

const blockSchemaCache = new Map<number, z.ZodType<BlockNode>>();
function blockNodeSchemaAt(depth: number): z.ZodType<BlockNode> {
  const cached = blockSchemaCache.get(depth);
  if (cached) return cached;

  const inlineChildren = z.array(inlineNodeSchemaAt(1)).max(MAX_PRESENTATION_NODES);
  const nestedBlocks =
    depth < MAX_PRESENTATION_DEPTH
      ? z.array(z.lazy(() => blockNodeSchemaAt(depth + 1))).max(MAX_PRESENTATION_NODES)
      : z.array(z.never()).max(0);
  const listItems =
    depth < MAX_PRESENTATION_DEPTH
      ? z
          .array(z.array(z.lazy(() => blockNodeSchemaAt(depth + 1))).max(MAX_PRESENTATION_NODES))
          .max(MAX_PRESENTATION_NODES)
      : z.array(z.array(z.never()).max(0)).max(0);

  const schema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), children: inlineChildren }).strict(),
    z
      .object({
        type: z.literal("heading"),
        level: z.number().int().min(1).max(6),
        children: inlineChildren,
      })
      .strict(),
    z
      .object({ type: z.literal("code"), text: z.string(), language: z.string().optional() })
      .strict(),
    z.object({ type: z.literal("blockquote"), blocks: nestedBlocks }).strict(),
    z
      .object({
        type: z.literal("list"),
        ordered: z.boolean(),
        start: z.number().int().safe().min(0).optional(),
        items: listItems,
      })
      .strict(),
    z.object({ type: z.literal("hr") }).strict(),
  ]) as z.ZodType<BlockNode>;

  blockSchemaCache.set(depth, schema);
  return schema;
}

function readPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as Record<string, unknown>;
}

function hasOwnEnumerableDataProperties(value: object): boolean {
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return false;
  }
  return true;
}

function readDataProperty(record: object, key: string): { found: boolean; value?: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { found: false };
  if (!descriptor.enumerable || !("value" in descriptor)) return { found: true };
  return { found: true, value: descriptor.value };
}

function readPlainArray(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  if (value.length > MAX_PRESENTATION_NODES) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string"))
    return undefined;

  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) return undefined;
    values.push(descriptor.value);
  }
  return values;
}

/** Bounds recursive Zod work before it touches caller-supplied objects. */
function hasBoundedPresentationEnvelope(value: unknown): boolean {
  try {
    const record = readPlainRecord(value);
    if (!record) return false;

    const keys = Reflect.ownKeys(record);
    if (
      keys.some(
        (key) => typeof key !== "string" || !["sourceText", "blocks", "phase"].includes(key),
      )
    ) {
      return false;
    }
    const sourceText = readDataProperty(record, "sourceText");
    const blocks = readDataProperty(record, "blocks");
    const phase = readDataProperty(record, "phase");
    if (
      !sourceText.found ||
      typeof sourceText.value !== "string" ||
      utf8ByteLength(sourceText.value) > MAX_SOURCE_BYTES ||
      !blocks.found ||
      !phase.found
    ) {
      return false;
    }

    const initialBlocks = readPlainArray(blocks.value);
    if (!initialBlocks) return false;
    const stack: Array<{ node: unknown; depth: number }> = initialBlocks.map((node) => ({
      node,
      depth: 1,
    }));
    let count = 0;

    const pushArray = (arrayValue: unknown, depth: number): boolean => {
      const entries = readPlainArray(arrayValue);
      if (!entries) return false;
      for (const node of entries) stack.push({ node, depth });
      return true;
    };

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || current.depth > MAX_PRESENTATION_DEPTH || ++count > MAX_PRESENTATION_NODES)
        return false;
      const node = readPlainRecord(current.node);
      if (!node || !hasOwnEnumerableDataProperties(node)) return false;
      const type = readDataProperty(node, "type");
      if (!type.found || typeof type.value !== "string") return false;

      if (["text", "code", "break", "hr"].includes(type.value)) continue;
      if (["strong", "em", "del", "link", "paragraph", "heading"].includes(type.value)) {
        const children = readDataProperty(node, "children");
        if (!children.found || !pushArray(children.value, current.depth + 1)) return false;
        continue;
      }
      if (type.value === "blockquote") {
        const nested = readDataProperty(node, "blocks");
        if (!nested.found || !pushArray(nested.value, current.depth + 1)) return false;
        continue;
      }
      if (type.value === "list") {
        const items = readDataProperty(node, "items");
        const itemValues = items.found ? readPlainArray(items.value) : undefined;
        if (!itemValues) return false;
        for (const item of itemValues) {
          const itemBlocks = readPlainArray(item);
          if (!itemBlocks) return false;
          for (const child of itemBlocks) stack.push({ node: child, depth: current.depth + 1 });
        }
        continue;
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const messagePresentationShapeSchema = z
  .object({
    sourceText: z.string().refine((text) => utf8ByteLength(text) <= MAX_SOURCE_BYTES),
    blocks: z.array(blockNodeSchemaAt(1)).max(MAX_PRESENTATION_NODES),
    phase: z.enum(["streaming", "complete"]),
  })
  .strict();

export const messagePresentationSchema = z
  .preprocess(
    (value) => (hasBoundedPresentationEnvelope(value) ? value : invalidPresentationInput),
    messagePresentationShapeSchema,
  )
  .superRefine((presentation, context) => {
    const stack: Array<{ node: BlockNode | InlineNode; path: Array<string | number> }> = [];
    presentation.blocks.forEach((node, index) => {
      stack.push({ node, path: ["blocks", index] });
    });

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      const { node, path } = current;
      if (node.type === "link" && !isSafeHttpUrl(node.url)) {
        context.addIssue({
          code: "custom",
          path: [...path, "url"],
          message: "Expected an absolute HTTP(S) URL",
        });
      }
      if (node.type === "paragraph" || node.type === "heading") {
        node.children.forEach((child, index) => {
          stack.push({ node: child, path: [...path, "children", index] });
        });
      } else if (
        node.type === "strong" ||
        node.type === "em" ||
        node.type === "del" ||
        node.type === "link"
      ) {
        node.children.forEach((child, index) => {
          stack.push({ node: child, path: [...path, "children", index] });
        });
      } else if (node.type === "blockquote") {
        node.blocks.forEach((child, index) => {
          stack.push({ node: child, path: [...path, "blocks", index] });
        });
      } else if (node.type === "list") {
        if (!node.ordered && node.start !== undefined) {
          context.addIssue({
            code: "custom",
            path: [...path, "start"],
            message: "Unordered lists cannot have a start value",
          });
        }
        node.items.forEach((item, itemIndex) => {
          item.forEach((child, childIndex) => {
            stack.push({ node: child, path: [...path, "items", itemIndex, childIndex] });
          });
        });
      }
    }
  });

function messageSourceText(item: unknown): string | undefined {
  try {
    const record = readPlainRecord(item);
    if (!record) return undefined;
    const keys = Reflect.ownKeys(record);
    if (
      keys.some((key) => typeof key !== "string" || !["type", "text", "messageId"].includes(key))
    ) {
      return undefined;
    }

    const type = readDataProperty(record, "type");
    const text = readDataProperty(record, "text");
    const messageId = readDataProperty(record, "messageId");
    if (
      !type.found ||
      type.value !== "assistant_message" ||
      !text.found ||
      typeof text.value !== "string" ||
      (messageId.found && typeof messageId.value !== "string")
    ) {
      return undefined;
    }
    return text.value;
  } catch {
    return undefined;
  }
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function stripContainerPrefixes(line: string): string {
  let remainder = line;
  for (let depth = 0; depth < MAX_PRESENTATION_DEPTH; depth += 1) {
    const quote = remainder.match(/^ {0,3}>[\t ]?/);
    if (quote) {
      remainder = remainder.slice(quote[0].length);
      continue;
    }
    const list = remainder.match(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[\t ]+/);
    if (list) {
      remainder = remainder.slice(list[0].length);
      continue;
    }
    break;
  }
  return remainder;
}

function maskFencedCode(sourceText: string): { text: string; unclosed: boolean } {
  const characters = sourceText.split("");
  const segments = sourceText.split(/(\r\n|\n|\r)/);
  let sourceOffset = 0;
  let activeFence: { character: string; length: number } | undefined;

  for (let index = 0; index < segments.length; index += 2) {
    const line = segments[index] ?? "";
    const candidate = stripContainerPrefixes(line);
    if (activeFence) {
      for (let cursor = sourceOffset; cursor < sourceOffset + line.length; cursor += 1)
        characters[cursor] = " ";
      const closing = candidate.match(/^ {0,3}(`+|~+)[\t ]*$/);
      if (
        closing &&
        closing[1]?.[0] === activeFence.character &&
        closing[1].length >= activeFence.length
      ) {
        activeFence = undefined;
      }
    } else {
      const opening = candidate.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      const marker = opening?.[1];
      const info = opening?.[2] ?? "";
      if (marker && !(marker[0] === "`" && info.includes("`"))) {
        activeFence = { character: marker[0] ?? "`", length: marker.length };
        for (let cursor = sourceOffset; cursor < sourceOffset + line.length; cursor += 1)
          characters[cursor] = " ";
      }
    }

    sourceOffset += line.length;
    const ending = segments[index + 1] ?? "";
    sourceOffset += ending.length;
  }

  return { text: characters.join(""), unclosed: activeFence !== undefined };
}

function maskInlineCode(sourceText: string): { text: string; unclosed: boolean } {
  const characters = sourceText.split("");
  const pending = new Map<number, number[]>();
  for (let index = 0; index < sourceText.length; index += 1) {
    if (characters[index] !== "`" || isEscaped(sourceText, index)) continue;
    let end = index + 1;
    while (sourceText[end] === "`") end += 1;
    const length = end - index;
    const openings = pending.get(length) ?? [];
    const opening = openings.pop();
    if (opening === undefined) {
      openings.push(index);
      pending.set(length, openings);
    } else {
      for (let cursor = opening; cursor < end; cursor += 1) {
        if (characters[cursor] !== "\r" && characters[cursor] !== "\n") characters[cursor] = " ";
      }
    }
    index = end - 1;
  }
  return {
    text: characters.join(""),
    unclosed: [...pending.values()].some((openings) => openings.length > 0),
  };
}

function hasUnclosedLinkSyntax(text: string): boolean {
  let bracketDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (isEscaped(text, index)) continue;
    if (text[index] === "[") {
      bracketDepth += 1;
      continue;
    }
    if (text[index] !== "]") continue;
    if (bracketDepth > 0) bracketDepth -= 1;
    if (bracketDepth !== 0 || text[index + 1] !== "(") continue;

    let parenthesisDepth = 1;
    for (let cursor = index + 2; cursor < text.length; cursor += 1) {
      if (isEscaped(text, cursor)) continue;
      if (text[cursor] === "(") parenthesisDepth += 1;
      if (text[cursor] === ")") parenthesisDepth -= 1;
      if (parenthesisDepth === 0) {
        index = cursor;
        break;
      }
    }
    if (parenthesisDepth !== 0) return true;
  }
  return bracketDepth !== 0;
}

function hasUnpairedTextDelimiters(tokens: Token[]): boolean {
  for (const token of tokens) {
    if (token.type === "text") {
      const textToken = token as Tokens.Text;
      if (textToken.tokens) {
        if (hasUnpairedTextDelimiters(textToken.tokens)) return true;
        continue;
      }
      const source = textToken.raw;
      const pending = new Map<string, number>();
      for (let index = 0; index < source.length; index += 1) {
        if (isEscaped(source, index)) continue;
        const character = source[index];
        if (character !== "*" && character !== "_" && character !== "~") continue;
        let end = index + 1;
        while (source[end] === character) end += 1;
        const length = end - index;
        if (character === "~" && length < 2) {
          index = end - 1;
          continue;
        }
        const key = character.repeat(length);
        const count = pending.get(key) ?? 0;
        pending.set(key, count === 0 ? 1 : 0);
        index = end - 1;
      }
      if ([...pending.values()].some((count) => count > 0)) return true;
    } else if (
      "tokens" in token &&
      Array.isArray(token.tokens) &&
      hasUnpairedTextDelimiters(token.tokens)
    ) {
      return true;
    }
  }
  return false;
}

function hasIncompleteStreamingSuffix(sourceText: string, safeText: string): boolean {
  const lines = safeText.split(/\r\n|\n|\r/);
  const lastLine = [...lines].reverse().find((line) => line.trim().length > 0) ?? "";
  if (/^ {0,3}(?:#{1,6}|>|[-+*]|\d{1,9}[.)])[\t ]*$/.test(lastLine)) return true;
  if (/^ {0,3}#{1,6}\S/.test(lastLine)) return true;
  if (/(?:^|\s)<[^>]*$/.test(lastLine)) return true;
  if (safeText.includes("|")) return true;
  const urlStart = lastLine.search(/(?:https?:\/\/|www\.)/i);
  if (urlStart >= 0) {
    const suffix = lastLine.slice(urlStart);
    const url = /^www\./i.test(suffix) ? `http://${suffix}` : suffix;
    if (!isSafeHttpUrl(url)) return true;
  }
  return sourceText.endsWith("!") || sourceText.endsWith("<");
}

function sourceHasUnfinishedSyntax(sourceText: string, phase: "streaming" | "complete"): boolean {
  const fenced = maskFencedCode(sourceText);
  if (fenced.unclosed) return true;
  const inline = maskInlineCode(fenced.text);
  if (inline.unclosed || hasUnclosedLinkSyntax(inline.text)) return true;
  return phase === "streaming" && hasIncompleteStreamingSuffix(sourceText, inline.text);
}

function countNode(state: { count: number }, depth: number): void {
  if (depth > MAX_PRESENTATION_DEPTH || ++state.count > MAX_PRESENTATION_NODES)
    throw invalidPresentationInput;
}

function appendInlineNode(nodes: InlineNode[], node: InlineNode): void {
  const previous = nodes[nodes.length - 1];
  if (node.type === "text" && previous?.type === "text") {
    previous.text += node.text;
  } else {
    nodes.push(node);
  }
}

function walkInline(tokens: Token[], state: { count: number }, depth: number): InlineNode[] {
  const nodes: InlineNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const textToken = token as Tokens.Text;
        if (textToken.tokens) {
          for (const child of walkInline(textToken.tokens, state, depth))
            appendInlineNode(nodes, child);
          break;
        }
        if (typeof textToken.text !== "string" || hasUnpairedTextDelimiters([token]))
          throw invalidPresentationInput;
        countNode(state, depth);
        appendInlineNode(nodes, { type: "text", text: textToken.text });
        break;
      }
      case "escape": {
        const escaped = token as Tokens.Escape;
        if (typeof escaped.text !== "string") throw invalidPresentationInput;
        countNode(state, depth);
        appendInlineNode(nodes, { type: "text", text: escaped.text });
        break;
      }
      case "codespan": {
        const code = token as Tokens.Codespan;
        if (typeof code.text !== "string") throw invalidPresentationInput;
        countNode(state, depth);
        nodes.push({ type: "code", text: code.text });
        break;
      }
      case "strong":
      case "em":
      case "del": {
        const formatted = token as Tokens.Strong | Tokens.Em | Tokens.Del;
        if (!Array.isArray(formatted.tokens)) throw invalidPresentationInput;
        countNode(state, depth);
        nodes.push({ type: token.type, children: walkInline(formatted.tokens, state, depth + 1) });
        break;
      }
      case "link": {
        const link = token as Tokens.Link;
        if (
          typeof link.href !== "string" ||
          !isSafeHttpUrl(link.href) ||
          (link.title !== undefined && link.title !== null) ||
          !Array.isArray(link.tokens)
        ) {
          throw invalidPresentationInput;
        }
        countNode(state, depth);
        nodes.push({
          type: "link",
          url: link.href,
          children: walkInline(link.tokens, state, depth + 1),
        });
        break;
      }
      case "br":
        countNode(state, depth);
        nodes.push({ type: "break" });
        break;
      default:
        throw invalidPresentationInput;
    }
  }
  return nodes;
}

function hasCompleteFence(raw: string): boolean {
  const lines = raw.split(/\r\n|\n|\r/);
  const opening = lines[0]?.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const marker = opening?.[1];
  const info = opening?.[2] ?? "";
  if (!marker || (marker[0] === "`" && info.includes("`"))) return false;
  for (const line of lines.slice(1)) {
    const closing = line.match(/^ {0,3}(`+|~+)[\t ]*$/);
    if (closing && closing[1]?.[0] === marker[0] && closing[1].length >= marker.length) return true;
  }
  return false;
}

function walkBlocks(tokens: Token[], state: { count: number }, depth: number): BlockNode[] {
  const blocks: BlockNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "paragraph": {
        const paragraph = token as Tokens.Paragraph;
        if (!Array.isArray(paragraph.tokens)) throw invalidPresentationInput;
        countNode(state, depth);
        blocks.push({
          type: "paragraph",
          children: walkInline(paragraph.tokens, state, depth + 1),
        });
        break;
      }
      case "heading": {
        const heading = token as Tokens.Heading;
        if (
          !Array.isArray(heading.tokens) ||
          !Number.isInteger(heading.depth) ||
          heading.depth < 1 ||
          heading.depth > 6
        ) {
          throw invalidPresentationInput;
        }
        countNode(state, depth);
        blocks.push({
          type: "heading",
          level: heading.depth,
          children: walkInline(heading.tokens, state, depth + 1),
        });
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        if (
          code.codeBlockStyle === "indented" ||
          !hasCompleteFence(code.raw) ||
          typeof code.text !== "string" ||
          (code.lang !== undefined && typeof code.lang !== "string") ||
          (code.lang !== undefined && /\s/.test(code.lang.trim()))
        ) {
          throw invalidPresentationInput;
        }
        countNode(state, depth);
        blocks.push({
          type: "code",
          text: code.text,
          ...(code.lang ? { language: code.lang } : {}),
        });
        break;
      }
      case "blockquote": {
        const quote = token as Tokens.Blockquote;
        if (!Array.isArray(quote.tokens)) throw invalidPresentationInput;
        countNode(state, depth);
        blocks.push({ type: "blockquote", blocks: walkBlocks(quote.tokens, state, depth + 1) });
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        if (!Array.isArray(list.items) || typeof list.ordered !== "boolean")
          throw invalidPresentationInput;
        let start: number | undefined;
        if (list.ordered) {
          if (
            typeof list.start !== "number" ||
            !Number.isSafeInteger(list.start) ||
            list.start < 0
          ) {
            throw invalidPresentationInput;
          }
          if (list.start !== 1) start = list.start;
        }
        countNode(state, depth);
        const items = list.items.map((item) => {
          if (
            item.type !== "list_item" ||
            item.task ||
            item.checked !== undefined ||
            !Array.isArray(item.tokens)
          ) {
            throw invalidPresentationInput;
          }
          return walkBlocks(item.tokens, state, depth + 1);
        });
        blocks.push({
          type: "list",
          ordered: list.ordered,
          ...(start !== undefined ? { start } : {}),
          items,
        });
        break;
      }
      case "hr":
        countNode(state, depth);
        blocks.push({ type: "hr" });
        break;
      case "def": {
        const definition = token as Tokens.Def;
        if (
          !isSafeHttpUrl(definition.href) ||
          (definition.title !== undefined && definition.title !== null)
        ) {
          throw invalidPresentationInput;
        }
        break;
      }
      case "text": {
        const text = token as Tokens.Text;
        if (!Array.isArray(text.tokens)) throw invalidPresentationInput;
        countNode(state, depth);
        blocks.push({ type: "paragraph", children: walkInline(text.tokens, state, depth + 1) });
        break;
      }
      default:
        throw invalidPresentationInput;
    }
  }
  return blocks;
}

export function projectMessage(
  item: unknown,
  phase: "streaming" | "complete",
): MessagePresentation | undefined {
  if (phase !== "streaming" && phase !== "complete") return undefined;
  try {
    const sourceText = messageSourceText(item);
    if (
      sourceText === undefined ||
      utf8ByteLength(sourceText) > MAX_SOURCE_BYTES ||
      sourceHasUnfinishedSyntax(sourceText, phase)
    ) {
      return undefined;
    }

    const tokens = markdown.lexer(sourceText);
    const state = { count: 0 };
    const blocks = walkBlocks(tokens, state, 1);
    const presentation = { sourceText, blocks, phase };
    const parsed = messagePresentationSchema.safeParse(presentation);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
