import assert from "node:assert/strict";
import test from "node:test";
import { parseDiff } from "../client/diff-model";
import { highlightCode, languageFor, tint, tokenColor } from "../client/syntax";
import { defaultIncludes, effectiveIncludes, legacyDefaultIncludes } from "../shared/contracts";
import { matchesPatterns } from "../shared/patterns";

test("diff excludes Git metadata and separates line numbers from content across multiple hunks", () => {
  const patch =
    'diff --git a/old.ts b/new.ts\nindex 123..456 100644\n--- a/old.ts\n+++ b/new.ts\n@@ -2,2 +2,2 @@\n const text = "a";\n-old();\n+next();\n@@ -100,0 +101,2 @@\n+// 中文\n++++;\n\\ No newline at end of file\n';
  const rows = parseDiff(patch);
  assert.deepEqual(
    rows.filter((r) => r.kind === "addition").map((r) => [r.text, r.newLine]),
    [
      ["next();", 3],
      ["// 中文", 101],
      ["+++;", 102],
    ],
  );
  assert.deepEqual(
    rows.filter((r) => r.kind === "deletion").map((r) => [r.text, r.oldLine]),
    [["old();", 3]],
  );
  assert.ok(rows.every((r) => !r.text.startsWith("diff --git") && !r.text.startsWith("index ")));
  assert.equal(rows.at(-1)?.kind, "note");
});

test("real TSX grammar preserves source and multiline comments with distinct semantic tokens", () => {
  const code =
    '/* 多行注释\n * 保持状态 */\nconst count: number = 42;\nconst text = "中文😀";\nexport const View = () => <Text title="测试">{count}</Text>;\n';
  const highlighted = highlightCode(code, "src/view.tsx");
  assert.equal(highlighted.language, "tsx");
  assert.equal(highlighted.lines.map((line) => line.map((t) => t.text).join("")).join("\n"), code);
  assert.ok(highlighted.lines[1].some((t) => t.classes.includes("comment")));
  const classes = new Set(
    highlighted.lines.flatMap((line) => line.flatMap((token) => token.classes)),
  );
  for (const name of ["keyword", "number", "string", "tag"]) assert.ok(classes.has(name), name);
  const theme = {
    colors: {
      surface0: "#101010",
      surface1: "#181818",
      surface2: "#202020",
      border: "#333333",
      foreground: "#eeeeee",
      foregroundMuted: "#999999",
      accent: "#9999ff",
      accentForeground: "#101010",
      statusSuccess: "#88dd99",
      statusWarning: "#ffcc88",
      statusDanger: "#ff9999",
    },
  };
  assert.notEqual(tokenColor(["keyword"], theme), tokenColor(["string"], theme));
  assert.notEqual(tokenColor(["comment"], theme), theme.colors.foreground);
  assert.notEqual(tint(theme.colors.statusSuccess, theme.colors.surface0), theme.colors.surface0);
});

test("presets cover OpenSpec and AIW docs without overriding custom rules", () => {
  for (const path of [
    "openspec/changes/test/proposal.md",
    "openspec/specs/runtime/spec.md",
    "openspec/config.yaml",
    ".aiw/change.yaml",
    ".aiw/delivery.md",
    "aiw.yaml",
    "sub/.aiw/requirements.md",
  ])
    assert.equal(matchesPatterns(path, undefined, defaultIncludes, []), true, path);
  assert.equal(matchesPatterns(".aiw/bin/aiw", undefined, defaultIncludes, []), false);
  assert.equal(matchesPatterns("src/index.ts", undefined, defaultIncludes, []), false);
  assert.deepEqual(effectiveIncludes(["custom/**/*.md"]), ["custom/**/*.md"]);
  assert.deepEqual(effectiveIncludes([]), []);
  assert.deepEqual(effectiveIncludes(legacyDefaultIncludes), defaultIncludes);
  assert.equal(languageFor("api/main.go"), "go");
  assert.equal(languageFor("notes.md"), "markdown");
});
