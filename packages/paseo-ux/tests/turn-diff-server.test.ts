import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TurnDiffStore } from "../server/turn-diff";

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
  );
  return execFileSync("git", args, { cwd, env, encoding: "utf8" });
}

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "paseo-turn-diff-test-"));
  const repo = join(base, "repo");
  const storeDir = join(base, "store");
  await mkdir(join(repo, "src"), { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Turn Diff Test");
  git(repo, "config", "user.email", "turn-diff@example.test");
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  await writeFile(join(repo, "src", "answer.ts"), "const answer = 1;\n");
  await writeFile(join(repo, "src", "rename.txt"), "keep this text\n");
  await writeFile(join(repo, "src", "delete.txt"), "remove this text\n");
  await writeFile(
    join(repo, "src", "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "baseline");
  return { base, repo, storeDir };
}

function turn(agentId: string, cwd: string, turnId: string) {
  return { agent: { id: agentId, cwd }, turnId };
}

function ended(
  agentId: string,
  cwd: string,
  turnId: string,
  kind: "completed" | "failed" | "canceled" = "completed",
) {
  return { ...turn(agentId, cwd, turnId), outcome: { kind } } as const;
}

async function snapshotState(repo: string) {
  return {
    head: git(repo, "rev-parse", "HEAD").trim(),
    index: await readFile(join(repo, ".git", "index")),
    status: git(repo, "--no-optional-locks", "status", "--porcelain=v1"),
  };
}

test("observing repository state does not refresh the index", async () => {
  const { base, repo } = await fixture();
  try {
    await writeFile(join(repo, "src", "answer.ts"), "const answer = 2;\n");
    const before = await readFile(join(repo, ".git", "index"));
    const first = await snapshotState(repo);
    const second = await snapshotState(repo);
    assert.deepEqual(first.index, before);
    assert.deepEqual(second.index, before);
    assert.equal(second.head, first.head);
    assert.equal(second.status, first.status);
    assert.match(first.status, /src\/answer\.ts/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("snapshots use a separate index, retain same-line changes and list large untracked paths", async () => {
  const { base, repo, storeDir } = await fixture();
  const store = new TurnDiffStore({ dataDirectory: storeDir });
  const originalGitDir = process.env.GIT_DIR;
  try {
    await writeFile(join(repo, "old-large.txt"), Buffer.alloc(1024 * 1024 + 3, 120));
    const beforeStart = await snapshotState(repo);
    process.env.GIT_DIR = join(base, "not-a-repository");
    await store.start(turn("agent-a", join(repo, "src"), "turn-1"));
    delete process.env.GIT_DIR;
    const afterStart = await snapshotState(repo);
    assert.equal(afterStart.head, beforeStart.head);
    assert.deepEqual(afterStart.index, beforeStart.index);
    assert.equal(afterStart.status, beforeStart.status);

    await writeFile(join(repo, "src", "answer.ts"), "const answer = 2;\n");
    await writeFile(join(repo, "new.txt"), "new file\n");
    await writeFile(join(repo, "src", "name\nbreak.txt"), "quoted path\n");
    await writeFile(join(repo, "ignored.txt"), "ignored\n");
    await writeFile(join(repo, "large.txt"), Buffer.alloc(1024 * 1024 + 5, 120));
    const beforeEnd = await snapshotState(repo);
    const card = await store.end(ended("agent-a", join(repo, "src"), "turn-1", "failed"));
    const afterEnd = await snapshotState(repo);
    assert.equal(afterEnd.head, beforeEnd.head);
    assert.deepEqual(afterEnd.index, beforeEnd.index);
    assert.equal(afterEnd.status, beforeEnd.status);

    assert.ok(card);
    assert.equal(card.kind, "turn-changes");
    const listed = await store.list({ agentId: "agent-a", turnId: "turn-1" });
    assert.equal(listed.turns.length, 1);
    const summary = listed.turns[0]!;
    assert.equal(summary.outcome, "failed");
    const answer = summary.files.find((file) => file.path === "src/answer.ts");
    assert.equal(answer?.added, 1);
    assert.equal(answer?.removed, 1);
    assert.ok(summary.files.some((file) => file.path === "new.txt"));
    assert.ok(summary.files.some((file) => file.path === "src/name\nbreak.txt"));
    assert.ok(summary.files.some((file) => file.path === "large.txt" && !file.diffAvailable));
    assert.ok(!summary.files.some((file) => file.path === "old-large.txt"));
    assert.ok(!summary.files.some((file) => file.path === "ignored.txt"));
    assert.ok(summary.warnings.some((warning) => warning.includes("1 MiB")));
    const diff = await store.read({ agentId: "agent-a", turnId: "turn-1", path: "src/answer.ts" });
    assert.equal(diff.kind, "text");
    assert.match(diff.patch, /-const answer = 1/);
    assert.match(diff.patch, /\+const answer = 2/);
    const large = await store.read({ agentId: "agent-a", turnId: "turn-1", path: "large.txt" });
    assert.equal(large.kind, "unavailable");
    await assert.rejects(
      store.read({ agentId: "other-agent", turnId: "turn-1", path: "src/answer.ts" }),
      /unavailable/,
    );
  } finally {
    if (originalGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = originalGitDir;
    await rm(base, { recursive: true, force: true });
  }
});

test("commit-only file changes and clean empty commits emit cards", async () => {
  const { base, repo, storeDir } = await fixture();
  const store = new TurnDiffStore({ dataDirectory: storeDir });
  try {
    await store.start(turn("agent-a", repo, "committed"));
    await writeFile(join(repo, "src", "answer.ts"), "const answer = 3;\n");
    git(repo, "add", "src/answer.ts");
    git(repo, "commit", "-m", "committed during turn");
    assert.equal(git(repo, "status", "--porcelain=v1"), "");
    const card = await store.end(ended("agent-a", repo, "committed"));
    assert.ok(card);
    const summary = (await store.list({ agentId: "agent-a", turnId: "committed" })).turns[0]!;
    assert.equal(summary.commits.length, 1);
    assert.equal(summary.commits[0]?.subject, "committed during turn");
    assert.ok(summary.files.some((file) => file.path === "src/answer.ts"));

    await store.start(turn("agent-a", repo, "empty"));
    git(repo, "commit", "--allow-empty", "-m", "net zero commit");
    const emptyCard = await store.end(ended("agent-a", repo, "empty"));
    assert.ok(emptyCard);
    assert.equal(emptyCard.totalFiles, 0);
    assert.equal(emptyCard.totalCommits, 1);
    const emptySummary = (await store.list({ agentId: "agent-a", turnId: "empty" })).turns[0]!;
    assert.deepEqual(emptySummary.files, []);
    assert.equal(emptySummary.commits.length, 1);

    await store.start(turn("agent-a", repo, "reverted-commits"));
    await writeFile(join(repo, "src", "answer.ts"), "const answer = 9;\n");
    git(repo, "add", "src/answer.ts");
    git(repo, "commit", "-m", "temporary change");
    await writeFile(join(repo, "src", "answer.ts"), "const answer = 3;\n");
    git(repo, "add", "src/answer.ts");
    git(repo, "commit", "-m", "restore initial content");
    const revertedCard = await store.end(ended("agent-a", repo, "reverted-commits"));
    assert.ok(revertedCard);
    assert.equal(revertedCard.totalFiles, 0);
    assert.equal(revertedCard.totalCommits, 2);

    await store.start(turn("agent-a", repo, "long-subject"));
    const longDir = ["é".repeat(100), "路径".repeat(40), "界".repeat(70)].join("/");
    const longPath = `long/${longDir}/preview.txt`;
    await mkdir(join(repo, "long", longDir), { recursive: true });
    await writeFile(join(repo, longPath), "long path change\n");
    git(repo, "add", longPath);
    const longSubject = `large subject ${"é".repeat(40_000)}`;
    git(repo, "-c", "core.quotePath=false", "commit", "-m", longSubject);
    const longCard = await store.end(ended("agent-a", repo, "long-subject"));
    assert.ok(longCard);
    assert.ok(Buffer.byteLength(JSON.stringify(longCard), "utf8") <= 64 * 1024);
    assert.equal(longCard.totalFiles, 1);
    assert.equal(longCard.totalCommits, 1);
    assert.ok(longCard.files.some((file) => file.path === longPath));
    assert.equal(longCard.commits.length, 0);
    assert.ok(longCard.warnings.some((warning) => warning.includes("omitted")));
    assert.ok(
      Buffer.byteLength(
        JSON.stringify({
          id: `turn-diff:agent-a:${longCard.turnId}`,
          type: "plugin",
          kind: longCard.kind,
          version: longCard.version,
          data: longCard,
          pluginId: "paseo-ux",
        }),
        "utf8",
      ) <=
        64 * 1024,
    );
    await store.start(turn("agent-a", repo, "no-op"));
    assert.equal(await store.end(ended("agent-a", repo, "no-op")), null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("rename, deletion and image changes are reported and read from recorded objects", async () => {
  const { base, repo, storeDir } = await fixture();
  const store = new TurnDiffStore({ dataDirectory: storeDir });
  try {
    await store.start(turn("agent-a", repo, "file-types"));
    await mkdir(join(repo, "src", "nested"), { recursive: true });
    await rename(join(repo, "src", "rename.txt"), join(repo, "src", "nested", "renamed.txt"));
    await unlink(join(repo, "src", "delete.txt"));
    await writeFile(
      join(repo, "icon.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const card = await store.end(ended("agent-a", repo, "file-types"));
    assert.ok(card);
    const summary = (await store.list({ agentId: "agent-a", turnId: "file-types" })).turns[0]!;
    assert.ok(
      summary.files.some(
        (file) =>
          file.status === "renamed" &&
          file.oldPath === "src/rename.txt" &&
          file.path === "src/nested/renamed.txt",
      ),
    );
    assert.ok(
      summary.files.some((file) => file.path === "src/delete.txt" && file.status === "deleted"),
    );
    const image = await store.read({ agentId: "agent-a", turnId: "file-types", path: "icon.png" });
    assert.equal(image.kind, "image");
    assert.ok(image.afterUri?.startsWith("data:image/png;base64,"));
    await store.start(turn("agent-a", repo, "image-format"));
    await writeFile(join(repo, "src", "pixel.png"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await store.end(ended("agent-a", repo, "image-format"));
    const formatChange = await store.read({
      agentId: "agent-a",
      turnId: "image-format",
      path: "src/pixel.png",
    });
    assert.ok(formatChange.beforeUri?.startsWith("data:image/png;base64,"));
    assert.ok(formatChange.afterUri?.startsWith("data:image/jpeg;base64,"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("pending snapshots survive reload and overlapping turns are marked uncertain", async () => {
  const { base, repo, storeDir } = await fixture();
  try {
    const first = new TurnDiffStore({ dataDirectory: storeDir });
    await first.start(turn("agent-a", repo, "reload"));
    const reloaded = new TurnDiffStore({ dataDirectory: storeDir });
    await reloaded.start(turn("agent-b", repo, "overlap"));
    await writeFile(join(repo, "src", "answer.ts"), "const answer = 4;\n");
    const firstCard = await reloaded.end(ended("agent-a", repo, "reload"));
    const secondCard = await reloaded.end(ended("agent-b", repo, "overlap"));
    assert.ok(firstCard);
    assert.ok(secondCard);
    const firstSummary = (await reloaded.list({ agentId: "agent-a", turnId: "reload" })).turns[0]!;
    const secondSummary = (await reloaded.list({ agentId: "agent-b", turnId: "overlap" }))
      .turns[0]!;
    assert.ok(
      firstSummary.warnings.some((warning) => warning.includes("attribution is uncertain")),
    );
    assert.ok(
      secondSummary.warnings.some((warning) => warning.includes("attribution is uncertain")),
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("linked worktrees with a shared Git common directory are not treated as overlapping", async () => {
  const { base, repo, storeDir } = await fixture();
  const linked = join(base, "linked");
  const store = new TurnDiffStore({ dataDirectory: storeDir });
  try {
    git(repo, "worktree", "add", "-q", "-b", "linked-branch", linked, "HEAD");
    await store.start(turn("agent-main", repo, "main-turn"));
    await store.start(turn("agent-linked", linked, "linked-turn"));
    await writeFile(join(repo, "src", "answer.ts"), "const answer = 5;\n");
    await writeFile(join(linked, "src", "answer.ts"), "const answer = 6;\n");
    await store.end(ended("agent-main", repo, "main-turn"));
    await store.end(ended("agent-linked", linked, "linked-turn"));
    const main = (await store.list({ agentId: "agent-main", turnId: "main-turn" })).turns[0]!;
    const other = (await store.list({ agentId: "agent-linked", turnId: "linked-turn" })).turns[0]!;
    assert.ok(!main.warnings.some((warning) => warning.includes("attribution is uncertain")));
    assert.ok(!other.warnings.some((warning) => warning.includes("attribution is uncertain")));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
