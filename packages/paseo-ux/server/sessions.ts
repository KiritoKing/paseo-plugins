import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type listSessions,
  orderedClosed,
  type restoreSession,
  type WorkspaceSession,
} from "../shared/sessions";

const execute = promisify(execFile);

export async function loadSessions(
  { workspaceId }: RpcInput<typeof listSessions>,
  { paseo }: PluginHandlerContext,
) {
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  if (!workspace) throw new Error("当前工作区不可用。");
  const sessions: WorkspaceSession[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter: { includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of page.entries) {
      if (agent.workspaceId !== workspaceId) continue;
      sessions.push({
        id: agent.id,
        workspaceId,
        title: agent.title || "未命名会话",
        provider: agent.provider,
        status: agent.status,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        archivedAt: agent.archivedAt ?? null,
        canRestore: !!agent.persistence && !agent.providerUnavailable,
      });
    }
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return { workspaceName: workspace.name, sessions };
}

export function cliCommand(env: NodeJS.ProcessEnv = process.env) {
  // The executable and --home are public CLI interfaces. Do not resolve a
  // package's private dist layout or inherit a remote PASEO_HOST selector.
  return {
    binary: env.PASEO_ESSENTIALS_CLI?.trim() || "paseo",
    home: env.PASEO_HOME || join(homedir(), ".paseo"),
  };
}

export function createSessionRestorer(
  reload: (id: string, cwd?: string) => Promise<unknown> = reloadOriginalSession,
) {
  const inFlight = new Map<
    string,
    Promise<{ agentId: string; workspaceId: string; restored: boolean }>
  >();
  return async (input: RpcInput<typeof restoreSession>, context: PluginHandlerContext) => {
    const { sessions } = await loadSessions(input, context);
    const selected = input.agentId
      ? sessions.find((session) => session.id === input.agentId)
      : orderedClosed(sessions)[0];
    if (!selected)
      throw new Error(
        input.agentId ? "会话不属于当前工作区或已不存在。" : "当前工作区没有可恢复的已关闭会话。",
      );
    const key = `${input.workspaceId}:${selected.id}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const operation = (async () => {
      if (!selected.archivedAt && selected.status !== "closed")
        return { agentId: selected.id, workspaceId: input.workspaceId, restored: false };
      if (!selected.canRestore) throw new Error("该会话缺少持久化记录，或对应 provider 不可用。");
      const before = await context.paseo.agents.ref(selected.id).refresh();
      if (before && !before.agent.archivedAt && before.agent.status !== "closed")
        return { agentId: selected.id, workspaceId: input.workspaceId, restored: false };
      const result: unknown = await reload(selected.id, before?.agent.cwd);
      if (
        !result ||
        typeof result !== "object" ||
        !("agentId" in result) ||
        result.agentId !== selected.id
      )
        throw new Error("恢复命令没有返回预期的会话 ID。");
      const after = await context.paseo.agents.ref(selected.id).refresh();
      if (!after || after.agent.archivedAt || after.agent.status === "closed")
        throw new Error("恢复后会话状态尚未确认，请刷新列表检查。");
      return { agentId: selected.id, workspaceId: input.workspaceId, restored: true };
    })();
    inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      if (inFlight.get(key) === operation) inFlight.delete(key);
    }
  };
}
export const reopenSession = createSessionRestorer();

async function runPublicCli(args: string[]) {
  const cli = cliCommand();
  try {
    const { stdout } = await execute(cli.binary, ["--home", cli.home, ...args], {
      timeout: 45_000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, PASEO_HOST: "" },
    });
    return stdout;
  } catch {
    throw new Error(
      "The official Paseo CLI could not complete this action. Ensure paseo is on this host’s PATH and PASEO_HOME selects this daemon. A standalone executable can be set with PASEO_ESSENTIALS_CLI.",
    );
  }
}
async function reloadOriginalSession(id: string, cwd?: string): Promise<unknown> {
  // Inspect first: a misconfigured CLI must fail before restarting any process.
  const inspected: unknown = JSON.parse(await runPublicCli(["agent", "inspect", id, "--json"]));
  if (
    !inspected ||
    typeof inspected !== "object" ||
    !("Id" in inspected) ||
    inspected.Id !== id ||
    (cwd && (!("Cwd" in inspected) || inspected.Cwd !== cwd))
  )
    throw new Error(
      "The CLI selected a different host or conversation. Check PASEO_HOME before retrying.",
    );
  return JSON.parse(await runPublicCli(["agent", "reload", id, "--json"]));
}
