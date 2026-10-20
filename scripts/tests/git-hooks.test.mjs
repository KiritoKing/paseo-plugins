import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HOOK_NAMES } from "../../.githooks/install.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hooksSource = join(repositoryRoot, ".githooks");

const fakePnpmSource = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.HOOK_PNPM_LOG, JSON.stringify(args) + "\\n");
if (args.length !== 1 || !["check:commit", "check"].includes(args[0])) process.exit(64);
if (process.env.HOOK_ENV_LOG) {
  appendFileSync(process.env.HOOK_ENV_LOG, JSON.stringify({
    command: args[0], gitDir: process.env.GIT_DIR, gitIndex: process.env.GIT_INDEX_FILE
  }) + "\\n");
}
if (args[0] === "check" && process.env.HOOK_NESTED_REPO) {
  const { execFileSync } = require("node:child_process");
  const { realpathSync } = require("node:fs");
  const actual = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.env.HOOK_NESTED_REPO, encoding: "utf8"
  }).trim();
  if (actual !== realpathSync(process.env.HOOK_NESTED_REPO)) process.exit(67);
}
if (readFileSync("code.js", "utf8").includes("BAD")) process.exit(23);
`;

function run(command, args, cwd, env) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function git(fixture, ...args) {
  const result = run("git", args, fixture.repo, fixture.env);
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}\n${result.stdout}`,
    );
  }
  return result.stdout.replace(/\r?\n$/, "");
}

function gitAt(fixture, cwd, ...args) {
  const result = run("git", args, cwd, fixture.env);
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}\n${result.stdout}`,
    );
  }
  return result.stdout.replace(/\r?\n$/, "");
}

function writeHook(directory, name, source) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\n${source}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

function addGlobalSafetyHooks(fixture, { prePush = false } = {}) {
  writeHook(
    fixture.globalHooks,
    "pre-commit",
    [
      'printf "pre-commit\\n" >> "$HOOK_GLOBAL_LOG"',
      'printf "args:" >> "$HOOK_COMMIT_ARGS"',
      'printf " <%s>" "$@" >> "$HOOK_COMMIT_ARGS"',
      'printf "\\n" >> "$HOOK_COMMIT_ARGS"',
      '[ ! -f "$HOOK_BLOCK_MARKER" ] || exit 41',
    ].join("\n"),
  );
  if (prePush) {
    writeHook(
      fixture.globalHooks,
      "pre-push",
      [
        'printf "pre-push\\n" >> "$HOOK_GLOBAL_LOG"',
        'printf "%s\\n" "$@" > "$HOOK_PUSH_ARGS"',
        'cat > "$HOOK_PUSH_INPUT"',
      ].join("\n"),
    );
  }
}

function createFixture(t, { globalHooksPath = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "paseo-git-hooks-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const repo = join(directory, "repo");
  const globalHooks = join(directory, "global-hooks");
  const globalConfig = join(directory, "global.gitconfig");
  const systemConfig = join(directory, "system.gitconfig");
  const fakeBin = join(directory, "bin");
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(globalConfig, "");
  writeFileSync(systemConfig, "");
  writeFileSync(join(fakeBin, "pnpm"), fakePnpmSource, { mode: 0o755 });
  chmodSync(join(fakeBin, "pnpm"), 0o755);

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  env.GIT_CONFIG_GLOBAL = globalConfig;
  env.GIT_CONFIG_SYSTEM = systemConfig;
  env.GIT_TERMINAL_PROMPT = "0";
  env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ""}`;
  env.HOOK_GLOBAL_LOG = join(directory, "global-hooks.log");
  env.HOOK_BLOCK_MARKER = join(directory, "block-global-hook");
  env.HOOK_COMMIT_ARGS = join(directory, "pre-commit.args");
  env.HOOK_PNPM_LOG = join(directory, "pnpm.log");
  env.HOOK_PUSH_ARGS = join(directory, "pre-push.args");
  env.HOOK_PUSH_INPUT = join(directory, "pre-push.stdin");

  mkdirSync(repo, { recursive: true });
  if (globalHooksPath) {
    const config = run("git", ["config", "--global", "core.hooksPath", globalHooks], repo, env);
    assert.equal(config.status, 0, config.stderr);
  }
  const init = run("git", ["init", "--initial-branch=main"], repo, env);
  assert.equal(init.status, 0, init.stderr);
  for (const [key, value] of [
    ["user.name", "Git Hooks Test"],
    ["user.email", "git-hooks@example.invalid"],
  ]) {
    const config = run("git", ["config", "--local", key, value], repo, env);
    assert.equal(config.status, 0, config.stderr);
  }

  cpSync(hooksSource, join(repo, ".githooks"), { recursive: true });
  writeFileSync(join(repo, "package.json"), '{"name":"git-hooks-fixture"}\n');
  writeFileSync(
    join(repo, "biome.json"),
    '{"$schema":"https://biomejs.dev/schemas/2.0.0/schema.json"}\n',
  );
  writeFileSync(join(repo, "code.js"), 'export const value = "safe";\n');
  writeFileSync(join(repo, "other.js"), 'export const other = "safe";\n');
  const add = run("git", ["add", "-A"], repo, env);
  assert.equal(add.status, 0, add.stderr);
  const initial = run("git", ["commit", "-m", "initial fixture"], repo, env);
  assert.equal(initial.status, 0, initial.stderr);
  mkdirSync(globalHooks, { recursive: true });
  addGlobalSafetyHooks({ globalHooks, env });

  return {
    directory,
    repo,
    globalHooks,
    env,
    blockMarker: env.HOOK_BLOCK_MARKER,
    globalLog: env.HOOK_GLOBAL_LOG,
    pnpmLog: env.HOOK_PNPM_LOG,
  };
}

function install(fixture, cwd = fixture.repo) {
  const result = run(process.execPath, [join(cwd, ".githooks", "install.mjs")], cwd, fixture.env);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Installed Git hooks|Updated Git hooks|Git hooks already installed/);
  const setting = gitAt(
    fixture,
    cwd,
    "config",
    "--show-origin",
    "--path",
    "--get",
    "core.hooksPath",
  );
  assert.equal(
    gitAt(fixture, cwd, "config", "--local", "--get", "extensions.worktreeConfig"),
    "true",
    `installer should enable worktree config: ${setting}`,
  );
  return setting.slice(setting.indexOf("\t") + 1);
}

function head(fixture, cwd = fixture.repo) {
  return gitAt(fixture, cwd, "rev-parse", "HEAD");
}

function logLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
}

function commonConfigValue(fixture, key) {
  const configPath = join(fixture.repo, ".git", "config");
  const result = run(
    "git",
    ["config", "--file", configPath, "--no-includes", "--get", key],
    fixture.directory,
    fixture.env,
  );
  if (result.status === 1) return null;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replace(/\r?\n$/, "");
}

function assertUnsafeConfigRejected(t, key, value, message) {
  const fixture = createFixture(t);
  const configuredValue = typeof value === "function" ? value(fixture) : value;
  git(fixture, "config", "--local", key, configuredValue);

  const result = run(
    process.execPath,
    [join(fixture.repo, ".githooks", "install.mjs")],
    fixture.repo,
    fixture.env,
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(message));
  assert.match(`${result.stdout}\n${result.stderr}`, /manually migrate.*config\.worktree/);

  const gitDirectory = join(fixture.repo, ".git");
  assert.equal(existsSync(join(gitDirectory, "paseo-managed-hooks")), false);
  assert.equal(commonConfigValue(fixture, "extensions.worktreeConfig"), null);
  assert.equal(commonConfigValue(fixture, "core.hooksPath"), null);
  assert.equal(commonConfigValue(fixture, key), configuredValue);
  const globalSetting = run(
    "git",
    ["config", "--global", "--get", "core.hooksPath"],
    fixture.directory,
    fixture.env,
  );
  assert.equal(globalSetting.status, 0, globalSetting.stderr);
  assert.equal(globalSetting.stdout.replace(/\r?\n$/, ""), fixture.globalHooks);
}

test("refuses common core.worktree before writing managed hooks or config", (t) => {
  assertUnsafeConfigRejected(t, "core.worktree", "/synthetic/worktree", /core\.worktree/);
});

test("refuses common core.bare=true but allows core.bare=false", (t) => {
  assertUnsafeConfigRejected(t, "core.bare", "true", /core\.bare=true/);

  const fixture = createFixture(t);
  git(fixture, "config", "--local", "core.bare", "false");
  const managed = install(fixture);
  assert.equal(existsSync(managed), true);
  assert.equal(commonConfigValue(fixture, "core.bare"), "false");
});

test("installs every supported hook event only in the current worktree", (t) => {
  const fixture = createFixture(t);
  const untouched = join(fixture.directory, "untouched-worktree");
  const installed = join(fixture.directory, "installed-worktree");
  git(fixture, "worktree", "add", "-b", "untouched", untouched, "HEAD");
  git(fixture, "worktree", "add", "-b", "installed", installed, "HEAD");

  const managed = install(fixture, installed);
  const mainHooksPath = git(
    fixture,
    "config",
    "--show-origin",
    "--path",
    "--get",
    "core.hooksPath",
  );
  const otherHooksPath = gitAt(
    fixture,
    untouched,
    "config",
    "--show-origin",
    "--path",
    "--get",
    "core.hooksPath",
  );
  assert.equal(mainHooksPath.slice(mainHooksPath.indexOf("\t") + 1), fixture.globalHooks);
  assert.equal(otherHooksPath.slice(otherHooksPath.indexOf("\t") + 1), fixture.globalHooks);
  const installedSetting = gitAt(
    fixture,
    installed,
    "config",
    "--show-origin",
    "--path",
    "--get",
    "core.hooksPath",
  );
  assert.equal(installedSetting.slice(installedSetting.indexOf("\t") + 1), managed);
  assert.match(installedSetting.slice(0, installedSetting.indexOf("\t")), /config\.worktree$/);

  const manifest = JSON.parse(readFileSync(join(managed, "install.json"), "utf8"));
  assert.deepEqual(manifest.hooks, HOOK_NAMES);
  for (const name of HOOK_NAMES) {
    assert.equal(
      (statSync(join(managed, name)).mode & 0o111) !== 0,
      true,
      `${name} should be executable`,
    );
  }
});

test("good code commits and bad code fails without moving HEAD", (t) => {
  const fixture = createFixture(t);
  install(fixture);

  writeFileSync(join(fixture.repo, "other.js"), 'export const other = "unstaged but unrelated";\n');
  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "still safe";\n');
  git(fixture, "add", "code.js");
  const beforeGoodCommit = head(fixture);
  const goodCommit = run("git", ["commit", "-m", "safe change"], fixture.repo, fixture.env);
  assert.equal(goodCommit.status, 0, `${goodCommit.stdout}\n${goodCommit.stderr}`);
  assert.notEqual(head(fixture), beforeGoodCommit);
  assert.equal(
    readFileSync(join(fixture.repo, "other.js"), "utf8"),
    'export const other = "unstaged but unrelated";\n',
  );

  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "BAD";\n');
  git(fixture, "add", "code.js");
  const beforeBadCommit = head(fixture);
  const badCommit = run("git", ["commit", "-m", "bad change"], fixture.repo, fixture.env);
  assert.notEqual(badCommit.status, 0);
  assert.equal(head(fixture), beforeBadCommit);
  assert.deepEqual(
    logLines(fixture.pnpmLog),
    [["check:commit"], ["check:commit"]].map(JSON.stringify),
  );
});

test("rejects partially staged bad code even when the worktree copy is good", (t) => {
  const fixture = createFixture(t);
  install(fixture);

  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "BAD";\n');
  git(fixture, "add", "code.js");
  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "good worktree";\n');
  const before = head(fixture);
  const result = run("git", ["commit", "-m", "partial stage"], fixture.repo, fixture.env);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /staged files also have unstaged changes/);
  assert.equal(head(fixture), before);
  assert.deepEqual(logLines(fixture.pnpmLog), []);
});

test("rejects unstaged lint configuration changes", (t) => {
  const fixture = createFixture(t);
  install(fixture);

  writeFileSync(join(fixture.repo, "biome.json"), '{"formatter":{"enabled":false}}\n');
  writeFileSync(join(fixture.repo, "package.json"), '{"name":"changed-package-config"}\n');
  writeFileSync(join(fixture.repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(join(fixture.repo, "lint"), { recursive: true });
  writeFileSync(join(fixture.repo, "lint", "new-rule.grit"), "language js;\n");
  writeFileSync(join(fixture.repo, ".githooks", "install.mjs"), "// unstaged hook change\n", {
    flag: "a",
  });
  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "change";\n');
  git(fixture, "add", "code.js");
  const before = head(fixture);
  const result = run("git", ["commit", "-m", "configuration mismatch"], fixture.repo, fixture.env);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /lint, package, lock, or hook configuration/);
  for (const file of [
    "biome.json",
    "package.json",
    "pnpm-lock.yaml",
    "lint/new-rule.grit",
    ".githooks/install.mjs",
  ]) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(escaped));
  }
  assert.equal(head(fixture), before);
  assert.deepEqual(logLines(fixture.pnpmLog), []);
});

test("runs the inherited hook first and preserves its failure", (t) => {
  const fixture = createFixture(t);
  const managed = install(fixture);
  writeFileSync(fixture.blockMarker, "block\n");
  const direct = run(
    join(managed, "pre-commit"),
    ["one argument", "two"],
    fixture.repo,
    fixture.env,
  );
  assert.equal(direct.status, 41);
  assert.match(readFileSync(fixture.env.HOOK_COMMIT_ARGS, "utf8"), /args: <one argument> <two>\n/);
  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "one dispatch";\n');
  git(fixture, "add", "code.js");
  const before = head(fixture);

  const result = run("git", ["commit", "-m", "blocked by global hook"], fixture.repo, fixture.env);
  assert.equal(result.status, 1);
  assert.equal(head(fixture), before);
  assert.deepEqual(logLines(fixture.globalLog), ["pre-commit", "pre-commit"]);
  assert.deepEqual(logLines(fixture.pnpmLog), []);
});

test("repeat installation is idempotent and refuses unknown managed files", (t) => {
  const fixture = createFixture(t);
  const managed = install(fixture);
  const second = run(
    process.execPath,
    [join(fixture.repo, ".githooks", "install.mjs")],
    fixture.repo,
    fixture.env,
  );
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);

  writeFileSync(join(managed, "unrecognized-user-file"), "keep me\n");
  const third = run(
    process.execPath,
    [join(fixture.repo, ".githooks", "install.mjs")],
    fixture.repo,
    fixture.env,
  );
  assert.notEqual(third.status, 0);
  assert.equal(readFileSync(join(managed, "unrecognized-user-file"), "utf8"), "keep me\n");

  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "updated global";\n');
  git(fixture, "add", "code.js");
  const result = run("git", ["commit", "-m", "one dispatch"], fixture.repo, fixture.env);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(logLines(fixture.globalLog), ["pre-commit"]);
});

test("keeps forwarding to the current global hooks directory after it changes", (t) => {
  const fixture = createFixture(t);
  install(fixture);
  const nextHooks = join(fixture.directory, "new-global-hooks");
  writeHook(nextHooks, "pre-commit", 'printf "new-global\\n" >> "$HOOK_GLOBAL_LOG"');
  const update = run(
    "git",
    ["config", "--global", "--replace-all", "core.hooksPath", nextHooks],
    fixture.repo,
    fixture.env,
  );
  assert.equal(update.status, 0, update.stderr);

  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "branch without source";\n');
  git(fixture, "add", "code.js");
  const result = run("git", ["commit", "-m", "updated global hook"], fixture.repo, fixture.env);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(logLines(fixture.globalLog), ["new-global"]);
});

test("reinstallation upgrades only a verified owned dispatcher", (t) => {
  const fixture = createFixture(t);
  const managed = install(fixture);
  const before = JSON.parse(readFileSync(join(managed, "install.json"), "utf8"));
  const source = join(fixture.repo, ".githooks/dispatch.mjs");
  writeFileSync(source, `${readFileSync(source, "utf8")}\n// verified upgrade fixture\n`);
  install(fixture);
  const after = JSON.parse(readFileSync(join(managed, "install.json"), "utf8"));
  assert.match(readFileSync(join(managed, "dispatch.mjs"), "utf8"), /verified upgrade fixture/);
  assert.notEqual(after.files["dispatch.mjs"], before.files["dispatch.mjs"]);
  assert.deepEqual(after.originalHooks, before.originalHooks);
  assert.equal(after.files["pre-commit"], before.files["pre-commit"]);
  install(fixture);
});

test("push checks isolate nested Git repositories while inherited hooks keep their original environment", (t) => {
  const fixture = createFixture(t);
  const nested = join(fixture.directory, "nested");
  mkdirSync(nested);
  gitAt(fixture, nested, "init", "--initial-branch=main");
  const remote = join(fixture.directory, "remote.git");
  git(fixture, "init", "--bare", "--initial-branch=main", remote);
  git(fixture, "remote", "add", "origin", remote);
  const environmentLog = join(fixture.directory, "environment.jsonl");
  const originalLog = join(fixture.directory, "inherited-git-dir");
  writeHook(fixture.globalHooks, "pre-push", 'printf "%s" "$GIT_DIR" > "$HOOK_ORIGINAL_ENV"');
  install(fixture);
  const originalHead = head(fixture);
  const gitDirectory = git(fixture, "rev-parse", "--absolute-git-dir");
  const push = run("git", ["push", "origin", "main"], fixture.repo, {
    ...fixture.env,
    GIT_DIR: gitDirectory,
    GIT_WORK_TREE: fixture.repo,
    GIT_INDEX_FILE: join(gitDirectory, "index"),
    HOOK_ENV_LOG: environmentLog,
    HOOK_NESTED_REPO: nested,
    HOOK_ORIGINAL_ENV: originalLog,
  });
  assert.equal(push.status, 0, `${push.stdout}\n${push.stderr}`);
  assert.equal(readFileSync(originalLog, "utf8"), gitDirectory);
  assert.deepEqual(logLines(environmentLog).map(JSON.parse), [{ command: "check" }]);
  assert.equal(head(fixture), originalHead);
  assert.equal(gitAt(fixture, nested, "config", "--bool", "core.bare"), "false");
  assert.equal(git(fixture, "config", "user.name"), "Git Hooks Test");
});

test("a branch without .githooks still runs the persisted safety hook", (t) => {
  const fixture = createFixture(t);
  git(fixture, "checkout", "-b", "without-hook-source");
  git(fixture, "rm", "-r", ".githooks");
  const removal = run("git", ["commit", "-m", "remove source hooks"], fixture.repo, fixture.env);
  assert.equal(removal.status, 0, `${removal.stdout}\n${removal.stderr}`);
  git(fixture, "checkout", "main");
  install(fixture);
  git(fixture, "checkout", "without-hook-source");
  assert.equal(existsSync(join(fixture.repo, ".githooks")), false);

  writeFileSync(fixture.blockMarker, "block\n");
  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "default path";\n');
  git(fixture, "add", "code.js");
  const before = head(fixture);
  const rejected = run("git", ["commit", "-m", "persisted hook"], fixture.repo, fixture.env);
  assert.notEqual(rejected.status, 0);
  assert.equal(head(fixture), before);
  assert.deepEqual(logLines(fixture.pnpmLog), []);

  rmSync(fixture.blockMarker);
  const accepted = run("git", ["commit", "-m", "persisted hook passes"], fixture.repo, fixture.env);
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
  assert.deepEqual(logLines(fixture.pnpmLog), [["check:commit"]].map(JSON.stringify));
});

test("preserves pre-push stdin and rejects a tracked dirty tree", (t) => {
  const fixture = createFixture(t);
  addGlobalSafetyHooks(fixture, { prePush: true });
  const remote = join(fixture.directory, "remote.git");
  const initRemote = run(
    "git",
    ["init", "--bare", "--initial-branch=main", remote],
    fixture.repo,
    fixture.env,
  );
  assert.equal(initRemote.status, 0, initRemote.stderr);
  git(fixture, "remote", "add", "origin", remote);
  install(fixture);

  const cleanPush = run("git", ["push", "-u", "origin", "main"], fixture.repo, fixture.env);
  assert.equal(cleanPush.status, 0, `${cleanPush.stdout}\n${cleanPush.stderr}`);
  const stdin = readFileSync(fixture.env.HOOK_PUSH_INPUT, "utf8");
  assert.match(stdin, /refs\/heads\/main [0-9a-f]+ refs\/heads\/main [0-9a-f]+/);
  assert.match(readFileSync(fixture.env.HOOK_PUSH_ARGS, "utf8"), /^origin\n/);

  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "next commit";\n');
  git(fixture, "add", "code.js");
  const nextCommit = run("git", ["commit", "-m", "next commit"], fixture.repo, fixture.env);
  assert.equal(nextCommit.status, 0, `${nextCommit.stdout}\n${nextCommit.stderr}`);
  const remoteHead = git(fixture, "ls-remote", "origin", "refs/heads/main");
  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "uncommitted";\n');
  const checksBeforePush = logLines(fixture.pnpmLog).length;

  const dirtyPush = run("git", ["push", "origin", "main"], fixture.repo, fixture.env);
  assert.notEqual(dirtyPush.status, 0);
  assert.match(
    `${dirtyPush.stdout}\n${dirtyPush.stderr}`,
    /tracked working tree or index is dirty/,
  );
  assert.equal(git(fixture, "ls-remote", "origin", "refs/heads/main"), remoteHead);
  assert.equal(logLines(fixture.pnpmLog).length, checksBeforePush);
  assert.match(readFileSync(fixture.env.HOOK_PUSH_INPUT, "utf8"), /refs\/heads\/main/);
});

test("uses the repository default hooks directory when no core.hooksPath is configured", (t) => {
  const fixture = createFixture(t, { globalHooksPath: false });
  const defaultHooks = git(fixture, "rev-parse", "--path-format=absolute", "--git-path", "hooks");
  writeHook(defaultHooks, "pre-commit", 'printf "default\\n" >> "$HOOK_GLOBAL_LOG"');
  install(fixture);

  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "default path";\n');
  git(fixture, "add", "code.js");
  const result = run("git", ["commit", "-m", "default hook"], fixture.repo, fixture.env);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(logLines(fixture.globalLog), ["default"]);
});

test("fails closed with an explicit message when pnpm is missing", (t) => {
  const fixture = createFixture(t);
  install(fixture);
  const restrictedBin = join(fixture.directory, "no-pnpm-bin");
  mkdirSync(restrictedBin);
  symlinkSync(process.execPath, join(restrictedBin, "node"));
  const gitDirectory = (process.env.PATH ?? "")
    .split(delimiter)
    .map((directory) => join(directory, "git"))
    .find((path) => existsSync(path));
  const dirnamePath = (process.env.PATH ?? "")
    .split(delimiter)
    .map((directory) => join(directory, "dirname"))
    .find((path) => existsSync(path));
  assert.ok(gitDirectory, "git executable should be discoverable on PATH");
  assert.ok(dirnamePath, "dirname executable should be discoverable on PATH");
  symlinkSync(gitDirectory, join(restrictedBin, "git"));
  symlinkSync(dirnamePath, join(restrictedBin, "dirname"));
  fixture.env.PATH = restrictedBin;

  writeFileSync(join(fixture.repo, "code.js"), 'export const value = "pnpm missing";\n');
  git(fixture, "add", "code.js");
  const before = head(fixture);
  const result = run("git", ["commit", "-m", "pnpm missing"], fixture.repo, fixture.env);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /pnpm is required.*not found on PATH/);
  assert.equal(head(fixture), before);
});
