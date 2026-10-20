import assert from "node:assert/strict";
import { test } from "node:test";

import { messagePresentationSchema, projectMessage } from "../shared/message-presentation";

function assistantMessage(
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type: "assistant_message", text, messageId: "message-1", ...extra };
}

test("projects common Markdown structure and retains the exact source text", () => {
  const source = [
    "# Title **strong**",
    "",
    "A *soft* line with ~~deleted~~, `inline`, [safe](https://example.test/a?x=1), and  ",
    "a hard break.",
    "",
    "- first",
    "- **second**",
    "",
    "4. ordered one",
    "5. ordered two",
    "",
    "> quoted",
    "> > nested quote",
    "",
    "```ts",
    "const answer = 42;",
    "```",
    "",
    "---",
  ].join("\n");

  const result = projectMessage(assistantMessage(source), "complete");
  assert.deepEqual(result, {
    sourceText: source,
    phase: "complete",
    blocks: [
      {
        type: "heading",
        level: 1,
        children: [
          { type: "text", text: "Title " },
          { type: "strong", children: [{ type: "text", text: "strong" }] },
        ],
      },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "A " },
          { type: "em", children: [{ type: "text", text: "soft" }] },
          { type: "text", text: " line with " },
          { type: "del", children: [{ type: "text", text: "deleted" }] },
          { type: "text", text: ", " },
          { type: "code", text: "inline" },
          { type: "text", text: ", " },
          {
            type: "link",
            url: "https://example.test/a?x=1",
            children: [{ type: "text", text: "safe" }],
          },
          { type: "text", text: ", and" },
          { type: "break" },
          { type: "text", text: "a hard break." },
        ],
      },
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "paragraph", children: [{ type: "text", text: "first" }] }],
          [
            {
              type: "paragraph",
              children: [{ type: "strong", children: [{ type: "text", text: "second" }] }],
            },
          ],
        ],
      },
      {
        type: "list",
        ordered: true,
        start: 4,
        items: [
          [{ type: "paragraph", children: [{ type: "text", text: "ordered one" }] }],
          [{ type: "paragraph", children: [{ type: "text", text: "ordered two" }] }],
        ],
      },
      {
        type: "blockquote",
        blocks: [
          { type: "paragraph", children: [{ type: "text", text: "quoted" }] },
          {
            type: "blockquote",
            blocks: [{ type: "paragraph", children: [{ type: "text", text: "nested quote" }] }],
          },
        ],
      },
      { type: "code", language: "ts", text: "const answer = 42;" },
      { type: "hr" },
    ],
  });
  assert.equal(result?.sourceText, source);
  assert.equal(messagePresentationSchema.safeParse(result).success, true);
});

test("keeps raw and escaped text as text nodes without interpreting HTML", () => {
  const source = "&lt;tag&gt; and \\*literal\\* < plain text";
  const result = projectMessage(assistantMessage(source), "complete");
  assert.deepEqual(result?.blocks, [
    {
      type: "paragraph",
      children: [{ type: "text", text: "&lt;tag&gt; and *literal* < plain text" }],
    },
  ]);
  assert.equal(result?.sourceText, source);
});

test("accepts only protocol assistant messages with known top-level fields", () => {
  assert.equal(projectMessage({ type: "user_message", text: "hello" }, "complete"), undefined);
  assert.equal(projectMessage({ type: "assistant_message", text: 1 }, "complete"), undefined);
  assert.equal(projectMessage(assistantMessage("hello", { metadata: {} }), "complete"), undefined);
  assert.equal(
    projectMessage(assistantMessage("hello", { newProtocolField: "unknown" }), "complete"),
    undefined,
  );
  assert.equal(
    projectMessage({ type: "assistant_message", text: "hello", messageId: undefined }, "complete"),
    undefined,
  );
});

test("falls back for rich, unsupported, and unsafe Markdown constructs", () => {
  const unsupported = [
    "![image](https://example.test/image.png)",
    "<script>alert(1)</script>",
    "| name | value |\n| --- | --- |\n| a | b |",
    "- [ ] task",
    "[file](file:///etc/passwd)",
    "[relative](/docs)",
    "[javascript](javascript:alert(1))",
    "[credential](https://user:pass@example.test/)",
    '[titled](https://example.test/ "tooltip")',
    "```ts\nconst open = true;",
    "**unfinished emphasis",
    "[unfinished link](https://example.test/path",
  ];

  for (const source of unsupported) {
    assert.equal(projectMessage(assistantMessage(source), "complete"), undefined, source);
  }
});

test("rejects unknown, malformed, unsafe, oversized, and over-deep presentation nodes", () => {
  const valid = {
    sourceText: "x",
    phase: "complete",
    blocks: [{ type: "paragraph", children: [{ type: "text", text: "x" }] }],
  };
  assert.equal(messagePresentationSchema.safeParse({ ...valid, ignored: true }).success, false);
  assert.equal(
    messagePresentationSchema.safeParse({
      ...valid,
      blocks: [
        {
          type: "paragraph",
          children: [{ type: "link", url: "file:///etc/passwd", children: [] }],
        },
      ],
    }).success,
    false,
  );

  const exactByteLimit = `${"雪".repeat(21845)}a`;
  const overByteLimit = `${exactByteLimit}x`;
  assert.equal(new TextEncoder().encode(exactByteLimit).byteLength, 65536);
  assert.notEqual(projectMessage(assistantMessage(exactByteLimit), "complete"), undefined);
  assert.equal(projectMessage(assistantMessage(overByteLimit), "complete"), undefined);

  const tooManyNodes = "**x** ".repeat(2500);
  assert.equal(projectMessage(assistantMessage(tooManyNodes), "complete"), undefined);
  const tooDeep = `${"> ".repeat(40)}nested`;
  assert.equal(projectMessage(assistantMessage(tooDeep), "complete"), undefined);

  let deeplyNestedInline: unknown = { type: "text", text: "x" };
  for (let index = 0; index < 40; index += 1) {
    deeplyNestedInline = { type: "strong", children: [deeplyNestedInline] };
  }
  assert.equal(
    messagePresentationSchema.safeParse({
      sourceText: "x",
      phase: "complete",
      blocks: [{ type: "paragraph", children: [deeplyNestedInline] }],
    }).success,
    false,
  );
  assert.equal(
    messagePresentationSchema.safeParse({
      sourceText: "x",
      phase: "complete",
      blocks: [
        {
          type: "paragraph",
          children: Array.from({ length: 4097 }, () => ({ type: "text", text: "x" })),
        },
      ],
    }).success,
    false,
  );
});

test("keeps streaming phase for complete syntax and falls back on unfinished structures", () => {
  assert.deepEqual(projectMessage(assistantMessage("streaming plain text"), "streaming"), {
    sourceText: "streaming plain text",
    blocks: [{ type: "paragraph", children: [{ type: "text", text: "streaming plain text" }] }],
    phase: "streaming",
  });

  for (const source of [
    "```ts\nconst pending = true;",
    "[docs](https://example.test/docs",
    "**pending emphasis",
    "`pending code",
    "- ",
    "#Heading still forming",
    "<script",
    "| header | cell |",
  ]) {
    assert.equal(projectMessage(assistantMessage(source), "streaming"), undefined, source);
  }
});
