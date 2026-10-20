// This test-only host supplies the real SDK contexts a standalone screen may use.
// Deliberately omit PluginClientStateProvider, which only workspace panels receive.
import { PaseoApiProvider, PluginRpcProvider } from "@getpaseo/plugin/client/host";
import { Component, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeSessionControls } from "../../client/session-controls";
import { createSessionDialogs } from "../../client/session-dialogs";
import { makeSessionOpener } from "../../client/session-opener";

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <pre role="alert">Plugin failed: {this.state.error}</pre>
    ) : (
      this.props.children
    );
  }
}
const colors = {
  surface0: "#fff",
  surface1: "#f7f7f8",
  surface2: "#ececef",
  border: "#d9d9de",
  foreground: "#25252a",
  foregroundMuted: "#73737f",
  accent: "#5957da",
  statusDanger: "#cc4444",
};
const record = (id, title, archivedAt) => ({
  id,
  title,
  workspaceId: "fixture-workspace",
  provider: "codex",
  status: archivedAt ? "closed" : "idle",
  archivedAt,
  canRestore: true,
  createdAt: "2026-10-12T01:00:00Z",
  updatedAt: "2026-10-12T02:00:00Z",
});
const dialogs = createSessionDialogs();
const Opener = makeSessionOpener(dialogs);
function Fixture() {
  const [trace, setTrace] = useState([]),
    [handoff, setHandoff] = useState(null),
    [draft, setDraft] = useState("未发送的草稿");
  const invoke = useCallback(async (method, input) => {
    setTrace((previous) => [...previous, { method, input }]);
    if (method === "sessions.list")
      return {
        workspaceName: "恢复页面测试工作区",
        sessions: [
          record("closed", "之前关闭的会话", "2026-10-12T02:00:00Z"),
          record("active", "正在使用的会话", null),
        ],
      };
    if (method === "sessions.restore")
      return {
        agentId: input.agentId ?? "closed",
        workspaceId: "fixture-workspace",
        restored: input.agentId !== "active",
      };
    throw new Error("Unexpected RPC");
  }, []);
  const [Controls] = useState(() =>
    makeSessionControls(dialogs, (agentId) => setHandoff({ agentId })),
  );
  const navigation = {
    openAgent: ({ agentId }) => {
      setTrace((previous) => [...previous, { opened: agentId }]);
      setHandoff(null);
    },
    openWorkspace: ({ workspaceId }) => {
      setTrace((previous) => [...previous, { workspace: workspaceId }]);
      setHandoff(null);
    },
  };
  return (
    <>
      <h1>原工作区</h1>
      <input
        aria-label="工作区草稿"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" onClick={() => dialogs.open("fixture-workspace")}>
        打开会话选择
      </button>
      <button type="button" onClick={() => dialogs.open("fixture-workspace", true)}>
        恢复最近关闭
      </button>
      <button type="button" onClick={() => setHandoff({ workspaceId: "fixture-workspace" })}>
        迁移旧全页入口
      </button>
      <Boundary>
        <PaseoApiProvider paseo={{}}>
          <PluginRpcProvider invoke={invoke}>
            <Controls
              host={{ id: "fixture-host", label: "test" }}
              layout={{ compact: false, platform: "web" }}
              context="workspace"
              workspaceId="fixture-workspace"
              size={16}
              color="#666"
              theme={{ colors }}
            />
            {handoff ? (
              <Opener
                params={handoff}
                host={{ id: "fixture-host", label: "test" }}
                theme={{ colors }}
                navigation={navigation}
              />
            ) : null}
          </PluginRpcProvider>
        </PaseoApiProvider>
      </Boundary>
      <pre data-testid="screen-trace">{JSON.stringify(trace)}</pre>
    </>
  );
}
createRoot(document.querySelector("#root")).render(<Fixture />);
