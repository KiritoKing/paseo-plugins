import { PluginClientStateProvider, PluginRpcProvider } from "@getpaseo/plugin/client/host";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DisplaySettings } from "../../client/settings";
import contribute from "../../index.client";
import { readDisplay } from "./sdk";

const day = {
  surface0: "#ffffff",
  surface1: "#f6f8fa",
  surface2: "#eaeef2",
  foreground: "#1f2328",
  foregroundMuted: "#59636e",
  accent: "#0969da",
  accentForeground: "#ffffff",
  border: "#d1d9e0",
  statusDanger: "#cf222e",
  statusWarning: "#9a6700",
  statusSuccess: "#1a7f37",
};
const night = {
  surface0: "#0d1117",
  surface1: "#161b22",
  surface2: "#21262d",
  foreground: "#e6edf3",
  foregroundMuted: "#9198a1",
  accent: "#6cb6ff",
  accentForeground: "#0d1117",
  border: "#30363d",
  statusDanger: "#ff7b72",
  statusWarning: "#d29922",
  statusSuccess: "#3fb950",
};
const repo = (id, name, ready = true) => ({
  id,
  name,
  path: `/fixture/${id}`,
  branch: "feature/demo",
  head: "12345678",
  baseSha: "12345678",
  ready,
  error: null,
});
const repos = [repo("web", "前端"), repo("api", "服务端"), repo("pending", "未物化仓", false)];
const workspace = { id: "fixture", directory: "/fixture/aiw", workspaceDirectory: "/fixture/aiw" };
const source = { subscribe: () => () => {}, getWorkspace: () => workspace, getAgent: () => null };
const changes = {
  groups: [
    {
      repo: repos[0],
      baseline: "12345678",
      head: "87654321",
      snapshotId: "snapshot",
      files: [
        {
          repoId: "web",
          path: "src/main.ts",
          status: "M",
          origin: "combined",
          additions: 1,
          deletions: 1,
          binary: false,
        },
      ],
      error: null,
    },
  ],
  readAt: "fixture",
};
const trace = [];
async function invoke(method, input) {
  trace.push({ method, input });
  document.querySelector("#trace").textContent = JSON.stringify(trace, null, 2);
  if (method === "aiw.catalog")
    return {
      root: "/fixture/aiw",
      projectKey: "fixture",
      branch: "feature/demo",
      readAt: "fixture",
      aiwVersion: "fixture",
      repos,
    };
  if (method === "aiw.changes") return changes;
  if (method === "aiw.tree")
    return {
      entries: input.path
        ? [{ name: "main.ts", path: "src/main.ts", directory: false, symlink: false }]
        : [{ name: "src", path: "src", directory: true, symlink: false }],
      truncated: false,
    };
  if (method === "aiw.file")
    return {
      path: input.path,
      content: 'export const needle = "found";\n',
      startLine: input.startLine,
      totalLines: 80,
      binary: false,
      truncated: false,
      head: "12345678",
      contentHash: "fixture",
    };
  if (method === "aiw.patch")
    return {
      patch: "@@ -1 +1 @@\n-old\n+new",
      binary: false,
      truncated: false,
      before: "old",
      after: "new",
    };
  if (method === "aiw.search") {
    if (input.query === "error") throw new Error("搜索执行失败：无效的正则表达式");
    if (input.query === "empty")
      return { hits: [], errors: [], truncated: false, readAt: "fixture" };
    return {
      hits: input.repoIds.map((repoId) => ({
        repoId,
        path: "src/main.ts",
        line: 42,
        text: `export const ${input.query} = "found";`,
      })),
      errors: input.query === "partial" ? [{ repoId: "api", error: "仓库不可读取" }] : [],
      truncated: input.query === "partial",
      readAt: "fixture",
    };
  }
  throw new Error(`Unexpected RPC ${method}`);
}
let registeredPanel, searchCommand, dispose;
let notify = () => {};
let headers = [];
const noOp = () => {};
const client = {
  rpc: async (contract, input) =>
    contract.name.includes("settings")
      ? { status: "ready", revision: "0", values: readDisplay() }
      : input.workspaceIds
        ? input.workspaceIds.map((workspaceId) => ({
            workspaceId,
            configured: true,
            directory: workspace.workspaceDirectory,
          }))
        : invoke(contract.name, input),
  paseo: {
    workspaces: {
      list: async () => ({
        entries: [workspace],
        pageInfo: { hasMore: false },
        subscription: {
          release: async () => {},
          subscribe: (callbacks) => {
            queueMicrotask(() =>
              callbacks.snapshot({ entries: [workspace], pageInfo: { hasMore: false } }),
            );
            return noOp;
          },
        },
      }),
    },
  },
  addSettingsScreen: () => noOp,
  addWorkspacePanel: (panel) => {
    registeredPanel = panel;
    notify();
    return () => {
      registeredPanel = null;
      notify();
    };
  },
  addCommandCenterItem: (item) => {
    if (item.id === "aiw-search") searchCommand = item;
    return noOp;
  },
  addSlashCommand: () => noOp,
  addHeaderButton: (button) => {
    headers.push(button);
    notify();
    return {
      remove: () => {
        headers = headers.filter((item) => item !== button);
        notify();
      },
      update: noOp,
    };
  },
  openPanel: (id) => {
    trace.push({ opened: id });
    notify();
  },
};
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const [, render] = useState(0),
    [dark, setDark] = useState(false),
    [width, setWidth] = useState(1100),
    [settings, setSettings] = useState(false);
  notify = () => render((n) => n + 1);
  useEffect(() => {
    dispose = contribute(client);
    return () => dispose();
  }, []);
  const props = {
    theme: { colors: dark ? night : day },
    layout: { compact: width < 720, platform: "web" },
    workspaceId: "fixture",
    context: "workspace",
    host: { id: "fixture", label: "Fixture" },
  };
  const Panel = registeredPanel?.Component;
  return (
    <>
      <div style={{ padding: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setDark(!dark)}>
          切换主题
        </button>
        <button type="button" onClick={() => setWidth(width === 1100 ? 340 : 1100)}>
          切换宽度
        </button>
        <button type="button" onClick={() => setSettings(!settings)}>
          面板名称设置
        </button>
        <button
          type="button"
          onClick={() => {
            dispose();
            dispose = contribute(client);
          }}
        >
          重载插件
        </button>
        <button
          type="button"
          onClick={() => searchCommand?.onSelect({ workspace, openPanel: client.openPanel })}
        >
          搜索命令
        </button>
        <span id="registration">
          {registeredPanel?.title} · {registeredPanel ? 1 : 0} 个面板 · {headers.length} 个入口
        </span>
      </div>
      <div
        style={{
          width,
          maxWidth: "100%",
          height: 760,
          display: "flex",
          flexDirection: "column",
          background: props.theme.colors.surface0,
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PluginClientStateProvider source={source}>
            <PluginRpcProvider invoke={invoke}>
              {settings ? <DisplaySettings {...props} /> : Panel ? <Panel {...props} /> : null}
            </PluginRpcProvider>
          </PluginClientStateProvider>
        </QueryClientProvider>
      </div>
    </>
  );
}
createRoot(document.querySelector("#root")).render(<Fixture />);

import { runChecks } from "./checks";

window.runAiwChecks = runChecks;
