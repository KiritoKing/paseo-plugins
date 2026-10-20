import assert from "node:assert/strict";
import { test } from "node:test";
import { collectStructuredImages, extractMedia, previewWindow, safeSource } from "../shared/media";

test("extracts filenames with balanced parentheses and angle-bracket spaces", () => {
  const images = extractMedia('![第一张](/tmp/a(1).png)\n![第二张](</tmp/a b.png> "caption")');
  assert.deepEqual(
    images.map((image) => image.source),
    ["/tmp/a(1).png", "/tmp/a b.png"],
  );
});
test("does not mistake fenced and inline code for media, or incomplete streaming image for a completed reference", () => {
  const input = "```md\n![fake](x.png)\n```\n`![fake](z.png)`\n![real](r.png)\n![pending](s.png";
  assert.deepEqual(
    extractMedia(input).map((image) => image.source),
    ["r.png"],
  );
});
test("never accepts executable sources and only allows raster embedded images", () => {
  assert.equal(safeSource("javascript:alert(1)"), false);
  assert.equal(safeSource("data:text/html;base64,abc"), false);
  assert.equal(safeSource("data:image/svg+xml;base64,abc"), false);
  assert.equal(safeSource("data:image/png;base64,abc"), true);
});
test("collapses extra images with exact total without losing order or duplicates", () => {
  const images = ["a", "b", "a", "c", "d"];
  assert.deepEqual(previewWindow(images, 3, false), {
    visible: ["a", "b", "a"],
    total: 5,
    hidden: 2,
  });
  assert.deepEqual(previewWindow(images, 3, true), { visible: images, total: 5, hidden: 0 });
});
test("recognizes structured image results and excludes arbitrary tool input and credentials", () => {
  const images = collectStructuredImages({
    input: { url: "secret.png" },
    content: [
      { type: "image", mimeType: "image/png", data: "AAAA" },
      { type: "text", text: "![plot](plot.png)" },
    ],
  });
  assert.deepEqual(
    images.map((image) => image.source),
    ["data:image/png;base64,AAAA", "plot.png"],
  );
});
