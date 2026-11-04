import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type TurnCard,
  type TurnCommit,
  type TurnFile,
  type TurnSummary,
  turnFileSchema,
  turnSummarySchema,
} from "../shared/turn-diff";

const MAX_UNTRACKED_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_FILES = 50_000;
const MAX_SNAPSHOT_BYTES = 1024 * 1024 * 1024;
const MAX_SNAPSHOT_PATH_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_MS = 120_000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_DIFF_CHARS = 200_000;
const MAX_CARD_BYTES = 64 * 1024;
const MAX_TURNS = 2000;
const TURN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_RETENTION_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 50;
const COMMIT_LIST_LIMIT = 100;
const REF_PREFIX = "refs/paseo-ux/turns/";
const REF_PATTERN = /^refs\/paseo-ux\/turns\/[0-9a-f-]{36}$/;
const OWNER_WARNING =
  "This turn overlapped another turn using the same Git worktree; file attribution is uncertain.";

type AgentTurn = {
  agent: { id: string; cwd: string };
  turnId: string | null;
};

type TurnEnded = AgentTurn & {
  outcome: { kind: "completed" } | { kind: "failed" } | { kind: "canceled" };
};

type GitOptions = {
  indexFile?: string;
  input?: Buffer;
  maxOutputBytes?: number;
  timeoutMs?: number;
};

type GitResult = { stdout: Buffer; truncated: boolean };
type TreeEntry = { mode: string; oid: string; type: string };
type Numstat = { added: number; removed: number; binary: boolean };
type ChangedPath = { path: string; oldPath?: string; status: TurnFile["status"] };
type StoredFile = { file: TurnFile; beforeOid: string | null; afterOid: string | null };
type SnapshotEntry = { path: string; mode: string; oid?: string; filePath?: string };
type OversizedFile = { path: string; size: number; mtimeMs: number; mode: number };

type PendingTurn = {
  id: string;
  providerTurnId?: string | null;
  agentId: string;
  startedAt: string;
  cwd: string;
  realCwd: string;
  gitRoot: string;
  commonDir: string;
  startCommit: string;
  startHead: string | null;
  ref: string;
  oversizedUntracked: OversizedFile[];
  warnings: string[];
  uncertain: boolean;
};

type StoredTurn = TurnSummary & {
  gitRoot: string;
  commonDir: string;
  startCommit: string;
  endCommit: string;
  refs: string[];
  fileSnapshots: StoredFile[];
};

type Journal = { version: 1; turns: StoredTurn[]; pending: PendingTurn[] };

function cleanGitEnv(indexFile?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(key) && value !== undefined) env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  env.LC_ALL = "C";
  if (indexFile) env.GIT_INDEX_FILE = indexFile;
  return env;
}

async function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  const child = spawn("git", ["-C", cwd, ...args], {
    cwd,
    env: cleanGitEnv(options.indexFile),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output: Buffer[] = [];
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  let outputBytes = 0;
  let truncated = false;
  let spawnError: Error | undefined;
  let timedOut = false;
  child.stdout.on("data", (chunk: Buffer) => {
    if (outputBytes >= maxOutputBytes) {
      truncated = true;
      return;
    }
    const accepted = chunk.subarray(0, maxOutputBytes - outputBytes);
    output.push(accepted);
    outputBytes += accepted.length;
    if (accepted.length !== chunk.length) truncated = true;
  });
  child.stderr.on("data", () => undefined);
  child.on("error", (error) => {
    spawnError = error;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 30_000);
  child.stdin.end(options.input);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once("close", (code, signal) => done({ code, signal }));
  }).finally(() => clearTimeout(timeout));
  if (spawnError) throw new Error("Git is unavailable.");
  if (timedOut) throw new Error("Git operation timed out.");
  if (exit.code !== 0) throw new Error("Git operation failed.");
  return { stdout: Buffer.concat(output, outputBytes), truncated };
}

async function runGitDir(
  gitDir: string,
  args: string[],
  options: Omit<GitOptions, "indexFile"> = {},
): Promise<GitResult> {
  const child = spawn("git", ["--git-dir", gitDir, ...args], {
    cwd: process.cwd(),
    env: cleanGitEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output: Buffer[] = [];
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  let outputBytes = 0;
  let truncated = false;
  let spawnError: Error | undefined;
  let timedOut = false;
  child.stdout.on("data", (chunk: Buffer) => {
    if (outputBytes >= maxOutputBytes) {
      truncated = true;
      return;
    }
    const accepted = chunk.subarray(0, maxOutputBytes - outputBytes);
    output.push(accepted);
    outputBytes += accepted.length;
    if (accepted.length !== chunk.length) truncated = true;
  });
  child.stderr.on("data", () => undefined);
  child.on("error", (error) => {
    spawnError = error;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 30_000);
  child.stdin.end();
  const exit = await new Promise<{ code: number | null }>((done) => {
    child.once("close", (code) => done({ code }));
  }).finally(() => clearTimeout(timeout));
  if (spawnError || timedOut || exit.code !== 0) throw new Error("Git operation failed.");
  return { stdout: Buffer.concat(output, outputBytes), truncated };
}

async function hashBytes(root: string, bytes: Buffer): Promise<string> {
  const child = spawn("git", ["-C", root, "hash-object", "-w", "--no-filters", "--stdin"], {
    cwd: root,
    env: cleanGitEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", () => undefined);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 30_000);
  child.stdin.end(bytes);
  const exit = await new Promise<{ code: number | null }>((done) => {
    child.once("close", (code) => done({ code }));
  }).finally(() => clearTimeout(timeout));
  if (timedOut || exit.code !== 0) throw new Error("Git object write failed.");
  const oid = stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(oid)) throw new Error("Git returned an invalid object ID.");
  return oid;
}

function quoteGitPath(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  let quoted = '"';
  for (const byte of bytes) {
    if (byte === 34) quoted += '\\"';
    else if (byte === 92) quoted += "\\\\";
    else if (byte === 7) quoted += "\\a";
    else if (byte === 8) quoted += "\\b";
    else if (byte === 9) quoted += "\\t";
    else if (byte === 10) quoted += "\\n";
    else if (byte === 11) quoted += "\\v";
    else if (byte === 12) quoted += "\\f";
    else if (byte === 13) quoted += "\\r";
    else if (byte < 32 || byte >= 127) quoted += `\\${byte.toString(8).padStart(3, "0")}`;
    else quoted += String.fromCharCode(byte);
  }
  return `${quoted}"`;
}

async function hashFilePaths(root: string, paths: string[], timeoutMs: number): Promise<string[]> {
  if (paths.length === 0) return [];
  const input = Buffer.from(`${paths.map(quoteGitPath).join("\n")}\n`, "utf8");
  if (input.length > MAX_SNAPSHOT_PATH_BYTES)
    throw new Error("Snapshot path list exceeded its size limit.");
  const result = await runGit(root, ["hash-object", "-w", "--no-filters", "--stdin-paths"], {
    input,
    maxOutputBytes: paths.length * 70 + 1024,
    timeoutMs,
  });
  const ids = result.stdout.toString("utf8").trim().split(/\r?\n/).filter(Boolean);
  if (
    result.truncated ||
    ids.length !== paths.length ||
    ids.some((oid) => !/^[0-9a-f]{40,64}$/.test(oid))
  )
    throw new Error("Git returned an invalid batch of object IDs.");
  return ids;
}

function nulStrings(buffer: Buffer): string[] {
  const strings = buffer.toString("utf8").split("\0");
  if (strings[strings.length - 1] === "") strings.pop();
  return strings;
}

function safePath(buffer: Buffer): string | null {
  const path = buffer.toString("utf8");
  return Buffer.from(path, "utf8").equals(buffer) ? path : null;
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel === "" ||
    (!isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  );
}

function parseIndexEntries(buffer: Buffer): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  for (const record of nulStrings(buffer)) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (stage === "0" && mode === "160000" && /^[0-9a-f]{40,64}$/.test(oid ?? ""))
      entries.set(path, { mode: mode!, oid: oid!, type: "commit" });
  }
  return entries;
}

function parseTreeEntries(buffer: Buffer): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  for (const record of nulStrings(buffer)) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, oid] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (mode && type && oid && /^[0-9a-f]{40,64}$/.test(oid))
      entries.set(path, { mode, oid, type });
  }
  return entries;
}

function parseChangedPaths(buffer: Buffer): ChangedPath[] {
  const fields = nulStrings(buffer);
  const files: ChangedPath[] = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i++];
    if (!status) break;
    if (status.startsWith("R")) {
      const oldPath = fields[i++];
      const path = fields[i++];
      if (oldPath !== undefined && path !== undefined)
        files.push({ path, oldPath, status: "renamed" });
      continue;
    }
    if (status.startsWith("C")) {
      i++;
      const path = fields[i++];
      if (path !== undefined) files.push({ path, status: "added" });
      continue;
    }
    const path = fields[i++];
    if (path === undefined) break;
    const mapped =
      status[0] === "A"
        ? "added"
        : status[0] === "D"
          ? "deleted"
          : status[0] === "T"
            ? "typechange"
            : "modified";
    files.push({ path, status: mapped });
  }
  return files;
}

function parseNumstat(buffer: Buffer): Map<string, Numstat> {
  const fields = nulStrings(buffer);
  const results = new Map<string, Numstat>();
  for (let i = 0; i < fields.length; ) {
    const record = fields[i++];
    if (record === undefined) break;
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const addedRaw = record.slice(0, firstTab);
    const removedRaw = record.slice(firstTab + 1, secondTab);
    const path = record.slice(secondTab + 1);
    const stat: Numstat = {
      added: /^\d+$/.test(addedRaw) ? Number(addedRaw) : 0,
      removed: /^\d+$/.test(removedRaw) ? Number(removedRaw) : 0,
      binary: addedRaw === "-" || removedRaw === "-",
    };
    if (path) {
      results.set(path, stat);
      continue;
    }
    const oldPath = fields[i++];
    const newPath = fields[i++];
    if (oldPath !== undefined && newPath !== undefined) results.set(`${oldPath}\0${newPath}`, stat);
  }
  return results;
}

function warningsUnique(warnings: string[]): string[] {
  return [...new Set(warnings)].slice(0, 50);
}

function isImagePath(path: string): boolean {
  return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path);
}

function imageMime(path: string, bytes?: Buffer): string | null {
  const extension = path.toLowerCase().split(".").pop();
  const byExtension: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    ico: "image/x-icon",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  if (bytes) {
    if (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return "image/png";
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      return "image/jpeg";
    if (
      bytes
        .subarray(0, 6)
        .toString("ascii")
        .match(/^GIF8[79]a$/)
    )
      return "image/gif";
    if (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    )
      return "image/webp";
    if (
      bytes.length >= 12 &&
      bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
      /avif|avis/.test(bytes.subarray(8, 16).toString("ascii"))
    )
      return "image/avif";
    if (bytes.length >= 2 && bytes[0] === 0 && bytes[1] === 0) return "image/x-icon";
    if (bytes.subarray(0, 256).toString("utf8").trimStart().startsWith("<svg"))
      return "image/svg+xml";
  }
  return extension && byExtension[extension] ? byExtension[extension] : null;
}

function decodeCursor(cursor: string): { endedAt: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "endedAt" in parsed &&
      "id" in parsed &&
      typeof parsed.endedAt === "string" &&
      typeof parsed.id === "string"
    )
      return { endedAt: parsed.endedAt, id: parsed.id };
  } catch {
    // The caller receives a stable validation error below.
  }
  throw new Error("Invalid turn changes cursor.");
}

function cursorFor(summary: TurnSummary): string {
  return Buffer.from(JSON.stringify({ endedAt: summary.endedAt, id: summary.id })).toString(
    "base64url",
  );
}

function makeTurnCard(
  summary: TurnSummary,
  totalCommits: number,
): { card: TurnCard; previewDropped: boolean } {
  const files = summary.files.slice(0, 20);
  const commits = summary.commits.slice(0, 10);
  const warnings = [...summary.warnings];
  let previewDropped =
    files.length < summary.files.length || commits.length < summary.commits.length;
  const build = (): TurnCard => ({
    kind: "turn-changes",
    version: 1,
    turnId: summary.id,
    totalFiles: summary.totalFiles,
    totalCommits,
    files: [...files],
    commits: [...commits],
    warnings: [...warnings],
  });
  const serializedItemSize = (candidate: TurnCard) =>
    Buffer.byteLength(
      JSON.stringify({
        id: `turn-diff:${summary.agentId}:${candidate.turnId}`,
        type: "plugin",
        kind: candidate.kind,
        version: candidate.version,
        data: candidate,
        pluginId: "paseo-ux",
      }),
      "utf8",
    );
  let card = build();
  while (serializedItemSize(card) > MAX_CARD_BYTES && (files.length > 0 || commits.length > 0)) {
    const lastFile = files[files.length - 1];
    const lastCommit = commits[commits.length - 1];
    if (
      lastCommit &&
      (!lastFile ||
        Buffer.byteLength(lastCommit.subject, "utf8") >= Buffer.byteLength(lastFile.path, "utf8"))
    )
      commits.pop();
    else files.pop();
    previewDropped = true;
    card = build();
  }
  if (previewDropped) {
    warnings.push(
      "Some file or commit previews were omitted to keep the timeline card below 64 KiB.",
    );
    card = build();
  }
  while (serializedItemSize(card) > MAX_CARD_BYTES && warnings.length > 0) {
    warnings.pop();
    card = build();
  }
  return { card, previewDropped };
}

function summaryOf(turn: StoredTurn): TurnSummary {
  return turnSummarySchema.parse({
    id: turn.id,
    agentId: turn.agentId,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    outcome: turn.outcome,
    files: turn.files,
    totalFiles: turn.totalFiles,
    commits: turn.commits,
    warnings: turn.warnings,
  });
}

function parseJournal(value: unknown): Journal | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<Journal>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.turns) ||
    !Array.isArray(candidate.pending)
  )
    return null;
  const turns: StoredTurn[] = [];
  for (const item of candidate.turns) {
    if (typeof item !== "object" || item === null) return null;
    const raw = item as Partial<StoredTurn>;
    const parsedSummary = turnSummarySchema.safeParse(raw);
    if (
      parsedSummary.success &&
      Number.isFinite(Date.parse(parsedSummary.data.startedAt)) &&
      Number.isFinite(Date.parse(parsedSummary.data.endedAt)) &&
      typeof raw.gitRoot === "string" &&
      typeof raw.commonDir === "string" &&
      typeof raw.startCommit === "string" &&
      typeof raw.endCommit === "string" &&
      Array.isArray(raw.refs) &&
      raw.refs.every((ref) => typeof ref === "string" && REF_PATTERN.test(ref)) &&
      Array.isArray(raw.fileSnapshots)
    ) {
      const fileSnapshots = raw.fileSnapshots.filter(
        (file): file is StoredFile =>
          typeof file === "object" &&
          file !== null &&
          turnFileSchema.safeParse((file as StoredFile).file).success &&
          ((file as StoredFile).beforeOid === null ||
            /^[0-9a-f]{40,64}$/.test((file as StoredFile).beforeOid ?? "")) &&
          ((file as StoredFile).afterOid === null ||
            /^[0-9a-f]{40,64}$/.test((file as StoredFile).afterOid ?? "")),
      );
      if (fileSnapshots.length !== raw.fileSnapshots.length) return null;
      turns.push({
        ...parsedSummary.data,
        gitRoot: raw.gitRoot,
        commonDir: raw.commonDir,
        startCommit: raw.startCommit,
        endCommit: raw.endCommit,
        refs: raw.refs,
        fileSnapshots,
      });
    } else return null;
  }
  const pending = candidate.pending.filter((item): item is PendingTurn => {
    if (typeof item !== "object" || item === null) return false;
    const raw = item as Partial<PendingTurn>;
    return (
      typeof raw.id === "string" &&
      (raw.providerTurnId === undefined ||
        raw.providerTurnId === null ||
        typeof raw.providerTurnId === "string") &&
      typeof raw.agentId === "string" &&
      typeof raw.startedAt === "string" &&
      Number.isFinite(Date.parse(raw.startedAt)) &&
      typeof raw.cwd === "string" &&
      typeof raw.realCwd === "string" &&
      typeof raw.gitRoot === "string" &&
      typeof raw.commonDir === "string" &&
      typeof raw.startCommit === "string" &&
      (raw.startHead === null || typeof raw.startHead === "string") &&
      typeof raw.ref === "string" &&
      REF_PATTERN.test(raw.ref) &&
      Array.isArray(raw.oversizedUntracked) &&
      raw.oversizedUntracked.every(
        (file) =>
          typeof file === "object" &&
          file !== null &&
          typeof (file as OversizedFile).path === "string" &&
          Number.isFinite((file as OversizedFile).size) &&
          Number.isFinite((file as OversizedFile).mtimeMs) &&
          Number.isFinite((file as OversizedFile).mode),
      ) &&
      Array.isArray(raw.warnings) &&
      raw.warnings.every((warning) => typeof warning === "string") &&
      typeof raw.uncertain === "boolean"
    );
  });
  if (pending.length !== candidate.pending.length) return null;
  return { version: 1, turns, pending };
}

export function turnDiffDataDirectory(): string {
  const home = process.env.PASEO_HOME?.trim();
  return join(
    home ? resolve(home) : join(homedir(), ".paseo"),
    "plugin-data",
    "paseo-ux",
    "turn-diff",
  );
}

export class TurnDiffStore {
  private journal: Journal = { version: 1, turns: [], pending: [] };
  private readonly filePath: string;
  private readonly now: () => number;
  private ready: Promise<void> | undefined;
  private initializationError: Error | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: { dataDirectory?: string; now?: () => number } = {}) {
    this.filePath = join(options.dataDirectory ?? turnDiffDataDirectory(), "journal.json");
    this.now = options.now ?? Date.now;
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.load().catch(() => {
        this.initializationError = new Error("Turn change history is unavailable.");
      });
    }
    return this.ready.then(() => {
      if (this.initializationError) throw this.initializationError;
    });
  }

  private async load(): Promise<void> {
    const directory = dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700).catch(() => undefined);
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.journal = { version: 1, turns: [], pending: [] };
      await this.persist();
      return;
    }
    const parsed = parseJournal(JSON.parse(raw));
    if (!parsed) throw new Error("Turn change history format is unsupported.");
    this.journal = parsed;
    const now = this.now();
    const keepPending: PendingTurn[] = [];
    for (const pending of this.journal.pending) {
      if (now - Date.parse(pending.startedAt) <= PENDING_RETENTION_MS) keepPending.push(pending);
      else await this.deleteRef(pending.commonDir, pending.ref);
    }
    this.journal.pending = keepPending;
    await this.pruneTurns();
    await this.persist();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async persist(): Promise<void> {
    const directory = dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700).catch(() => undefined);
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(this.journal), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, this.filePath);
      await fs.chmod(this.filePath, 0o600).catch(() => undefined);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async deleteRef(commonDir: string, ref: string): Promise<void> {
    if (!REF_PATTERN.test(ref)) return;
    try {
      await runGitDir(commonDir, ["update-ref", "-d", ref], {
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
      });
    } catch {
      // Stale refs are safe to leave behind if their repository is unavailable.
    }
  }

  private async pruneTurns(): Promise<void> {
    const cutoff = this.now() - TURN_RETENTION_MS;
    this.journal.turns.sort(
      (a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id),
    );
    const keep = this.journal.turns
      .filter((turn) => Date.parse(turn.endedAt) >= cutoff)
      .slice(0, MAX_TURNS);
    const kept = new Set(keep);
    for (const turn of this.journal.turns) {
      if (!kept.has(turn)) for (const ref of turn.refs) await this.deleteRef(turn.commonDir, ref);
    }
    this.journal.turns = keep;
  }

  private async snapshot(cwdValue: string): Promise<{
    cwd: string;
    gitRoot: string;
    commonDir: string;
    head: string | null;
    commit: string;
    ref: string;
    warnings: string[];
    oversizedUntracked: OversizedFile[];
  } | null> {
    let temporary: string | undefined;
    let createdRef: { commonDir: string; ref: string } | undefined;
    const deadline = Date.now() + MAX_SNAPSHOT_MS;
    const remaining = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) throw new Error("Snapshot deadline exceeded.");
      return Math.min(ms, 30_000);
    };
    try {
      const cwd = await fs.realpath(cwdValue);
      const topOutput = await runGit(cwd, ["rev-parse", "--show-toplevel"], {
        maxOutputBytes: 4096,
        timeoutMs: remaining(),
      });
      const gitRoot = await fs.realpath(
        resolve(cwd, topOutput.stdout.toString("utf8").replace(/\r?\n$/, "")),
      );
      const commonOutput = await runGit(gitRoot, ["rev-parse", "--git-common-dir"], {
        maxOutputBytes: 4096,
        timeoutMs: remaining(),
      });
      const commonDir = await fs.realpath(
        resolve(gitRoot, commonOutput.stdout.toString("utf8").replace(/\r?\n$/, "")),
      );
      let head: string | null = null;
      try {
        head = (
          await runGit(gitRoot, ["rev-parse", "--verify", "HEAD^{commit}"], {
            maxOutputBytes: 4096,
            timeoutMs: remaining(),
          })
        ).stdout
          .toString("utf8")
          .trim();
      } catch {
        head = null;
      }
      if (!head) return null;
      const trackedOutput = await runGit(gitRoot, ["ls-files", "--cached", "-z"], {
        maxOutputBytes: 16 * 1024 * 1024,
        timeoutMs: remaining(),
      });
      const indexOutput = await runGit(gitRoot, ["ls-files", "--stage", "-z"], {
        maxOutputBytes: 16 * 1024 * 1024,
        timeoutMs: remaining(),
      });
      const untrackedOutput = await runGit(
        gitRoot,
        ["ls-files", "--others", "--exclude-standard", "-z"],
        { maxOutputBytes: 16 * 1024 * 1024, timeoutMs: remaining() },
      );
      if (trackedOutput.truncated || indexOutput.truncated || untrackedOutput.truncated)
        throw new Error("Snapshot file list exceeded its size limit.");
      const headEntries = head
        ? parseTreeEntries(
            (
              await runGit(gitRoot, ["ls-tree", "-r", "-z", "-l", "--full-tree", head], {
                maxOutputBytes: 16 * 1024 * 1024,
                timeoutMs: remaining(),
              })
            ).stdout,
          )
        : new Map<string, TreeEntry>();
      const indexGitlinks = parseIndexEntries(indexOutput.stdout);
      const paths = new Set<string>([
        ...nulStrings(trackedOutput.stdout),
        ...headEntries.keys(),
        ...nulStrings(untrackedOutput.stdout),
      ]);
      if (paths.size > MAX_SNAPSHOT_FILES)
        throw new Error("Snapshot file count exceeded its size limit.");
      const warnings: string[] = [];
      const oversizedUntracked: OversizedFile[] = [];
      temporary = await fs.mkdtemp(join(tmpdir(), "paseo-turn-diff-"));
      await fs.chmod(temporary, 0o700).catch(() => undefined);
      const indexFile = join(temporary, "index");
      await runGit(gitRoot, ["read-tree", "--empty"], {
        indexFile,
        maxOutputBytes: 1024,
        timeoutMs: remaining(),
      });
      const entries: SnapshotEntry[] = [];
      let snapshotBytes = 0;
      let hasUntrackedTooLarge = false;
      const trackedSet = new Set([...nulStrings(trackedOutput.stdout), ...headEntries.keys()]);
      for (const path of paths) {
        remaining();
        const pathBytes = Buffer.from(path, "utf8");
        if (pathBytes.includes(0) || safePath(pathBytes) === null) {
          warnings.push("Some file names could not be represented safely and were skipped.");
          continue;
        }
        const absPath = resolve(gitRoot, ...path.split("/"));
        if (!inside(gitRoot, absPath)) {
          warnings.push("Some paths outside the repository were skipped.");
          continue;
        }
        const parent = await fs.realpath(dirname(absPath)).catch(() => null);
        if (parent === null || !inside(gitRoot, parent)) {
          warnings.push("Some paths through symlinked directories were skipped.");
          continue;
        }
        const stat = await fs.lstat(absPath).catch(() => null);
        if (!stat) continue;
        const isTracked = trackedSet.has(path);
        if (!isTracked && stat.size > MAX_UNTRACKED_BYTES) {
          hasUntrackedTooLarge = true;
          oversizedUntracked.push({
            path,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mode: stat.mode,
          });
          continue;
        }
        snapshotBytes += stat.size;
        if (snapshotBytes > MAX_SNAPSHOT_BYTES)
          throw new Error("Snapshot byte count exceeded its size limit.");
        const indexGitlink = indexGitlinks.get(path);
        const headEntry = headEntries.get(path);
        if ((indexGitlink || headEntry?.mode === "160000") && stat.isDirectory()) {
          let oid = indexGitlink?.oid ?? headEntry?.oid ?? "";
          try {
            const current = await runGit(absPath, ["rev-parse", "--verify", "HEAD^{commit}"], {
              maxOutputBytes: 4096,
              timeoutMs: remaining(),
            });
            const currentOid = current.stdout.toString("utf8").trim();
            if (/^[0-9a-f]{40,64}$/.test(currentOid)) oid = currentOid;
          } catch {
            // An uninitialized submodule keeps its recorded gitlink object ID.
          }
          if (oid) entries.push({ path, mode: "160000", oid });
          continue;
        }
        if (stat.isDirectory()) continue;
        if (!stat.isFile() && !stat.isSymbolicLink()) {
          warnings.push("Some special files were skipped.");
          continue;
        }
        let oid: string;
        let mode: string;
        if (stat.isSymbolicLink()) {
          const linkTarget = await fs.readlink(absPath, { encoding: "buffer" });
          if (!isTracked && linkTarget.length > MAX_UNTRACKED_BYTES) {
            hasUntrackedTooLarge = true;
            continue;
          }
          oid = await hashBytes(gitRoot, linkTarget);
          mode = "120000";
        } else {
          const realFile = await fs.realpath(absPath).catch(() => null);
          if (!realFile || !inside(gitRoot, realFile)) {
            warnings.push("Some paths through symlinked directories were skipped.");
            continue;
          }
          mode = stat.mode & 0o111 ? "100755" : "100644";
          entries.push({ path, mode, filePath: realFile });
          continue;
        }
        entries.push({ path, mode, oid });
      }
      if (hasUntrackedTooLarge)
        warnings.push("Untracked files larger than 1 MiB are listed without a readable diff.");
      for (let offset = 0; offset < entries.length; offset += 1000) {
        const chunk = entries.slice(offset, offset + 1000);
        const regular = chunk.filter(
          (entry): entry is SnapshotEntry & { filePath: string } => !!entry.filePath,
        );
        const oids = await hashFilePaths(
          gitRoot,
          regular.map((entry) => entry.path),
          remaining(),
        );
        for (let i = 0; i < regular.length; i++) regular[i]!.oid = oids[i]!;
      }
      for (let offset = 0; offset < entries.length; offset += 100) {
        const chunk = entries.slice(offset, offset + 100);
        const args = ["update-index", "--add"];
        for (const entry of chunk)
          if (entry.oid) args.push("--cacheinfo", entry.mode, entry.oid, entry.path);
        if (args.length > 2)
          await runGit(gitRoot, args, { indexFile, maxOutputBytes: 2048, timeoutMs: remaining() });
      }
      const tree = (
        await runGit(gitRoot, ["write-tree"], {
          indexFile,
          maxOutputBytes: 4096,
          timeoutMs: remaining(),
        })
      ).stdout
        .toString("utf8")
        .trim();
      if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error("Git returned an invalid tree ID.");
      const commitArgs = ["-c", "commit.gpgSign=false", "commit-tree", tree];
      if (head) commitArgs.push("-p", head);
      commitArgs.push("-m", "Paseo turn-diff snapshot");
      const commitEnv = cleanGitEnv();
      const timestamp = new Date(this.now()).toISOString();
      commitEnv.GIT_AUTHOR_NAME = "Paseo Essentials";
      commitEnv.GIT_AUTHOR_EMAIL = "paseo-essentials@localhost";
      commitEnv.GIT_COMMITTER_NAME = "Paseo Essentials";
      commitEnv.GIT_COMMITTER_EMAIL = "paseo-essentials@localhost";
      commitEnv.GIT_AUTHOR_DATE = timestamp;
      commitEnv.GIT_COMMITTER_DATE = timestamp;
      const commit = await new Promise<string>((resolveCommit, reject) => {
        const child = spawn("git", ["-C", gitRoot, ...commitArgs], {
          cwd: gitRoot,
          env: commitEnv,
          stdio: ["ignore", "pipe", "ignore"],
        });
        let output = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          output += chunk;
        });
        child.once("error", () => reject(new Error("Git snapshot commit failed.")));
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Snapshot deadline exceeded."));
        }, remaining());
        child.once("close", (code) => {
          clearTimeout(timeout);
          const value = output.trim();
          if (code === 0 && /^[0-9a-f]{40,64}$/.test(value)) resolveCommit(value);
          else reject(new Error("Git snapshot commit failed."));
        });
      });
      const ref = `${REF_PREFIX}${randomUUID()}`;
      await runGitDir(commonDir, ["update-ref", ref, commit], {
        maxOutputBytes: 2048,
        timeoutMs: remaining(),
      });
      createdRef = { commonDir, ref };
      return {
        cwd,
        gitRoot,
        commonDir,
        head,
        commit,
        ref,
        warnings: warningsUnique(warnings),
        oversizedUntracked,
      };
    } catch (error) {
      if (error instanceof Error && /size limit|deadline|timed out/i.test(error.message))
        console.warn("[paseo-ux] Turn diff snapshot stopped at a configured safety limit.");
      if (createdRef) await this.deleteRef(createdRef.commonDir, createdRef.ref);
      return null;
    } finally {
      if (temporary)
        await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async start(event: AgentTurn): Promise<void> {
    await this.ensureReady();
    await this.enqueue(async () => {
      const turnId = event.turnId || randomUUID();
      if (this.journal.turns.some((turn) => turn.agentId === event.agent.id && turn.id === turnId))
        return;
      const key = `${event.agent.id}\0${turnId}`;
      if (this.journal.pending.some((turn) => `${turn.agentId}\0${turn.id}` === key)) return;
      const snapshot = await this.snapshot(event.agent.cwd);
      if (!snapshot) return;
      const startedAt = new Date(this.now()).toISOString();
      const overlapping = this.journal.pending.filter(
        (pending) => pending.gitRoot === snapshot.gitRoot,
      );
      if (overlapping.length) {
        for (const pending of overlapping) {
          pending.uncertain = true;
          pending.warnings = warningsUnique([...pending.warnings, OWNER_WARNING]);
        }
      }
      const pending: PendingTurn = {
        id: turnId,
        providerTurnId: event.turnId || null,
        agentId: event.agent.id,
        startedAt,
        cwd: snapshot.cwd,
        realCwd: snapshot.cwd,
        gitRoot: snapshot.gitRoot,
        commonDir: snapshot.commonDir,
        startCommit: snapshot.commit,
        startHead: snapshot.head,
        ref: snapshot.ref,
        oversizedUntracked: snapshot.oversizedUntracked,
        warnings: warningsUnique([
          ...snapshot.warnings,
          ...(overlapping.length ? [OWNER_WARNING] : []),
        ]),
        uncertain: overlapping.length > 0,
      };
      this.journal.pending.push(pending);
      try {
        await this.persist();
      } catch {
        this.journal.pending = this.journal.pending.filter((item) => item !== pending);
        await this.deleteRef(pending.commonDir, pending.ref);
      }
    });
  }

  async end(event: TurnEnded): Promise<TurnCard | null> {
    await this.ensureReady();
    return this.enqueue(async () => {
      const turnId = event.turnId || null;
      let index = this.journal.pending.findIndex(
        (pending) => pending.agentId === event.agent.id && pending.id === turnId,
      );
      // Some public lifecycle events have no provider turn ID. Pair those with
      // the latest start for this agent, retaining our opaque ID across reloads.
      if (index < 0) {
        for (let candidate = this.journal.pending.length - 1; candidate >= 0; candidate--) {
          const pending = this.journal.pending[candidate]!;
          if (pending.agentId === event.agent.id && (!turnId || pending.providerTurnId === null)) {
            index = candidate;
            break;
          }
        }
      }
      if (index < 0) return null;
      const pending = this.journal.pending[index]!;
      const endSnapshot = await this.snapshot(event.agent.cwd);
      this.journal.pending.splice(index, 1);
      if (
        !endSnapshot ||
        endSnapshot.gitRoot !== pending.gitRoot ||
        endSnapshot.commonDir !== pending.commonDir
      ) {
        await this.deleteRef(pending.commonDir, pending.ref);
        if (endSnapshot) await this.deleteRef(endSnapshot.commonDir, endSnapshot.ref);
        await this.persist().catch(() => undefined);
        return null;
      }
      const warnings = warningsUnique([
        ...pending.warnings,
        ...endSnapshot.warnings,
        ...(pending.uncertain ? [OWNER_WARNING] : []),
        ...(endSnapshot.cwd !== pending.realCwd
          ? [
              "The agent working directory changed during the turn; the ending repository snapshot was used.",
            ]
          : []),
      ]);
      try {
        const [statusResult, numstatResult, beforeTreeResult, afterTreeResult] = await Promise.all([
          runGit(pending.gitRoot, [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--find-renames",
            "--name-status",
            "-z",
            pending.startCommit,
            endSnapshot.commit,
            "--",
          ]),
          runGit(pending.gitRoot, [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--find-renames",
            "--numstat",
            "-z",
            pending.startCommit,
            endSnapshot.commit,
            "--",
          ]),
          runGit(
            pending.gitRoot,
            ["ls-tree", "-r", "-z", "-l", "--full-tree", pending.startCommit],
            { maxOutputBytes: 32 * 1024 * 1024 },
          ),
          runGit(
            pending.gitRoot,
            ["ls-tree", "-r", "-z", "-l", "--full-tree", endSnapshot.commit],
            { maxOutputBytes: 32 * 1024 * 1024 },
          ),
        ]);
        if (
          statusResult.truncated ||
          numstatResult.truncated ||
          beforeTreeResult.truncated ||
          afterTreeResult.truncated
        )
          throw new Error("Git change listing was too large.");
        const paths = parseChangedPaths(statusResult.stdout);
        const stats = parseNumstat(numstatResult.stdout);
        const beforeTree = parseTreeEntries(beforeTreeResult.stdout);
        const afterTree = parseTreeEntries(afterTreeResult.stdout);
        const fileSnapshots: StoredFile[] = [];
        for (const changed of paths) {
          const beforePath = changed.oldPath ?? changed.path;
          const before = beforeTree.get(beforePath);
          const after = afterTree.get(changed.path);
          const stat = stats.get(
            changed.oldPath ? `${changed.oldPath}\0${changed.path}` : changed.path,
          ) ?? {
            added: 0,
            removed: 0,
            binary: false,
          };
          const binary = stat.binary || isImagePath(changed.path);
          const file = turnFileSchema.parse({
            path: changed.path,
            ...(changed.oldPath ? { oldPath: changed.oldPath } : {}),
            status: changed.status,
            added: binary ? 0 : stat.added,
            removed: binary ? 0 : stat.removed,
            binary,
            diffAvailable: Boolean(
              (before && before.type === "blob") || (after && after.type === "blob"),
            ),
          });
          fileSnapshots.push({
            file,
            beforeOid: before?.type === "blob" ? before.oid : null,
            afterOid: after?.type === "blob" ? after.oid : null,
          });
        }
        const changedTreePaths = new Set(fileSnapshots.map((stored) => stored.file.path));
        const startLarge = new Map(pending.oversizedUntracked.map((file) => [file.path, file]));
        const endLarge = new Map(endSnapshot.oversizedUntracked.map((file) => [file.path, file]));
        for (const path of new Set([...startLarge.keys(), ...endLarge.keys()])) {
          if (changedTreePaths.has(path)) continue;
          const before = startLarge.get(path);
          const after = endLarge.get(path);
          if (
            before &&
            after &&
            before.size === after.size &&
            before.mtimeMs === after.mtimeMs &&
            before.mode === after.mode
          )
            continue;
          const file = turnFileSchema.parse({
            path,
            status: before ? (after ? "modified" : "deleted") : "added",
            added: 0,
            removed: 0,
            binary: isImagePath(path),
            diffAvailable: false,
          });
          fileSnapshots.push({ file, beforeOid: null, afterOid: null });
        }
        if (paths.length > 0 && fileSnapshots.length === 0)
          warnings.push("Some changed paths could not be represented safely.");
        const commitsResult = await this.readCommits(
          pending.gitRoot,
          pending.startHead,
          endSnapshot.head,
        );
        if (fileSnapshots.length === 0 && commitsResult.total === 0) {
          await this.deleteRef(pending.commonDir, pending.ref);
          await this.deleteRef(endSnapshot.commonDir, endSnapshot.ref);
          await this.persist();
          return null;
        }
        if (commitsResult.truncated)
          warnings.push("The commit list was truncated after 100 entries.");
        if (commitsResult.total > commitsResult.commits.length && !commitsResult.truncated)
          warnings.push("The commit list was truncated after 100 entries.");
        const endedAt = new Date(this.now()).toISOString();
        let summary = turnSummarySchema.parse({
          id: pending.id,
          agentId: event.agent.id,
          startedAt: pending.startedAt,
          endedAt,
          outcome: event.outcome.kind,
          files: fileSnapshots.map((item) => item.file),
          totalFiles: fileSnapshots.length,
          commits: commitsResult.commits,
          warnings: warningsUnique(warnings),
        });
        const preview = makeTurnCard(summary, commitsResult.total);
        if (preview.previewDropped)
          summary = turnSummarySchema.parse({ ...summary, warnings: preview.card.warnings });
        const stored: StoredTurn = {
          ...summary,
          gitRoot: pending.gitRoot,
          commonDir: pending.commonDir,
          startCommit: pending.startCommit,
          endCommit: endSnapshot.commit,
          refs: [pending.ref, endSnapshot.ref],
          fileSnapshots,
        };
        this.journal.turns.push(stored);
        await this.pruneTurns();
        await this.persist();
        return preview.card;
      } catch {
        await this.deleteRef(pending.commonDir, pending.ref);
        await this.deleteRef(endSnapshot.commonDir, endSnapshot.ref);
        await this.persist().catch(() => undefined);
        return null;
      }
    });
  }

  private async readCommits(
    gitRoot: string,
    startHead: string | null,
    endHead: string | null,
  ): Promise<{ commits: TurnCommit[]; total: number; truncated: boolean }> {
    if (!endHead || endHead === startHead) return { commits: [], total: 0, truncated: false };
    const revisions = startHead ? [endHead, "--not", startHead] : [endHead];
    const countResult = await runGit(gitRoot, ["rev-list", "--count", ...revisions], {
      maxOutputBytes: 128,
    });
    const total = Number.parseInt(countResult.stdout.toString("utf8").trim(), 10) || 0;
    const list = await runGit(
      gitRoot,
      [
        "rev-list",
        "--topo-order",
        "--reverse",
        `--max-count=${COMMIT_LIST_LIMIT + 1}`,
        ...revisions,
      ],
      { maxOutputBytes: 16 * 1024 },
    );
    const ids = nulStrings(
      list.stdout.includes(0)
        ? list.stdout
        : Buffer.from(list.stdout.toString("utf8").split(/\r?\n/).filter(Boolean).join("\0")),
    );
    const limited = ids.slice(0, COMMIT_LIST_LIMIT);
    const commits: TurnCommit[] = [];
    for (const sha of limited) {
      const result = await runGit(gitRoot, ["show", "-s", "--format=%s", sha], {
        maxOutputBytes: 1024 * 1024,
      });
      if (result.truncated) throw new Error("Commit subject exceeded its storage limit.");
      const subject = result.stdout.toString("utf8").replace(/\r?\n$/, "");
      commits.push({ sha, subject });
    }
    return { commits, total, truncated: ids.length > COMMIT_LIST_LIMIT || list.truncated };
  }

  async clearPending(): Promise<void> {
    try {
      await this.ensureReady();
    } catch {
      return;
    }
    await this.enqueue(async () => {
      const pending = this.journal.pending;
      this.journal.pending = [];
      for (const turn of pending) await this.deleteRef(turn.commonDir, turn.ref);
      await this.persist().catch(() => undefined);
    });
  }

  async list(input: { agentId: string; cursor?: string; turnId?: string }): Promise<{
    turns: TurnSummary[];
    nextCursor: string | null;
  }> {
    await this.ensureReady();
    const records = this.journal.turns
      .filter(
        (turn) => turn.agentId === input.agentId && (!input.turnId || turn.id === input.turnId),
      )
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id));
    if (input.turnId) return { turns: records.slice(0, 1).map(summaryOf), nextCursor: null };
    let start = 0;
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      start = records.findIndex(
        (turn) =>
          turn.endedAt < cursor.endedAt || (turn.endedAt === cursor.endedAt && turn.id < cursor.id),
      );
      if (start < 0) return { turns: [], nextCursor: null };
    }
    const page = records.slice(start, start + PAGE_SIZE);
    const nextCursor =
      start + PAGE_SIZE < records.length && page.length > 0
        ? cursorFor(summaryOf(page[page.length - 1]!))
        : null;
    return { turns: page.map(summaryOf), nextCursor };
  }

  async read(input: { agentId: string; turnId: string; path: string }): Promise<{
    kind: "text" | "image" | "binary" | "unavailable";
    patch: string;
    truncated: boolean;
    beforeUri: string | null;
    afterUri: string | null;
    notice?: string;
  }> {
    await this.ensureReady();
    const turn = this.journal.turns.find(
      (item) => item.agentId === input.agentId && item.id === input.turnId,
    );
    const stored = turn?.fileSnapshots.find((item) => item.file.path === input.path);
    if (!turn || !stored) throw new Error("Turn file is unavailable.");
    if (!stored.file.diffAvailable) {
      return {
        kind: "unavailable",
        patch: "",
        truncated: false,
        beforeUri: null,
        afterUri: null,
        notice: "This file has no readable diff.",
      };
    }
    if (
      isImagePath(stored.file.path) ||
      isImagePath(stored.file.oldPath ?? "") ||
      stored.file.binary
    ) {
      const [before, after] = await Promise.all([
        stored.beforeOid
          ? this.readBlob(turn.commonDir, stored.beforeOid, MAX_IMAGE_BYTES + 1)
          : Promise.resolve(null),
        stored.afterOid
          ? this.readBlob(turn.commonDir, stored.afterOid, MAX_IMAGE_BYTES + 1)
          : Promise.resolve(null),
      ]);
      const beforeMime = before ? imageMime(stored.file.oldPath ?? stored.file.path, before) : null;
      const afterMime = after ? imageMime(stored.file.path, after) : null;
      if (beforeMime || afterMime) {
        const beforeUri =
          before && beforeMime && before.length <= MAX_IMAGE_BYTES
            ? `data:${beforeMime};base64,${before.toString("base64")}`
            : null;
        const afterUri =
          after && afterMime && after.length <= MAX_IMAGE_BYTES
            ? `data:${afterMime};base64,${after.toString("base64")}`
            : null;
        const oversized =
          (before?.length ?? 0) > MAX_IMAGE_BYTES || (after?.length ?? 0) > MAX_IMAGE_BYTES;
        return {
          kind: "image",
          patch: "",
          truncated: false,
          beforeUri,
          afterUri,
          ...(oversized ? { notice: "Image previews are limited to 3 MiB per version." } : {}),
          ...(!beforeUri && !afterUri && !oversized
            ? { notice: "Image data could not be read." }
            : {}),
        };
      }
    }
    const pathSpecs = [stored.file.path, ...(stored.file.oldPath ? [stored.file.oldPath] : [])].map(
      (path) => `:(literal)${path}`,
    );
    const diff = await runGit(
      turn.gitRoot,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--unified=3",
        turn.startCommit,
        turn.endCommit,
        "--",
        ...pathSpecs,
      ],
      { maxOutputBytes: MAX_DIFF_CHARS * 4 + 1024, timeoutMs: 30_000 },
    );
    const full = diff.stdout.toString("utf8");
    const truncated = diff.truncated || full.length > MAX_DIFF_CHARS;
    const patch = full.slice(0, MAX_DIFF_CHARS);
    return {
      kind: stored.file.binary ? "binary" : "text",
      patch,
      truncated,
      beforeUri: null,
      afterUri: null,
      ...(truncated ? { notice: "Diff text was truncated at 200,000 characters." } : {}),
    };
  }

  private async readBlob(commonDir: string, oid: string, maxBytes: number): Promise<Buffer | null> {
    try {
      const result = await runGitDir(commonDir, ["cat-file", "blob", oid], {
        maxOutputBytes: maxBytes,
        timeoutMs: 15_000,
      });
      return result.stdout;
    } catch {
      return null;
    }
  }
}
