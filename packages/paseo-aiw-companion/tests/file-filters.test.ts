import assert from "node:assert/strict";
import test from "node:test";
import {
  type ChangedFile,
  changedSchema,
  changeGroupSchema,
  defaultCodeIncludes,
  defaultIncludes,
  effectiveIncludes,
  legacyV2Includes,
  projectPreferenceSchema,
} from "../shared/contracts";
import { filterChangeGroups, matchesFileFilter } from "../shared/file-filters";

const file = (path: string, oldPath?: string): ChangedFile =>
  changedSchema.parse({
    repoId: "repo-a",
    path,
    oldPath,
    status: oldPath ? "R" : "M",
    origin: "branch",
    additions: 1,
    deletions: 1,
    binary: false,
  });

test("default file types separate common source, documents and other assets", () => {
  for (const path of [
    "src/main.tsx",
    "src/app.vue",
    "src/handler.go",
    "src/main.py",
    "src/app.java",
    "src/lib.rs",
    "native/app.mm",
    "native/app.cpp",
    "styles/main.scss",
    "api/service.proto",
    "changes/example/implementation.ts",
  ]) {
    assert.equal(matchesFileFilter(file(path), "code"), true, path);
    assert.equal(matchesFileFilter(file(path), "documents"), false, path);
  }
  for (const path of [
    "README.md",
    "docs/guide.mdx",
    "notes.txt",
    "manual.rst",
    "proposal.tex",
    "openspec/config.yaml",
    ".aiw/change.yaml",
    ".aiw/delivery.md",
    "aiw.yaml",
    "specs/contract.yaml",
  ]) {
    assert.equal(matchesFileFilter(file(path), "documents"), true, path);
    assert.equal(matchesFileFilter(file(path), "code"), false, path);
  }
  for (const path of ["images/logo.png", "pnpm-lock.yaml", "package.json"]) {
    assert.equal(matchesFileFilter(file(path), "code"), false, path);
    assert.equal(matchesFileFilter(file(path), "documents"), false, path);
    assert.equal(matchesFileFilter(file(path), "all"), true, path);
  }
});

test("old settings gain code presets and retain independently customized document rules", () => {
  const legacy = projectPreferenceSchema.parse({
    include: ["custom/**/*.md"],
    exclude: ["**/private/**"],
  });
  assert.deepEqual(legacy.include, ["custom/**/*.md"]);
  assert.deepEqual(legacy.codeInclude, defaultCodeIncludes);
  assert.equal(matchesFileFilter(file("custom/readme.md"), "documents", legacy), true);
  assert.equal(matchesFileFilter(file("custom/private/readme.md"), "documents", legacy), false);
  assert.equal(matchesFileFilter(file("src/app.ts"), "code", legacy), true);
  assert.deepEqual(effectiveIncludes(legacyV2Includes), defaultIncludes);
  const custom = projectPreferenceSchema.parse({
    include: [],
    codeInclude: ["src/**/*.ts"],
    codeExclude: ["**/*.test.ts"],
  });
  assert.equal(matchesFileFilter(file("README.md"), "documents", custom), false);
  assert.equal(matchesFileFilter(file("src/app.ts"), "code", custom), true);
  assert.equal(matchesFileFilter(file("src/app.test.ts"), "code", custom), false);
  assert.equal(matchesFileFilter(file("lib/app.ts"), "code", custom), false);
  assert.equal(
    matchesFileFilter(file("src/app.ts"), "code", { ...custom, codeInclude: [] }),
    false,
  );
  assert.equal(
    matchesFileFilter(file("src/app.ts", "src/app.test.ts"), "code", custom),
    false,
    "exclude checks both rename endpoints",
  );
});

test("filtering aggregates by repository, preserves errors and never mutates the source diff", () => {
  const makeGroup = (id: string, files: ChangedFile[], error: string | null = null) =>
    changeGroupSchema.parse({
      repo: {
        id,
        name: id,
        path: "/fixture",
        branch: "feature",
        head: "head",
        baseSha: "base",
        ready: !error,
        error,
      },
      files,
      baseline: "base",
      head: "head",
      snapshotId: "snapshot",
      error,
    });
  const groups = [
    makeGroup("repo-a", [file("src/app.ts"), file("docs/guide.md")]),
    makeGroup("repo-b", [file("notes.md")]),
    makeGroup("unavailable", [], "worktree unavailable"),
  ];
  const codes = filterChangeGroups(groups, "code");
  assert.deepEqual(
    codes.map((group) => [group.repo.id, group.files.length]),
    [
      ["repo-a", 1],
      ["unavailable", 0],
    ],
  );
  assert.equal(codes[1].error, "worktree unavailable");
  assert.deepEqual(
    filterChangeGroups(groups, "documents").map((group) => [group.repo.id, group.files.length]),
    [
      ["repo-a", 1],
      ["repo-b", 1],
      ["unavailable", 0],
    ],
  );
  assert.equal(groups[0].files.length, 2);
  const rename = file("docs/guide.md", "src/app.ts");
  assert.equal(matchesFileFilter(rename, "code"), true);
  assert.equal(matchesFileFilter(rename, "documents"), true);
});
