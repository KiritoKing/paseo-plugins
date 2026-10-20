import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { catalog, changes, patch, readFile, search, tree } from "../server/service";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function commit(dir: string, message: string): string {
  git(dir, ["add", "."]);
  git(dir, [
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    message,
  ]);
  return git(dir, ["rev-parse", "HEAD"]);
}

test("catalog and read-only services preserve repository identity and Git scopes", async () => {
  const temp = mkdtempSync(join(tmpdir(), "aiw-companion-"));
  const root = join(temp, "root");
  const child = join(temp, "child");
  const bin = join(temp, "aiw");
  const previous = process.env.AIW_COMPANION_AIW;
  try {
    mkdirSync(root);
    mkdirSync(child);
    for (const directory of [root, child]) {
      git(directory, ["init", "-b", "main"]);
      git(directory, ["config", "user.name", "test"]);
      git(directory, ["config", "user.email", "test@example.invalid"]);
    }
    writeFileSync(
      join(root, "aiw.yaml"),
      "version: 1\nname: fixture\nbase: main\nrepos:\n  child:\n    remote: example\n    base: main\n",
    );
    mkdirSync(join(root, ".aiw"));
    writeFileSync(join(root, ".aiw", "aiw-toolchain.env"), 'AIW_VERSION="v0.1.0"\n');
    writeFileSync(join(root, "root.txt"), "root\n");
    commit(root, "root baseline");
    git(root, ["switch", "-c", "change/test"]);
    writeFileSync(join(root, "notes.txt"), "needle root\n");
    commit(root, "root change");

    writeFileSync(join(child, "keep.txt"), "needle committed\n");
    mkdirSync(join(child, "src"));
    writeFileSync(join(child, "src", "old name.txt"), "keep\n".repeat(10));
    writeFileSync(join(child, "deleted.txt"), "delete me\n");
    const childBase = commit(child, "child baseline");
    git(child, ["switch", "-c", "change/test"]);
    git(child, ["mv", "src/old name.txt", "src/new name.txt"]);
    writeFileSync(join(child, "src", "new name.txt"), `${"keep\n".repeat(9)}after needle\n`);
    git(child, ["rm", "deleted.txt"]);
    const untrackedName = "未 跟踪.txt";
    git(child, ["config", "core.quotePath", "false"]);
    writeFileSync(join(child, untrackedName), "needle untracked\n");
    writeFileSync(join(temp, "outside"), "outside\n");
    symlinkSync(join(temp, "outside"), join(child, "escape"));

    const rows = JSON.stringify([
      {
        repo: "agent-repo",
        path: root,
        active: true,
        ready: true,
        drift: false,
        git: { branch: "change/test", head: git(root, ["rev-parse", "HEAD"]) },
      },
      {
        repo: "child",
        path: child,
        baseSha: childBase,
        active: true,
        ready: true,
        drift: false,
        git: { branch: "change/test", head: git(child, ["rev-parse", "HEAD"]) },
      },
    ]);
    writeFileSync(
      bin,
      `#!/bin/sh\nif [ "$1" = version ]; then printf v0.1.0; else printf '%s' '${rows.replace(/'/g, "'\\\"'\\\"'")}'; fi\n`,
    );
    chmodSync(bin, 0o755);
    process.env.AIW_COMPANION_AIW = bin;

    const view = catalog(root);
    assert.equal(view.repos[0]?.id, "$root");
    assert.equal(view.repos[1]?.path, realpathSync(child));
    assert.deepEqual(
      tree(root, "child", "src", false).entries.map((entry) => entry.name),
      ["new name.txt"],
    );
    assert.match(readFile(root, "child", "src/new name.txt", 1).content, /after needle\n$/);
    assert.throws(() => readFile(root, "child", "escape", 1), /symlink escapes/);
    assert.throws(() => readFile(root, "child", "././.git/config", 1), /Git metadata/);
    assert.throws(() => readFile(root, "child", "../outside", 1), /repository-relative/);

    const all = changes(root, "all");
    const group = all.groups.find((item) => item.repo.id === "child");
    assert.ok(group);
    assert.equal(group.error, null);
    assert.ok(
      group.files.some((item) => item.origin === "untracked" && item.path === untrackedName),
    );
    const untracked = group.files.find(
      (item) => item.origin === "untracked" && item.path === untrackedName,
    );
    assert.ok(untracked);
    assert.equal(untracked.additions, 1);
    assert.equal(untracked.deletions, 0);
    const untrackedPatch = patch(
      root,
      "child",
      untracked.path,
      untracked.oldPath,
      untracked.origin,
      "all",
      group.snapshotId,
    );
    assert.match(untrackedPatch.patch, /needle untracked/);
    assert.match(untrackedPatch.patch, /未 跟踪\.txt/);
    assert.ok(!untrackedPatch.patch.includes(realpathSync(child)));
    const renamed = group.files.find((item) => item.path === "src/new name.txt");
    assert.ok(renamed, JSON.stringify(group.files));
    assert.equal(renamed.status, "R");
    assert.equal(renamed.oldPath, "src/old name.txt");
    const diff = patch(
      root,
      "child",
      renamed.path,
      renamed.oldPath,
      renamed.origin,
      "all",
      group.snapshotId,
    );
    assert.match(diff.patch, /new name/);
    assert.throws(
      () => patch(root, "child", renamed.path, renamed.oldPath, renamed.origin, "all", "stale"),
      /snapshot is stale/,
    );
    const deleted = group.files.find((item) => item.path === "deleted.txt");
    assert.ok(deleted);
    assert.equal(
      patch(root, "child", deleted.path, deleted.oldPath, deleted.origin, "all", group.snapshotId)
        .before,
      "delete me\n",
    );

    const working = changes(root, "working").groups.find((item) => item.repo.id === "child");
    assert.ok(working);
    assert.ok(working.files.some((item) => item.origin === "staged" && item.status === "R"));
    assert.ok(
      working.files.some((item) => item.origin === "unstaged" && item.path === "src/new name.txt"),
    );
    const branch = changes(root, "branch");
    assert.ok(
      branch.groups
        .find((item) => item.repo.id === "$root")
        ?.files.some((item) => item.path === "notes.txt" && item.origin === "branch"),
    );

    const result = await search(root, ["child", "$root"], "needle", false, true, [], []);
    assert.deepEqual(result.errors, []);
    assert.ok(
      result.hits.some((hit) => hit.repoId === "child" && hit.path === untrackedName),
      JSON.stringify(result),
    );
    assert.ok(
      !(await search(root, ["child"], "needle", false, true, ["**"], ["**/*.txt"])).hits.some(
        (hit) => hit.path === untrackedName,
      ),
    );

    // Streaming must stop at the UI cap even when a full scan exceeds the old output buffer.
    mkdirSync(join(child, "flood"));
    for (let index = 0; index < 48; index++)
      writeFileSync(
        join(child, "flood", `${index}.txt`),
        `needle ${"x".repeat(400)}\n`.repeat(1000),
      );
    const capped = await search(root, ["child"], "needle", false, true, ["flood/*.txt"], []);
    assert.deepEqual(capped.errors, []);
    assert.equal(capped.hits.length, 1000);
    assert.equal(capped.truncated, true);
    writeFileSync(join(child, "literal[one]{a}.txt"), "needle literal\n");
    const literal = await search(
      root,
      ["child"],
      "needle",
      false,
      true,
      ["literal[one]{a}.txt"],
      [],
    );
    assert.deepEqual(literal.errors, []);
    assert.equal(literal.hits[0]?.path, "literal[one]{a}.txt");

    // Existing host-managed AIW installs do not require a project-local bootstrap lock.
    unlinkSync(join(root, ".aiw", "aiw-toolchain.env"));
    writeFileSync(
      bin,
      `#!/bin/sh\nif [ "$1" = version ]; then printf dev; else printf '%s' '${rows.replace(/'/g, "'\\\"'\\\"'")}'; fi\n`,
    );
    assert.equal(catalog(root).aiwVersion, "dev");
    assert.match(readFile(root, "child", "keep.txt", 1).content, /needle/);
    writeFileSync(join(root, ".aiw", "aiw-toolchain.env"), 'AIW_VERSION="v0.1.0"\n');
    assert.throws(() => catalog(root), /version mismatch/);
    writeFileSync(join(root, ".aiw", "aiw-toolchain.env"), "BROKEN_LOCK=true\n");
    assert.throws(() => catalog(root), /no AIW_VERSION/);
    writeFileSync(join(root, ".aiw", "aiw-toolchain.env"), 'AIW_VERSION="dev"\n');
    assert.equal(catalog(root).aiwVersion, "dev");
    unlinkSync(join(root, ".aiw", "aiw-toolchain.env"));

    // A selected but unmaterialized repository is visible, with no filesystem read granted.
    const rootOnly = JSON.stringify([
      { repo: "agent-repo", path: root, active: true, ready: false, drift: false },
    ]);
    writeFileSync(join(root, ".aiw", "change.yaml"), "version: 1\nrepos:\n  - child\n");
    writeFileSync(
      bin,
      `#!/bin/sh\nif [ "$1" = version ]; then printf dev; else printf '%s' '${rootOnly}'; fi\n`,
    );
    const pending = catalog(root);
    assert.equal(pending.repos.length, 2);
    assert.equal(pending.repos[1]?.ready, false);
    assert.match(pending.repos[1]?.error ?? "", /尚未物化/);
    assert.throws(() => tree(root, "child", "", false), /尚未物化/);
    assert.match(readFile(root, "$root", "root.txt", 1).content, /root/);
    assert.match(changes(root, "working").groups[1]?.error ?? "", /尚未物化/);
    writeFileSync(bin, '#!/bin/sh\nif [ "$1" = version ]; then printf dev; else printf "[]"; fi\n');
    assert.throws(() => catalog(root), /Agent Repo identity/);
  } finally {
    if (previous === undefined) delete process.env.AIW_COMPANION_AIW;
    else process.env.AIW_COMPANION_AIW = previous;
    rmSync(temp, { recursive: true, force: true });
  }
});
