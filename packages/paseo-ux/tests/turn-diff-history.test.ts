import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TurnDiffStore } from "../server/turn-diff";

function git(cwd: string, ...args: string[]) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
  );
  return execFileSync("git", args, {
    cwd,
    env: {
      ...env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
    encoding: "utf8",
  });
}

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "paseo-turn-history-test-"));
  const repo = join(base, "repo");
  const dataDirectory = join(base, "history");
  await mkdir(repo);
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "History fixture");
  git(repo, "config", "user.email", "history@example.test");
  await writeFile(join(repo, "file.txt"), "original\nbase\n");
  git(repo, "add", "file.txt");
  git(repo, "commit", "-qm", "baseline");
  const event = (turnId: string) => ({ agent: { id: "agent", cwd: repo }, turnId });
  const end = (turnId: string) => ({ ...event(turnId), outcome: { kind: "completed" as const } });
  return { base, repo, dataDirectory, event, end };
}

test("existing staged and unstaged edits form the baseline without executing Git filters", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, "file.txt"), "staged\nbase\n");
    git(f.repo, "add", "file.txt");
    await writeFile(join(f.repo, "file.txt"), "staged\nbefore\n");
    await writeFile(join(f.repo, "untracked.txt"), "untracked before\n");
    await writeFile(join(f.repo, ".gitattributes"), "file.txt filter=blocked diff=blocked\n");
    git(f.repo, "config", "filter.blocked.clean", "false");
    git(f.repo, "config", "filter.blocked.required", "true");
    git(f.repo, "config", "diff.blocked.command", "false");
    git(f.repo, "config", "diff.blocked.textconv", "false");
    const originalIndex = await readFile(join(f.repo, ".git", "index"));
    const originalHead = git(f.repo, "rev-parse", "HEAD");
    const store = new TurnDiffStore({ dataDirectory: f.dataDirectory });
    await store.start(f.event("dirty"));
    await writeFile(join(f.repo, "file.txt"), "staged\nafter\n");
    await writeFile(join(f.repo, "untracked.txt"), "untracked after\n");
    assert.ok(await store.end(f.end("dirty")));
    assert.deepEqual(await readFile(join(f.repo, ".git", "index")), originalIndex);
    assert.equal(git(f.repo, "rev-parse", "HEAD"), originalHead);
    assert.equal(git(f.repo, "show", ":file.txt"), "staged\nbase\n");
    const diff = await store.read({ agentId: "agent", turnId: "dirty", path: "file.txt" });
    assert.match(diff.patch, /-before\n\+after/);
    assert.doesNotMatch(diff.patch, /-original|-base/);
    const untracked = await store.read({
      agentId: "agent",
      turnId: "dirty",
      path: "untracked.txt",
    });
    assert.match(untracked.patch, /-untracked before\n\+untracked after/);
    await assert.rejects(store.read({ agentId: "agent", turnId: "dirty", path: "../outside" }));
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test("saved snapshots survive reload and GC, then history and pending refs expire", async () => {
  const f = await fixture();
  let clock = Date.now();
  try {
    const store = new TurnDiffStore({ dataDirectory: f.dataDirectory, now: () => clock });
    await store.start(f.event("saved"));
    await writeFile(join(f.repo, "file.txt"), "saved after\n");
    await store.end(f.end("saved"));
    const refs = () =>
      git(f.repo, "for-each-ref", "--format=%(refname)", "refs/paseo-ux/turns/")
        .trim()
        .split("\n")
        .filter(Boolean);
    assert.equal(refs().length, 2);
    git(f.repo, "gc", "--prune=now", "--quiet");
    const reloaded = new TurnDiffStore({ dataDirectory: f.dataDirectory, now: () => clock });
    const diff = await reloaded.read({ agentId: "agent", turnId: "saved", path: "file.txt" });
    assert.match(diff.patch, /\+saved after/);
    if (process.platform !== "win32") {
      assert.equal((await stat(f.dataDirectory)).mode & 0o777, 0o700);
      assert.equal((await stat(join(f.dataDirectory, "journal.json"))).mode & 0o777, 0o600);
    }
    clock += 31 * 24 * 60 * 60 * 1000;
    const expired = new TurnDiffStore({ dataDirectory: f.dataDirectory, now: () => clock });
    assert.deepEqual((await expired.list({ agentId: "agent" })).turns, []);
    assert.deepEqual(refs(), []);
    await expired.start(f.event("pending"));
    assert.equal(refs().length, 1);
    clock += 24 * 60 * 60 * 1000 + 1;
    const afterPendingExpiry = new TurnDiffStore({
      dataDirectory: f.dataDirectory,
      now: () => clock,
    });
    assert.equal(await afterPendingExpiry.end(f.end("pending")), null);
    assert.deepEqual(refs(), []);
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test("history enforces the 2,000 turn limit and paginates without duplicate entries", async () => {
  const f = await fixture();
  const clock = Date.now();
  try {
    const store = new TurnDiffStore({ dataDirectory: f.dataDirectory, now: () => clock });
    await store.start(f.event("seed"));
    await writeFile(join(f.repo, "file.txt"), "seed change\n");
    await store.end(f.end("seed"));
    const journalPath = join(f.dataDirectory, "journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    // Populate metadata deterministically from a real stored turn; the seed's refs
    // continue retaining its objects. These synthetic entries own no extra refs.
    const seed = journal.turns[0];
    journal.turns = Array.from({ length: 2_003 }, (_, index) => ({
      ...seed,
      id: `history-${index}`,
      endedAt: new Date(clock - index * 1_000).toISOString(),
      refs: [],
    }));
    await writeFile(journalPath, JSON.stringify(journal));
    const bounded = new TurnDiffStore({ dataDirectory: f.dataDirectory, now: () => clock });
    const first = await bounded.list({ agentId: "agent" });
    assert.equal(first.turns.length, 50);
    assert.equal(first.turns[0]?.id, "history-0");
    assert.ok(first.nextCursor);
    const next = await bounded.list({ agentId: "agent", cursor: first.nextCursor });
    assert.equal(next.turns[0]?.id, "history-50");
    assert.equal(new Set([...first.turns, ...next.turns].map((turn) => turn.id)).size, 100);
    assert.equal(JSON.parse(await readFile(journalPath, "utf8")).turns.length, 2_000);
    assert.deepEqual((await bounded.list({ agentId: "agent", turnId: "history-2002" })).turns, []);
    await assert.rejects(bounded.list({ agentId: "agent", cursor: "invalid-cursor" }));
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test("invalid history is preserved, missing starts and unrelated ends cannot manufacture changes", async () => {
  const f = await fixture();
  try {
    await mkdir(f.dataDirectory);
    const journalPath = join(f.dataDirectory, "journal.json");
    await writeFile(journalPath, "{ damaged journal");
    const invalid = new TurnDiffStore({ dataDirectory: f.dataDirectory });
    await assert.rejects(invalid.list({ agentId: "agent" }));
    await invalid.clearPending();
    assert.equal(await readFile(journalPath, "utf8"), "{ damaged journal");
    const malformedEntry = JSON.stringify({ version: 1, pending: [], turns: [{}] });
    await writeFile(journalPath, malformedEntry);
    const invalidEntry = new TurnDiffStore({ dataDirectory: f.dataDirectory });
    await assert.rejects(invalidEntry.list({ agentId: "agent" }));
    await invalidEntry.clearPending();
    assert.equal(await readFile(journalPath, "utf8"), malformedEntry);
    const malformedPending = JSON.stringify({ version: 1, pending: [{}], turns: [] });
    await writeFile(journalPath, malformedPending);
    const invalidPending = new TurnDiffStore({ dataDirectory: f.dataDirectory });
    await assert.rejects(invalidPending.list({ agentId: "agent" }));
    await invalidPending.clearPending();
    assert.equal(await readFile(journalPath, "utf8"), malformedPending);

    const validDirectory = join(f.base, "valid-history");
    const store = new TurnDiffStore({ dataDirectory: validDirectory });
    assert.equal(await store.end(f.end("missing")), null);
    await store.start(f.event("current"));
    assert.equal(await store.end(f.end("unrelated")), null);
    await writeFile(join(f.repo, "file.txt"), "current change\n");
    assert.ok(await store.end(f.end("current")));
    assert.equal(await store.end(f.end("current")), null);
    assert.equal((await store.list({ agentId: "agent" })).turns.length, 1);
    const partial = JSON.parse(await readFile(join(validDirectory, "journal.json"), "utf8"));
    partial.turns[0].fileSnapshots = [{}];
    const malformedSnapshot = JSON.stringify(partial);
    await writeFile(journalPath, malformedSnapshot);
    const invalidSnapshot = new TurnDiffStore({ dataDirectory: f.dataDirectory });
    await assert.rejects(invalidSnapshot.list({ agentId: "agent" }));
    await invalidSnapshot.clearPending();
    assert.equal(await readFile(journalPath, "utf8"), malformedSnapshot);

    const noGit = join(f.base, "no-git");
    const noHead = join(f.base, "no-head");
    await mkdir(noGit);
    await mkdir(noHead);
    git(noHead, "init", "-q");
    for (const [id, cwd] of [
      ["no-git", noGit],
      ["no-head", noHead],
    ]) {
      const event = { agent: { id, cwd }, turnId: id };
      await store.start(event);
      await writeFile(join(cwd!, "file.txt"), "new content\n");
      assert.equal(await store.end({ ...event, outcome: { kind: "completed" } }), null);
      assert.deepEqual((await store.list({ agentId: id! })).turns, []);
    }
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test("turns stay bound to the physical repository and detect overlap from a subdirectory", async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    const store = new TurnDiffStore({ dataDirectory: f.dataDirectory });
    await store.start(f.event("moved"));
    await writeFile(join(f.repo, "file.txt"), "first repository changed\n");
    await writeFile(join(other.repo, "file.txt"), "other repository changed\n");
    assert.equal(
      await store.end({ ...f.end("moved"), agent: { id: "agent", cwd: other.repo } }),
      null,
    );
    assert.deepEqual((await store.list({ agentId: "agent" })).turns, []);
    for (const repo of [f.repo, other.repo]) {
      assert.equal(git(repo, "for-each-ref", "--format=%(refname)", "refs/paseo-ux/turns/"), "");
    }

    const alias = join(f.base, "repo-alias");
    await symlink(f.repo, alias, process.platform === "win32" ? "junction" : "dir");
    await store.start({ ...f.event("alias"), agent: { id: "agent", cwd: alias } });
    await writeFile(join(f.repo, "file.txt"), "alias change\n");
    assert.ok(await store.end(f.end("alias")));
    const aliasSummary = (await store.list({ agentId: "agent", turnId: "alias" })).turns[0]!;
    assert.ok(
      !aliasSummary.warnings.some((warning) => /directory changed|attribution/i.test(warning)),
    );

    await mkdir(join(f.repo, "src"));
    const root = { agent: { id: "root-agent", cwd: f.repo }, turnId: "root-overlap" };
    const subdir = {
      agent: { id: "subdir-agent", cwd: join(f.repo, "src") },
      turnId: "subdir-overlap",
    };
    await store.start(root);
    await store.start(subdir);
    await writeFile(join(f.repo, "file.txt"), "overlapping change\n");
    for (const event of [root, subdir]) {
      const card = await store.end({ ...event, outcome: { kind: "completed" } });
      assert.ok(card);
      assert.ok(card.warnings.some((warning) => /attribution/i.test(warning)));
    }
  } finally {
    await rm(f.base, { recursive: true, force: true });
    await rm(other.base, { recursive: true, force: true });
  }
});

test("nullable public lifecycle IDs pair by agent and retain their generated identity on reload", async () => {
  const f = await fixture();
  try {
    let store = new TurnDiffStore({ dataDirectory: f.dataDirectory });
    const cases = [
      [null, null],
      [null, "assigned-at-end"],
      ["known-at-start", null],
    ] as const;
    for (const [index, [startId, endId]] of cases.entries()) {
      await store.start({ ...f.event("unused"), turnId: startId });
      store = new TurnDiffStore({ dataDirectory: f.dataDirectory });
      await writeFile(join(f.repo, "file.txt"), `nullable change ${index}\n`);
      const card = await store.end({ ...f.end("unused"), turnId: endId });
      assert.ok(card);
      const diff = await store.read({ agentId: "agent", turnId: card.turnId, path: "file.txt" });
      assert.match(diff.patch, new RegExp(`\\+nullable change ${index}`));
      assert.equal(await store.end({ ...f.end("unused"), turnId: endId }), null);
    }
    assert.equal((await store.list({ agentId: "agent" })).turns.length, 3);
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});
