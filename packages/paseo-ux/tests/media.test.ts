import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectStructuredImages,
  collectStructuredMedia,
  extractImageOnlyMessage,
  extractMedia,
  previewWindow,
  safeSource,
} from "../shared/media";

test("extracts Markdown images and typed attachment links with balanced parentheses and angle-bracket spaces", () => {
  const references = extractMedia(
    '![第一张](/tmp/a(1).png)\n[报告](</tmp/annual report.pdf> "caption")',
  );
  assert.deepEqual(
    references.map((reference) => [reference.source, reference.kind]),
    [
      ["/tmp/a(1).png", "image"],
      ["/tmp/annual report.pdf", "document"],
    ],
  );
});

test("ignores fenced and inline code and does not treat ordinary web links as attachments", () => {
  const input =
    "```md\n![fake](x.png)\n```\n`![fake](z.png)`\n    ![also fake](indented.png)\n<code>![still fake](html.png)</code>\n[主页](https://example.com/docs)\n![real](r.png)\n![pending](s.png";
  assert.deepEqual(
    extractMedia(input).map((reference) => reference.source),
    ["r.png"],
  );
});

test("only returns a strict image-only message for complete whitespace-separated image Markdown", () => {
  assert.deepEqual(
    extractImageOnlyMessage(" \n![one](one.png)\n  ![two](https://cdn.example/two)\t")?.map(
      (reference) => reference.source,
    ),
    ["one.png", "https://cdn.example/two"],
  );
  assert.equal(extractImageOnlyMessage("![one](one.png) explanation"), null);
  assert.equal(extractImageOnlyMessage("![one](one.png) `code`"), null);
  assert.equal(extractImageOnlyMessage("```md\n![one](one.png)\n```"), null);
  assert.equal(extractImageOnlyMessage("[a file](file.pdf)"), null);
  assert.equal(extractImageOnlyMessage(""), null);
});

test("rejects executable sources and active embedded formats while accepting portable raster data", () => {
  assert.equal(safeSource("javascript:alert(1)"), false);
  assert.equal(safeSource("data:text/html;base64,abc"), false);
  assert.equal(safeSource("data:image/svg+xml;base64,abc"), false);
  assert.equal(safeSource("data:image/png;base64,AAAA"), true);
});

test("preview windows keep order and exact totals", () => {
  const images = ["a", "b", "a", "c", "d"];
  assert.deepEqual(previewWindow(images, 3, false), {
    visible: ["a", "b", "a"],
    total: 5,
    hidden: 2,
  });
  assert.deepEqual(previewWindow(images, 3, true), { visible: images, total: 5, hidden: 0 });
});

test("recognizes structured no-extension MIME attachments and excludes tool input and secrets", () => {
  const references = collectStructuredMedia({
    input: { url: "/tmp/private.png", mimeType: "image/png" },
    arguments: { file: { path: "/tmp/argument.pdf", mimeType: "application/pdf" } },
    env: { file: "/tmp/env.png" },
    headers: { url: "/tmp/header.png" },
    credentials: { token: "secret" },
    content: [
      { type: "image", mimeType: "image/png", data: "AAAA" },
      { type: "file", mimeType: "application/pdf", url: "/tmp/download" },
      { type: "attachment", mime_type: "application/octet-stream", path: "/tmp/blob" },
      { type: "text", text: "![plot](plot.png) [web](https://example.com/docs)" },
    ],
  });
  assert.deepEqual(
    references.map((reference) => [reference.source, reference.kind, reference.mimeType]),
    [
      ["data:image/png;base64,AAAA", "image", "image/png"],
      ["/tmp/download", "document", "application/pdf"],
      ["/tmp/blob", "file", "application/octet-stream"],
      ["plot.png", "image", "image/png"],
    ],
  );
  assert.deepEqual(
    collectStructuredImages({
      content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
    }).map((reference) => reference.kind),
    ["image"],
  );
});
