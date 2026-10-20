import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parse as parseYaml } from "yaml";
import type {
  Catalog,
  ChangedFile,
  Changes,
  FileContent,
  FileEntry,
  Origin,
  Patch,
  Repo,
  Scope,
  SearchResult,
} from "../shared/contracts";
import { matchesPatterns } from "../shared/patterns";

const ROOT_REPO = "$root";
const MAX_TREE_ENTRIES = 1_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_PATCH_BYTES = 1_000_000;
const MAX_SEARCH_HITS = 1_000;
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_FILE_SCAN_BYTES = 16 * 1024 * 1024;
const activeSearches = new Set<ChildProcess>();
let searchesStopped = false;

export function stopSearches(): void {
  searchesStopped = true;
  for (const child of activeSearches) child.kill();
}

type StatusRow = {
  repo: string;
  path: string;
  baseSha?: string;
  ready?: boolean;
  active?: boolean;
  drift?: boolean;
  git?: { branch?: string; head?: string };
};

type ChangeRecord = Omit<ChangedFile, "repoId">;

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message: string): never {
  throw new Error(message);
}

function run(file: string, args: readonly string[], cwd: string, allowed = [0]): Buffer {
  const result = spawnSync(file, [...args], {
    cwd,
    encoding: null,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 32 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (result.error) fail(`${file}: ${result.error.message}`);
  if (!allowed.includes(result.status ?? -1)) {
    const detail = result.stderr?.toString("utf8").trim() || `exit ${String(result.status)}`;
    fail(`${file} ${args[0] ?? ""}: ${detail}`);
  }
  return result.stdout ?? Buffer.alloc(0);
}

function git(root: string, args: readonly string[], allowed?: number[]): Buffer {
  return run("git", args, root, allowed);
}

function gitText(root: string, args: readonly string[], allowed?: number[]): string {
  return git(root, args, allowed).toString("utf8").trim();
}

function ignoredByGit(root: string, path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", path], {
    cwd: root,
    encoding: null,
  });
  if (result.error) fail(`git check-ignore: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1)
    fail(
      `git check-ignore: ${result.stderr?.toString("utf8").trim() || `exit ${String(result.status)}`}`,
    );
  return result.status === 0;
}

function realDirectory(path: string, label: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) fail(`${label} is not a directory`);
  return realpathSync(path);
}

function isWithin(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

function normalizedPath(path: string): string {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some((part) => part === ".."))
    fail("path must be a repository-relative path");
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolveInside(
  repoRoot: string,
  requested: string,
  requireExists = true,
): { path: string; relativePath: string } {
  const relativePath = normalizedPath(requested);
  const candidate = resolve(repoRoot, relativePath);
  if (!isWithin(repoRoot, candidate)) fail("path escapes repository root");
  if (requireExists && !existsSync(candidate)) fail(`file not found: ${relativePath}`);
  const actual = requireExists ? realpathSync(candidate) : candidate;
  if (requireExists && !isWithin(repoRoot, actual)) fail("symlink escapes repository root");
  const canonicalPath = relative(repoRoot, candidate).split(sep).join("/");
  if (canonicalPath === ".git" || canonicalPath.startsWith(".git/"))
    fail("Git metadata is not browsable");
  return { path: actual, relativePath };
}

function hashFile(path: string): string {
  const info = statSync(path);
  const handle = openSync(path, "r");
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  try {
    for (
      let position = 0;
      position < Math.min(info.size, MAX_FILE_SCAN_BYTES);
      position += chunk.length
    ) {
      const bytes = readSync(
        handle,
        chunk,
        0,
        Math.min(chunk.length, MAX_FILE_SCAN_BYTES - position),
        position,
      );
      if (bytes === 0) break;
      hash.update(chunk.subarray(0, bytes));
    }
  } finally {
    closeSync(handle);
  }
  return `${info.size}:${info.mtimeMs}:${hash.digest("hex")}`;
}

function boundedFile(
  path: string,
  startLine: number,
): {
  content: string;
  totalLines: number;
  additions: number | null;
  binary: boolean;
  truncated: boolean;
  hash: string;
} {
  const info = statSync(path);
  const handle = openSync(path, "r");
  const hash = createHash("sha256");
  const decoder = new StringDecoder("utf8");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let carry = "";
  let content = "";
  let lines = 0;
  let binary = false;
  let selected = 0;
  let truncated = false;
  let endedWithNewline = false;
  let lineFeeds = 0;
  let lastByte = -1;
  const recordLine = (line: string) => {
    lines++;
    if (lines < startLine) return;
    if (selected >= 2_000) {
      truncated = true;
      return;
    }
    const value = `${selected ? "\n" : ""}${line}`;
    const remaining = MAX_FILE_BYTES - Buffer.byteLength(content);
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (Buffer.byteLength(value) > remaining) {
      content += Buffer.from(value).subarray(0, remaining).toString("utf8");
      truncated = true;
    } else content += value;
    selected++;
  };
  const consume = (text: string) => {
    if (text === "" && carry === "") return;
    const all = carry + text;
    const values = all.split(/\r?\n/);
    carry = values.pop() ?? "";
    endedWithNewline = carry === "" && /\r?\n$/.test(all);
    for (const line of values) recordLine(line);
  };
  try {
    for (
      let position = 0;
      position < Math.min(info.size, MAX_FILE_SCAN_BYTES);
      position += chunk.length
    ) {
      const count = readSync(
        handle,
        chunk,
        0,
        Math.min(chunk.length, MAX_FILE_SCAN_BYTES - position),
        position,
      );
      if (count === 0) break;
      const part = chunk.subarray(0, count);
      hash.update(part);
      if (part.includes(0)) binary = true;
      for (const byte of part) if (byte === 10) lineFeeds++;
      lastByte = part[count - 1] ?? lastByte;
      if (binary) continue;
      consume(decoder.write(part));
    }
    if (!binary) {
      consume(decoder.end());
      if (carry.length > 0 || lines === 0 || endedWithNewline) recordLine(carry);
    }
  } finally {
    closeSync(handle);
  }
  const exceededScan = info.size > MAX_FILE_SCAN_BYTES;
  return {
    content: binary ? "" : content,
    totalLines: binary ? 0 : lines,
    additions:
      binary || exceededScan ? null : lineFeeds + (info.size > 0 && lastByte !== 10 ? 1 : 0),
    binary,
    truncated: binary || truncated || exceededScan,
    hash: `${info.size}:${info.mtimeMs}:${hash.digest("hex")}`,
  };
}

function parseLock(root: string): string | null {
  const lock = join(root, ".aiw", "aiw-toolchain.env");
  if (!existsSync(lock)) return null;
  const match = readFileSync(lock, "utf8").match(/^AIW_VERSION=["']?([^\n"']+)["']?\s*$/m);
  if (!match?.[1]) fail("AIW toolchain lock has no AIW_VERSION");
  return match[1];
}

function aiwBinary(root: string): string {
  const local = join(root, ".aiw", "bin", "aiw");
  if (existsSync(local)) return local;
  return process.env.AIW_COMPANION_AIW ?? "aiw";
}

function aiw(root: string, args: readonly string[]): { version: string; output: Buffer } {
  const expected = parseLock(root);
  const binary = aiwBinary(root);
  const version = run(binary, ["version"], root).toString("utf8").trim();
  if (!version || version.length > 128 || /\s/.test(version))
    fail("AIW binary returned an invalid version");
  if (expected !== null && version !== expected)
    fail(`AIW binary version mismatch: expected ${expected}, got ${version}`);
  return { version, output: run(binary, args, root) };
}

function asStatusRows(value: unknown): StatusRow[] {
  if (!Array.isArray(value)) fail("AIW status did not return an array");
  const names = new Set<string>();
  return value.map((row): StatusRow => {
    if (typeof row !== "object" || row === null) fail("AIW status contains an invalid row");
    const item = row as Record<string, unknown>;
    if (typeof item.repo !== "string" || typeof item.path !== "string")
      fail("AIW status row lacks repo/path");
    if (names.has(item.repo)) fail(`AIW status contains duplicate repository: ${item.repo}`);
    names.add(item.repo);
    const gitValue =
      typeof item.git === "object" && item.git !== null
        ? (item.git as Record<string, unknown>)
        : undefined;
    return {
      repo: item.repo,
      path: item.path,
      baseSha: typeof item.baseSha === "string" ? item.baseSha : undefined,
      ready: typeof item.ready === "boolean" ? item.ready : undefined,
      active: typeof item.active === "boolean" ? item.active : undefined,
      drift: typeof item.drift === "boolean" ? item.drift : undefined,
      git: gitValue
        ? {
            branch: typeof gitValue.branch === "string" ? gitValue.branch : undefined,
            head: typeof gitValue.head === "string" ? gitValue.head : undefined,
          }
        : undefined,
    };
  });
}

function selectedRepos(root: string): string[] {
  const path = join(root, ".aiw", "change.yaml");
  if (!existsSync(path)) return [];
  const value: unknown = parseYaml(readFileSync(path, "utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    !("repos" in value) ||
    !Array.isArray(value.repos)
  )
    fail("AIW Change manifest has no repos list");
  return [
    ...new Set(
      value.repos.map((name: unknown) => {
        if (
          typeof name !== "string" ||
          !name ||
          name === "." ||
          name === ".." ||
          /[\\/]/.test(name)
        )
          fail("AIW Change manifest contains an invalid repository name");
        return name;
      }),
    ),
  ];
}

function configuredBase(root: string): string {
  const data = parseYaml(readFileSync(join(root, "aiw.yaml"), "utf8"));
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).base !== "string"
  )
    fail("aiw.yaml has no root base branch");
  return (data as Record<string, unknown>).base as string;
}

function repoFromPath(
  id: string,
  name: string,
  path: string,
  baseSha: string,
  ready: boolean,
  inheritedError: string | null,
): Repo {
  try {
    const actual = realDirectory(path, `repository ${id}`);
    const gitRoot = realpathSync(gitText(actual, ["rev-parse", "--show-toplevel"]));
    if (gitRoot !== actual) fail("Git root identity mismatch");
    return {
      id,
      name,
      path: actual,
      branch: gitText(actual, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      head: gitText(actual, ["rev-parse", "HEAD"]),
      baseSha,
      ready,
      error: inheritedError,
    };
  } catch (error) {
    return {
      id,
      name,
      path,
      branch: "",
      head: "",
      baseSha,
      ready: false,
      error: inheritedError ?? (error instanceof Error ? error.message : String(error)),
    };
  }
}

export function catalog(root: string): Catalog {
  const actualRoot = realDirectory(root, "workspace root");
  const response = aiw(actualRoot, ["change", "status", "--json"]);
  const status = asStatusRows(JSON.parse(response.output.toString("utf8")) as unknown);
  const agent = status.find((row) => row.repo === "agent-repo");
  if (!agent || realDirectory(agent.path, "AIW Agent Repo") !== actualRoot)
    fail("AIW status Agent Repo identity mismatch");
  const rootBase = gitText(actualRoot, ["merge-base", configuredBase(actualRoot), "HEAD"]);
  const rootRepo = repoFromPath(ROOT_REPO, "根仓（上下文）", actualRoot, rootBase, true, null);
  const repos: Repo[] = [rootRepo];
  for (const row of status) {
    if (row.repo === "agent-repo") continue;
    const ready = row.ready === true && row.active === true && row.drift !== true;
    const missingBase = !row.baseSha;
    const repo = repoFromPath(
      row.repo,
      row.repo,
      row.path,
      row.baseSha ?? "",
      ready && !missingBase,
      !ready
        ? "AIW repository is not ready, active, and on the Change branch"
        : missingBase
          ? "AIW repository has no recorded base SHA"
          : null,
    );
    if (
      !repo.error &&
      ((row.git?.branch && repo.branch !== row.git.branch) ||
        (row.git?.head && repo.head !== row.git.head))
    ) {
      repo.ready = false;
      repo.error = "AIW status Git identity mismatch";
    }
    repos.push(repo);
  }
  for (const name of selectedRepos(actualRoot)) {
    if (repos.some((repo) => repo.id === name)) continue;
    repos.push({
      id: name,
      name,
      path: join(actualRoot, "repos", name),
      branch: "",
      head: "",
      baseSha: "",
      ready: false,
      error: "此业务仓尚未物化，请先在 AIW 工作区完成物化后刷新。",
    });
  }
  const common = realpathSync(
    gitText(actualRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  return {
    root: actualRoot,
    projectKey: digest(common),
    branch: rootRepo.branch,
    readAt: new Date().toISOString(),
    aiwVersion: response.version,
    repos,
  };
}

function requireRepo(root: string, repoId: string): Repo {
  const repo = catalog(root).repos.find((item) => item.id === repoId);
  if (!repo) fail(`unknown repository: ${repoId}`);
  if (!repo.ready || repo.error)
    fail(`repository ${repoId} is unavailable: ${repo.error ?? "not ready"}`);
  return repo;
}

export function tree(
  root: string,
  repoId: string,
  path: string,
  showIgnored: boolean,
): { entries: FileEntry[]; truncated: boolean } {
  const repo = requireRepo(root, repoId);
  const directory = resolveInside(repo.path, path || ".");
  if (!statSync(directory.path).isDirectory()) fail("path is not a directory");
  const entries: FileEntry[] = [];
  let truncated = false;
  for (const item of readdirSync(directory.path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (item.name === ".git") continue;
    const childPath =
      directory.relativePath === "." ? item.name : `${directory.relativePath}/${item.name}`;
    const ignored = ignoredByGit(repo.path, childPath);
    if (!showIgnored && ignored) continue;
    if (entries.length === MAX_TREE_ENTRIES) {
      truncated = true;
      break;
    }
    const child = join(directory.path, item.name);
    const info = lstatSync(child);
    entries.push({
      name: item.name,
      path: childPath,
      directory: info.isDirectory(),
      symlink: info.isSymbolicLink(),
    });
  }
  return { entries, truncated };
}

export function readFile(
  root: string,
  repoId: string,
  path: string,
  startLine: number,
): FileContent {
  const repo = requireRepo(root, repoId);
  const file = resolveInside(repo.path, path);
  if (!statSync(file.path).isFile()) fail("path is not a regular file");
  const value = boundedFile(file.path, startLine);
  return {
    path: file.relativePath,
    content: value.content,
    startLine,
    totalLines: value.totalLines,
    binary: value.binary,
    truncated: value.truncated,
    head: repo.head,
    contentHash: value.hash,
  };
}

function parseNameStatus(data: Buffer, origin: Origin): ChangeRecord[] {
  const fields = data.toString("utf8").split("\0");
  const result: ChangeRecord[] = [];
  for (let index = 0; index < fields.length - 1; index++) {
    const code = fields[index].replace(/[0-9]/g, "");
    if (!code) continue;
    const firstPath = fields[++index];
    const path = firstPath;
    if (!path) continue;
    const renamed = code === "R" || code === "C";
    const oldPath = renamed ? firstPath : undefined;
    const newPath = renamed ? fields[++index] : firstPath;
    if (!newPath) continue;
    const status =
      code === "U" ? "conflict" : code === "T" ? "M" : (code[0] as "A" | "M" | "D" | "R" | "C");
    result.push({
      path: newPath,
      ...(oldPath ? { oldPath } : {}),
      status,
      origin,
      additions: null,
      deletions: null,
      binary: false,
    });
  }
  return result;
}

function parseNumstat(
  data: Buffer,
): Map<string, { additions: number | null; deletions: number | null; binary: boolean }> {
  const fields = data.toString("utf8").split("\0");
  const values = new Map<
    string,
    { additions: number | null; deletions: number | null; binary: boolean }
  >();
  for (let index = 0; index < fields.length - 1; index++) {
    const item = fields[index];
    const match = item.match(/^(-|\d+)\t(-|\d+)\t(.*)$/);
    if (!match) continue;
    let name = match[3];
    if (name === "") {
      index++;
      name = fields[index + 1] ?? fields[index] ?? "";
      index++;
    }
    if (!name) continue;
    values.set(name, {
      additions: match[1] === "-" ? null : Number(match[1]),
      deletions: match[2] === "-" ? null : Number(match[2]),
      binary: match[1] === "-" || match[2] === "-",
    });
  }
  return values;
}

function withStats(repo: string, args: readonly string[], records: ChangeRecord[]): ChangeRecord[] {
  const stats = parseNumstat(git(repo, [...args, "--numstat", "-z"]));
  return records.map((record) => {
    const stat = stats.get(record.path) ?? (record.oldPath ? stats.get(record.oldPath) : undefined);
    return stat ? { ...record, ...stat } : record;
  });
}

function safeUntrackedPaths(repo: string): string[] {
  return git(repo, ["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => {
      try {
        return statSync(resolveInside(repo, path).path).isFile();
      } catch {
        return false;
      }
    });
}

function untracked(repo: string): ChangeRecord[] {
  const names = safeUntrackedPaths(repo);
  return names.map((path) => {
    const value = boundedFile(resolveInside(repo, path).path, 1);
    return {
      path,
      status: "A" as const,
      origin: "untracked" as const,
      additions: value.additions,
      deletions: value.binary || value.additions === null ? null : 0,
      binary: value.binary,
    };
  });
}

function recordsFor(repo: Repo, scope: Scope, baseline: string): ChangeRecord[] {
  if (scope === "branch") {
    const base = ["diff", "--find-renames", "--name-status", "-z", baseline, "HEAD"];
    return withStats(
      repo.path,
      ["diff", "--find-renames", baseline, "HEAD"],
      parseNameStatus(git(repo.path, base), "branch"),
    );
  }
  if (scope === "all") {
    const base = ["diff", "--find-renames", "--name-status", "-z", baseline];
    return [
      ...withStats(
        repo.path,
        ["diff", "--find-renames", baseline],
        parseNameStatus(git(repo.path, base), "combined"),
      ),
      ...untracked(repo.path),
    ];
  }
  const staged = withStats(
    repo.path,
    ["diff", "--cached", "--find-renames"],
    parseNameStatus(
      git(repo.path, ["diff", "--cached", "--find-renames", "--name-status", "-z"]),
      "staged",
    ),
  );
  const unstaged = withStats(
    repo.path,
    ["diff", "--find-renames"],
    parseNameStatus(git(repo.path, ["diff", "--find-renames", "--name-status", "-z"]), "unstaged"),
  );
  return [...staged, ...unstaged, ...untracked(repo.path)];
}

function verifyBaseline(repo: Repo, requested?: string): string {
  const baseline = requested ?? repo.baseSha;
  if (!baseline) fail(`repository ${repo.id} has no baseline`);
  return gitText(repo.path, ["rev-parse", "--verify", `${baseline}^{commit}`]);
}

function snapshot(repo: Repo, baseline: string, scope: Scope): string {
  const fragments = [
    repo.id,
    baseline,
    repo.head,
    scope,
    git(repo.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).toString("binary"),
  ];
  if (scope === "all")
    fragments.push(git(repo.path, ["diff", "--binary", baseline]).toString("binary"));
  if (scope === "working")
    fragments.push(
      git(repo.path, ["diff", "--cached", "--binary"]).toString("binary"),
      git(repo.path, ["diff", "--binary"]).toString("binary"),
    );
  if (scope !== "branch") {
    const files = safeUntrackedPaths(repo.path);
    for (const path of files) fragments.push(path, hashFile(resolveInside(repo.path, path).path));
  }
  return digest(fragments.join("\u0000"));
}

export function changes(root: string, scope: Scope, baselineOverride?: string): Changes {
  const current = catalog(root);
  const groups = current.repos.map((repo) => {
    if (!repo.ready || repo.error)
      return {
        repo,
        baseline: repo.baseSha,
        head: repo.head,
        snapshotId: "",
        files: [],
        error: repo.error ?? "repository not ready",
      };
    try {
      const baseline = verifyBaseline(repo, baselineOverride);
      return {
        repo,
        baseline,
        head: repo.head,
        snapshotId: snapshot(repo, baseline, scope),
        files: recordsFor(repo, scope, baseline).map((file) => ({ repoId: repo.id, ...file })),
        error: null,
      };
    } catch (error) {
      return {
        repo,
        baseline: repo.baseSha,
        head: repo.head,
        snapshotId: "",
        files: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return { groups, readAt: new Date().toISOString() };
}

function showAt(repo: Repo, spec: string): string {
  try {
    return git(repo.path, ["show", spec]).subarray(0, MAX_FILE_BYTES).toString("utf8");
  } catch {
    return "";
  }
}

function liveText(repo: Repo, path: string): string {
  const file = resolveInside(repo.path, path);
  return boundedFile(file.path, 1).content;
}

export function patch(
  root: string,
  repoId: string,
  path: string,
  oldPath: string | undefined,
  origin: Origin,
  scope: Scope,
  expectedSnapshot: string,
  baselineOverride?: string,
): Patch {
  const repo = requireRepo(root, repoId);
  const baseline = verifyBaseline(repo, baselineOverride);
  const current = snapshot(repo, baseline, scope);
  if (current !== expectedSnapshot)
    fail("snapshot is stale; refresh changes before opening this patch");
  const target = normalizedPath(path);
  const oldTarget = oldPath ? normalizedPath(oldPath) : target;
  let before = "";
  let after = "";
  let args: string[];
  const paths = oldTarget === target ? [target] : [oldTarget, target];
  if (origin === "branch") {
    before = showAt(repo, `${baseline}:${oldTarget}`);
    after = showAt(repo, `HEAD:${target}`);
    args = ["diff", "--binary", "--find-renames", baseline, "HEAD", "--", ...paths];
  } else if (origin === "combined") {
    before = showAt(repo, `${baseline}:${oldTarget}`);
    after = existsSync(join(repo.path, target)) ? liveText(repo, target) : "";
    args = ["diff", "--binary", "--find-renames", baseline, "--", ...paths];
  } else if (origin === "staged") {
    before = showAt(repo, `HEAD:${oldTarget}`);
    after = showAt(repo, `:${target}`);
    args = ["diff", "--cached", "--binary", "--find-renames", "--", ...paths];
  } else if (origin === "unstaged") {
    before = showAt(repo, `:${oldTarget}`);
    after = existsSync(join(repo.path, target)) ? liveText(repo, target) : "";
    args = ["diff", "--binary", "--find-renames", "--", ...paths];
  } else {
    after = liveText(repo, target);
    args = ["diff", "--no-index", "/dev/null", `./${target}`];
  }
  const raw = git(repo.path, args, origin === "untracked" ? [0, 1] : undefined);
  const binary =
    raw.includes(0) ||
    before.includes("\0") ||
    after.includes("\0") ||
    raw.toString("utf8").includes("Binary files");
  return {
    patch: raw.subarray(0, MAX_PATCH_BYTES).toString("utf8"),
    binary,
    truncated:
      raw.length > MAX_PATCH_BYTES ||
      Buffer.byteLength(before) >= MAX_FILE_BYTES ||
      Buffer.byteLength(after) >= MAX_FILE_BYTES,
    before,
    after,
  };
}

function isCandidate(
  path: string,
  include: readonly string[],
  exclude: readonly string[],
): boolean {
  return matchesPatterns(path, undefined, include.length ? include : ["**"], exclude);
}

async function searchRepository(
  repo: Repo,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
  include: string[],
  exclude: string[],
  limit: number,
): Promise<{ hits: SearchResult["hits"]; truncated: boolean }> {
  // Keep the shared matcher authoritative; only translate whole-segment globstars.
  const globs = include.every((pattern) =>
    pattern.split("/").every((part) => !part.includes("**") || part === "**"),
  )
    ? include.flatMap((pattern) => ["--glob", `/${pattern.replace(/[\[\]{}\\]/g, "\\$&")}`])
    : [];
  const args = [
    "--json",
    "--line-number",
    "--no-heading",
    "--max-count",
    String(limit),
    "--max-filesize",
    "1M",
    "--hidden",
    "--glob",
    "!.git",
    ...globs,
    ...(caseSensitive ? [] : ["-i"]),
    ...(regex ? [] : ["-F"]),
    "--",
    query,
    ".",
  ];
  return new Promise((resolvePromise, reject) => {
    const child = spawn("rg", args, {
      cwd: repo.path,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeSearches.add(child);
    const hits: SearchResult["hits"] = [];
    let pending = "",
      stderr = "",
      truncated = false;
    let failure: Error | undefined;
    const timeout = setTimeout(() => {
      failure = new Error("rg search timed out");
      child.kill();
    }, COMMAND_TIMEOUT_MS);
    const consume = (line: string) => {
      if (!line || truncated || failure) return;
      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
        return;
      }
      if (typeof event !== "object" || event === null) return;
      const record = event as Record<string, unknown>;
      if (record.type !== "match" || typeof record.data !== "object" || record.data === null)
        return;
      const data = record.data as Record<string, unknown>;
      const path =
        typeof data.path === "object" &&
        data.path !== null &&
        typeof (data.path as Record<string, unknown>).text === "string"
          ? ((data.path as Record<string, unknown>).text as string)
          : "";
      const lineNumber = typeof data.line_number === "number" ? data.line_number : 0;
      const text =
        typeof data.lines === "object" &&
        data.lines !== null &&
        typeof (data.lines as Record<string, unknown>).text === "string"
          ? ((data.lines as Record<string, unknown>).text as string)
          : "";
      if (!path || !lineNumber) return;
      let relativePath: string;
      try {
        relativePath = normalizedPath(path);
        resolveInside(repo.path, relativePath);
      } catch {
        return;
      }
      if (!isCandidate(relativePath, include, exclude)) return;
      hits.push({
        repoId: repo.id,
        path: relativePath,
        line: lineNumber,
        text: text.trimEnd().slice(0, 500),
      });
      if (hits.length >= limit) {
        truncated = true;
        child.kill();
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (truncated || failure) return;
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1 && !truncated && !failure) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        consume(line);
      }
      if (truncated) pending = "";
      else if (Buffer.byteLength(pending) > 16 * 1024 * 1024) {
        failure = new Error("rg result line exceeds the size limit");
        child.kill();
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      activeSearches.delete(child);
      if (!failure && !truncated && pending) consume(pending);
      if (failure) reject(failure);
      else if (!truncated && code !== 0 && code !== 1)
        reject(new Error(stderr.trim() || `rg exited: ${signal ?? code}`));
      else resolvePromise({ hits, truncated });
    });
  });
}

export async function search(
  root: string,
  repoIds: string[],
  query: string,
  regex: boolean,
  caseSensitive: boolean,
  include: string[],
  exclude: string[],
): Promise<SearchResult> {
  const hits: SearchResult["hits"] = [];
  const errors: SearchResult["errors"] = [];
  let truncated = false;
  for (const repoId of repoIds) {
    if (searchesStopped) fail("Search stopped because the plugin was unloaded");
    try {
      const repo = requireRepo(root, repoId);
      const result = await searchRepository(
        repo,
        query,
        regex,
        caseSensitive,
        include,
        exclude,
        MAX_SEARCH_HITS - hits.length,
      );
      hits.push(...result.hits);
      truncated = result.truncated;
    } catch (error) {
      errors.push({ repoId, error: error instanceof Error ? error.message : String(error) });
    }
    if (truncated) break;
  }
  return { hits, errors, truncated, readAt: new Date().toISOString() };
}
