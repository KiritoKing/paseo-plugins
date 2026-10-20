import { z } from "zod";

const MAX_PRESENTATION_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 64;

const presentationPhaseSchema = z.enum(["streaming", "complete"]);

export const toolPresentationSchema = z
  .object({
    callId: z.string(),
    name: z.string(),
    status: z.enum(["running", "completed", "failed", "canceled"]),
    command: z.string(),
    cwd: z.string().optional(),
    output: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    error: z.string().optional(),
    phase: presentationPhaseSchema,
  })
  .strict();

export type ToolPresentation = z.infer<typeof toolPresentationSchema>;

export const reasoningPresentationSchema = z
  .object({
    text: z.string(),
    phase: presentationPhaseSchema,
  })
  .strict();

export type ReasoningPresentation = z.infer<typeof reasoningPresentationSchema>;

const emptyMetadataSchema = z.object({}).strict();

const shellDetailSchema = z
  .object({
    type: z.literal("shell"),
    command: z.string(),
    cwd: z.string().optional(),
    output: z.string().optional(),
    exitCode: z.number().nullable().optional(),
  })
  .strict();

const toolCallFields = {
  type: z.literal("tool_call"),
  callId: z.string(),
  name: z.string(),
  detail: shellDetailSchema,
  metadata: emptyMetadataSchema.optional(),
};

const toolCallInputSchema = z.discriminatedUnion("status", [
  z.object({ ...toolCallFields, status: z.literal("running"), error: z.null() }).strict(),
  z.object({ ...toolCallFields, status: z.literal("completed"), error: z.null() }).strict(),
  z.object({ ...toolCallFields, status: z.literal("canceled"), error: z.null() }).strict(),
  z.object({ ...toolCallFields, status: z.literal("failed"), error: z.unknown() }).strict(),
]);

const reasoningInputSchema = z
  .object({
    type: z.literal("reasoning"),
    text: z.string().min(1),
  })
  .strict();

/**
 * Serializes only plain JSON data. It rejects values JSON.stringify would omit,
 * invoke, or silently coerce, and caps the compact UTF-8 representation.
 */
function serializeSafeJson(value: unknown): string | undefined {
  try {
    const chunks: string[] = [];
    const active = new Set<object>();
    let byteLength = 0;

    const append = (chunk: string): void => {
      byteLength += utf8ByteLength(chunk);
      if (byteLength > MAX_PRESENTATION_BYTES) {
        throw new Error("JSON presentation exceeds the size limit");
      }
      chunks.push(chunk);
    };

    const appendString = (text: string): void => {
      if (utf8ByteLength(text) > MAX_PRESENTATION_BYTES) {
        throw new Error("JSON string exceeds the size limit");
      }

      const encoded: string[] = ['"'];
      let segmentStart = 0;

      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        let escapedCodePoint: string | undefined;

        switch (code) {
          case 0x08:
            escapedCodePoint = "\\b";
            break;
          case 0x09:
            escapedCodePoint = "\\t";
            break;
          case 0x0a:
            escapedCodePoint = "\\n";
            break;
          case 0x0c:
            escapedCodePoint = "\\f";
            break;
          case 0x0d:
            escapedCodePoint = "\\r";
            break;
          case 0x22:
            escapedCodePoint = '\\"';
            break;
          case 0x5c:
            escapedCodePoint = "\\\\";
            break;
          default:
            if (code < 0x20) {
              escapedCodePoint = `\\u${code.toString(16).padStart(4, "0")}`;
            } else if (code >= 0xd800 && code <= 0xdbff) {
              const next = text.charCodeAt(index + 1);
              if (next >= 0xdc00 && next <= 0xdfff) {
                index += 1;
              } else {
                escapedCodePoint = `\\u${code.toString(16).padStart(4, "0")}`;
              }
            } else if (code >= 0xdc00 && code <= 0xdfff) {
              escapedCodePoint = `\\u${code.toString(16).padStart(4, "0")}`;
            }
        }

        if (escapedCodePoint !== undefined) {
          encoded.push(text.slice(segmentStart, index), escapedCodePoint);
          segmentStart = index + 1;
        }
      }

      encoded.push(text.slice(segmentStart), '"');
      append(encoded.join(""));
    };

    const visit = (current: unknown, depth: number): void => {
      if (depth > MAX_JSON_DEPTH) {
        throw new Error("JSON presentation exceeds the nesting limit");
      }

      if (current === null) {
        append("null");
        return;
      }

      switch (typeof current) {
        case "string":
          appendString(current);
          return;
        case "boolean":
          append(current ? "true" : "false");
          return;
        case "number":
          if (!Number.isFinite(current)) {
            throw new Error("Non-finite numbers are not JSON data");
          }
          append(Object.is(current, -0) ? "0" : String(current));
          return;
        case "object":
          break;
        default:
          throw new Error("Value is not JSON data");
      }

      const objectValue = current as object;
      if (active.has(objectValue)) {
        throw new Error("Cyclic JSON data is not supported");
      }
      active.add(objectValue);

      try {
        if (Array.isArray(current)) {
          if (Object.getPrototypeOf(current) !== Array.prototype) {
            throw new Error("Non-standard arrays are not supported");
          }

          const keys = Reflect.ownKeys(current);
          if (keys.length !== current.length + 1) {
            throw new Error("Sparse arrays or extra array fields are not supported");
          }

          const lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
          if (
            !lengthDescriptor ||
            lengthDescriptor.enumerable ||
            !("value" in lengthDescriptor) ||
            lengthDescriptor.value !== current.length
          ) {
            throw new Error("Invalid array length property");
          }

          append("[");
          for (let index = 0; index < current.length; index += 1) {
            if (index > 0) append(",");
            const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
            if (!descriptor?.enumerable || !("value" in descriptor)) {
              throw new Error("Array entries must be enumerable data properties");
            }
            visit(descriptor.value, depth + 1);
          }
          append("]");
          return;
        }

        const prototype = Object.getPrototypeOf(current);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new Error("Only plain objects are supported");
        }

        const keys = Reflect.ownKeys(current);
        const entries: Array<[string, unknown]> = [];
        for (const key of keys) {
          if (typeof key !== "string") {
            throw new Error("Symbol keys are not JSON data");
          }
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new Error("Object fields must be enumerable data properties");
          }
          entries.push([key, descriptor.value]);
        }

        append("{");
        for (let index = 0; index < entries.length; index += 1) {
          if (index > 0) append(",");
          const [key, entryValue] = entries[index];
          appendString(key);
          append(":");
          visit(entryValue, depth + 1);
        }
        append("}");
      } finally {
        active.delete(objectValue);
      }
    };

    visit(value, 0);
    return chunks.join("");
  } catch {
    return undefined;
  }
}

function parseSafeJson(value: unknown): unknown {
  const serialized = serializeSafeJson(value);
  if (serialized === undefined) return undefined;

  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

export function projectTool(
  item: unknown,
  phase: "streaming" | "complete",
): ToolPresentation | undefined {
  if (phase !== "streaming" && phase !== "complete") return undefined;
  const safeItem = parseSafeJson(item);
  if (safeItem === undefined) return undefined;

  const result = toolCallInputSchema.safeParse(safeItem);
  if (!result.success) return undefined;
  if (result.data.status === "failed" && !hasOwn(result.data, "error")) {
    return undefined;
  }

  const { detail } = result.data;
  const presentation: ToolPresentation = {
    callId: result.data.callId,
    name: result.data.name,
    status: result.data.status,
    command: detail.command,
    phase,
  };

  if (hasOwn(detail, "cwd")) presentation.cwd = detail.cwd;
  if (hasOwn(detail, "output")) presentation.output = detail.output;
  if (hasOwn(detail, "exitCode")) presentation.exitCode = detail.exitCode;

  if (result.data.status === "failed") {
    const error = result.data.error;
    presentation.error = typeof error === "string" ? error : serializeSafeJson(error);
    if (presentation.error === undefined) return undefined;
  }

  const projected = toolPresentationSchema.safeParse(presentation);
  return projected.success ? projected.data : undefined;
}

export function projectReasoning(
  item: unknown,
  phase: "streaming" | "complete",
): ReasoningPresentation | undefined {
  if (phase !== "streaming" && phase !== "complete") return undefined;
  const safeItem = parseSafeJson(item);
  if (safeItem === undefined) return undefined;

  const result = reasoningInputSchema.safeParse(safeItem);
  if (!result.success) return undefined;

  const projected = reasoningPresentationSchema.safeParse({ text: result.data.text, phase });
  return projected.success ? projected.data : undefined;
}
