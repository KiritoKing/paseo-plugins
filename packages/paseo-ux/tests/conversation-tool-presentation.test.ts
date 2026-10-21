import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectReasoning,
  projectTool,
  reasoningPresentationSchema,
  toolPresentationSchema,
} from "../shared/conversation/tool-presentation";

const MAX_PRESENTATION_BYTES = 256 * 1024;

function shellItem(
  detail: Record<string, unknown> = { type: "shell", command: "echo hello" },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "tool_call",
    callId: "call-1",
    name: "shell",
    detail,
    status: "completed",
    error: null,
    ...overrides,
  };
}

test("projects complete shell details without changing status or truncating content", () => {
  const item = shellItem(
    {
      type: "shell",
      command: "printf 'hello\\nworld'",
      cwd: "/workspace/example",
      output: "hello\nworld\nUnicode: 雪 🌙",
      exitCode: 7,
    },
    { status: "completed" },
  );

  assert.deepEqual(projectTool(item, "complete"), {
    callId: "call-1",
    name: "shell",
    status: "completed",
    command: "printf 'hello\\nworld'",
    cwd: "/workspace/example",
    output: "hello\nworld\nUnicode: 雪 🌙",
    exitCode: 7,
    phase: "complete",
  });
  assert.equal(
    toolPresentationSchema.safeParse({ ...projectTool(item, "complete"), ignored: true }).success,
    false,
  );
});

test("keeps specialized tools, unknown fields, and non-empty metadata native", () => {
  const specializedDetails = [
    { type: "read", filePath: "src/a.ts", content: "source" },
    { type: "edit", filePath: "src/a.ts", oldString: "old", newString: "new" },
    { type: "search", query: "needle", content: "matches" },
    { type: "unknown", input: { value: 1 }, output: { value: 2 } },
  ];

  for (const detail of specializedDetails) {
    assert.equal(projectTool(shellItem(detail), "complete"), undefined);
  }
  assert.equal(
    projectTool(shellItem({ type: "shell", command: "pwd", rawArgs: ["--json"] }), "complete"),
    undefined,
  );
  assert.equal(
    projectTool(shellItem(undefined, { metadata: { provider: "codex" } }), "complete"),
    undefined,
  );
  assert.equal(
    projectTool(shellItem({ type: "shell", command: "pwd" }, { hiddenInput: "x" }), "complete"),
    undefined,
  );
});

test("retains failed status and fully displays string or JSON errors", () => {
  const stringError = "exit status 1: stderr line 1\nstderr line 2";
  assert.deepEqual(
    projectTool(
      shellItem(
        { type: "shell", command: "false", output: "", exitCode: 1 },
        {
          status: "failed",
          error: stringError,
        },
      ),
      "complete",
    ),
    {
      callId: "call-1",
      name: "shell",
      status: "failed",
      command: "false",
      output: "",
      exitCode: 1,
      error: stringError,
      phase: "complete",
    },
  );

  const jsonError = {
    code: "PROCESS_FAILED",
    message: 'non-zero\n"quoted" 雪\u0001',
    details: ["stderr", 17, null],
  };
  const projected = projectTool(
    shellItem({ type: "shell", command: "false" }, { status: "failed", error: jsonError }),
    "complete",
  );
  assert.equal(projected?.status, "failed");
  assert.equal(projected?.error, JSON.stringify(jsonError));
});

test("rejects malformed and non-JSON inputs instead of silently losing fields", () => {
  assert.equal(projectTool(shellItem({ type: "shell" }), "complete"), undefined);
  const missingFailedError = shellItem({ type: "shell", command: "x" }, { status: "failed" });
  delete missingFailedError.error;
  assert.equal(projectTool(missingFailedError, "complete"), undefined);
  assert.equal(
    projectTool(shellItem({ type: "shell", command: "x" }, { error: "unexpected" }), "complete"),
    undefined,
  );
  assert.equal(
    projectTool(
      shellItem({ type: "shell", command: "x" }, { status: "failed", error: 1n }),
      "complete",
    ),
    undefined,
  );

  const cyclicError: Record<string, unknown> = {};
  cyclicError.self = cyclicError;
  assert.equal(
    projectTool(
      shellItem({ type: "shell", command: "x" }, { status: "failed", error: cyclicError }),
      "complete",
    ),
    undefined,
  );
  assert.equal(
    projectTool(
      shellItem({ type: "shell", command: "x" }, { status: "failed", error: new Date(0) }),
      "complete",
    ),
    undefined,
  );

  let commandGetterRead = false;
  const accessorDetail = { type: "shell" } as Record<string, unknown>;
  Object.defineProperty(accessorDetail, "command", {
    enumerable: true,
    get() {
      commandGetterRead = true;
      return "x";
    },
  });
  assert.equal(projectTool(shellItem(accessorDetail), "complete"), undefined);
  assert.equal(commandGetterRead, false);
});

test("accepts the 256 KiB boundary and falls back above it", () => {
  const base = shellItem({ type: "shell", command: "x", output: "" });
  const baseBytes = Buffer.byteLength(JSON.stringify(base), "utf8");
  const atLimit = shellItem({
    type: "shell",
    command: "x",
    output: "o".repeat(MAX_PRESENTATION_BYTES - baseBytes),
  });
  const overLimit = shellItem({
    type: "shell",
    command: "x",
    output: "o".repeat(MAX_PRESENTATION_BYTES - baseBytes + 1),
  });

  assert.equal(Buffer.byteLength(JSON.stringify(atLimit), "utf8"), MAX_PRESENTATION_BYTES);
  assert.notEqual(projectTool(atLimit, "complete"), undefined);
  assert.equal(projectTool(overLimit, "complete"), undefined);
});

test("preserves streaming output and exposes the supplied phase without inferring success", () => {
  const partialOutput = `${"chunk-".repeat(256)}partial`;
  const streaming = shellItem(
    {
      type: "shell",
      command: "long-running-command",
      cwd: "/workspace",
      output: partialOutput,
      exitCode: null,
    },
    { status: "running" },
  );
  const finalOutput = `${partialOutput}\ncomplete`;
  const completed = shellItem(
    {
      type: "shell",
      command: "long-running-command",
      cwd: "/workspace",
      output: finalOutput,
      exitCode: 3,
    },
    { status: "completed" },
  );

  assert.deepEqual(projectTool(streaming, "streaming"), {
    callId: "call-1",
    name: "shell",
    status: "running",
    command: "long-running-command",
    cwd: "/workspace",
    output: partialOutput,
    exitCode: null,
    phase: "streaming",
  });
  assert.equal(projectTool(completed, "complete")?.status, "completed");
  assert.equal(projectTool(completed, "complete")?.exitCode, 3);
  assert.equal(projectTool(completed, "complete")?.output, finalOutput);
});

test("claims only non-empty strict reasoning within the shared size limit", () => {
  assert.deepEqual(
    projectReasoning({ type: "reasoning", text: "Planning the next step." }, "streaming"),
    {
      text: "Planning the next step.",
      phase: "streaming",
    },
  );
  assert.equal(projectReasoning({ type: "reasoning", text: "" }, "complete"), undefined);
  assert.equal(
    projectReasoning({ type: "reasoning", text: "text", summary: "extra" }, "complete"),
    undefined,
  );
  assert.equal(
    projectReasoning({ type: "reasoning", text: "x".repeat(MAX_PRESENTATION_BYTES) }, "complete"),
    undefined,
  );
  assert.equal(
    reasoningPresentationSchema.safeParse({ text: "text", phase: "complete", summary: "extra" })
      .success,
    false,
  );
});
