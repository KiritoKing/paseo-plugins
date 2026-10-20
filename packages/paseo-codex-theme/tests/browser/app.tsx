import type {
  PluginClientContext,
  PluginTheme,
  PluginTimelineTransformerContribution,
} from "@getpaseo/plugin/client";
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import { createAppearanceController } from "../../client/controller";
import { createAppearanceSettings } from "../../client/settings";
import { createPresentationViews } from "../../client/views";
import { projectMessage } from "../../shared/message-presentation";
import { projectReasoning, projectTool } from "../../shared/tool-presentation";
import { fixture } from "./host";

const registrations = new Map<string, PluginTimelineTransformerContribution>();
const controller = createAppearanceController({
  rpc: async () => ({ status: "ready", values: fixture.values, revision: "fixture" }),
  addTimelineRenderer() {},
  addTimelineTransformer(definition: PluginTimelineTransformerContribution) {
    registrations.set(definition.id, definition);
    return () => {
      registrations.delete(definition.id);
    };
  },
  paseo: {
    observeEvents() {
      return { subscribe: fixture.observe, release: async () => {} };
    },
  },
} as unknown as PluginClientContext);
const { Tool, Reasoning, Message } = createPresentationViews(controller);
const Settings = createAppearanceSettings(controller);
controller.start();
const sourceText =
  "# 已完成连接状态的排版调整\n\n保留**原有工作流**，把阅读层次和操作反馈放在消息内部。输入与权限操作继续由 Paseo 提供。\n\n## 变更与验证\n\n1. 工具命令、输出和退出码可按需展开。\n2. 思考记录保留原文，支持完整复制。\n3. 未支持的消息交回原生呈现。\n\n```ts\nconst connection = await reconnect({ retries: 3, timeout: 5000 });\nconsole.log(connection.status);\n```\n\n> 本页使用合成数据，未连接真实会话。\n\n可阅读 [Paseo 插件文档](https://paseo.sh/docs/plugins/reference)。";
function App() {
  const [dark, setDark] = useState(false);
  const [settings, showSettings] = useState(false);
  const [phase, setPhase] = useState<"streaming" | "complete">("complete");
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState(0);
  const [copyFailure, setCopyFailure] = useState(false);
  const [settingsFailure, setSettingsFailure] = useState(false);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const theme: PluginTheme = {
    appearance: dark ? "dark" : "light",
    colors: {
      surface0: dark ? "#181818" : "#ffffff",
      surface1: dark ? "#222222" : "#fafafa",
      surface2: dark ? "#2b2b2b" : "#f3f3f3",
      border: dark ? "#3a3a3a" : "#e4e4e4",
      foreground: dark ? "#ededed" : "#181818",
      foregroundMuted: dark ? "#a3a3a3" : "#6b6b6b",
      accent: dark ? "#ededed" : "#181818",
      accentForeground: dark ? "#181818" : "#ffffff",
      statusSuccess: dark ? "#82c99a" : "#247744",
      statusWarning: dark ? "#e6bf77" : "#916417",
      statusDanger: dark ? "#ed9696" : "#b73737",
    },
  };
  const props = {
    theme,
    host: { id: "fixture", label: "合成示例" },
    layout: { compact: frame > 0 || innerWidth < 640, platform: "web" as const },
  };
  const toolSource = {
    type: "tool_call",
    callId: "fixture-shell",
    name: "shell",
    detail: {
      type: "shell",
      command: "npm run test:reconnect -- --runInBand",
      cwd: "/example/project",
      output:
        phase === "streaming"
          ? "Running reconnect.test.ts…\n✓ retries bounded\n"
          : failed
            ? "FAIL reconnect.test.ts\nExpected online, received connecting.\nPlease inspect the connection lifecycle."
            : "PASS reconnect.test.ts\n✓ retries bounded\n✓ subscription released\n✓ native ownership preserved\n\nTests: 9 passed",
      ...(phase === "complete" ? { exitCode: failed ? 1 : 0 } : {}),
    },
    status: phase === "streaming" ? "running" : failed ? "failed" : "completed",
    error:
      phase === "complete" && failed
        ? { message: "Reconnect assertion failed", expected: "online", actual: "connecting" }
        : null,
  };
  const tool = projectTool(toolSource, phase);
  const reasoningSource = {
    type: "reasoning",
    text: "先检查已有连接逻辑与订阅的生命周期，再调整呈现层。验证工具失败时的可见性，确保原生操作与其他插件仍能使用。",
  };
  const reasoning = projectReasoning(reasoningSource, phase)!;
  const hidden = (id: string, source: unknown) => {
    const transform = registrations.get(id)?.transform as
      | ((input: {
          item: unknown;
          phase: "streaming" | "complete";
        }) => { items: unknown[] } | undefined)
      | undefined;
    return transform?.({ item: source, phase })?.items.length === 0;
  };
  const message = projectMessage({ type: "assistant_message", text: sourceText }, "complete")!;
  const common = { ...props, agentId: "synthetic-agent", timestamp: new Date(0) };
  const native = (text: string) => (
    <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, opacity: 0.65 }}>
      原生呈现占位（合成验收）\n{text}
    </pre>
  );
  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.colors.surface0,
        color: theme.colors.foreground,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          padding: 12,
          borderBottom: `1px solid ${theme.colors.border}`,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          fontSize: 12,
        }}
      >
        <button type="button" onClick={() => setDark(!dark)}>
          {dark ? "浅色" : "深色"}
        </button>
        <button type="button" onClick={() => showSettings(!settings)}>
          {settings ? "返回会话示例" : "外观设置"}
        </button>
        <button type="button" onClick={() => setFrame(frame ? 0 : 390)}>
          {frame ? "宽屏" : "390px"}
        </button>
        <button
          type="button"
          onClick={() => setPhase(phase === "complete" ? "streaming" : "complete")}
        >
          {phase === "complete" ? "模拟流式状态" : "模拟完成"}
        </button>
        <button type="button" onClick={() => setFailed(!failed)}>
          {failed ? "恢复成功示例" : "模拟失败"}
        </button>
        <button
          type="button"
          onClick={() => {
            fixture.copyFailure = !copyFailure;
            setCopyFailure(!copyFailure);
          }}
        >
          复制失败：{copyFailure ? "开" : "关"}
        </button>
        <button
          type="button"
          onClick={() => {
            fixture.settingsFailure = !settingsFailure;
            setSettingsFailure(!settingsFailure);
          }}
        >
          保存失败：{settingsFailure ? "开" : "关"}
        </button>
        <span>合成数据 · 真实组件 · {snapshot.status}</span>
      </div>
      <main
        style={{
          width: frame || "100%",
          maxWidth: settings ? 900 : 860,
          margin: "0 auto",
          padding: settings ? 0 : "30px 16px",
          boxSizing: "border-box",
        }}
      >
        {settings ? (
          <Settings {...props} />
        ) : (
          <View style={{ gap: 16 }}>
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
              既有会话 / 连接状态排版 · 合成验收样本
            </Text>
            <View
              style={{
                alignSelf: "flex-end",
                backgroundColor: theme.colors.surface2,
                padding: 12,
                borderRadius: 12,
                maxWidth: "88%",
              }}
            >
              <Text
                selectable
                style={{ fontSize: 15, lineHeight: 24, color: theme.colors.foreground }}
              >
                调整会话阅读体验，并验证错误状态与关闭增强后的表现。
              </Text>
            </View>
            {hidden("readable-reasoning", reasoningSource) ? null : registrations.has(
                "readable-reasoning",
              ) ? (
              <Reasoning
                {...common}
                item={{ type: "plugin", kind: "readable-reasoning", version: 1, data: reasoning }}
              />
            ) : (
              native(reasoning.text)
            )}
            {hidden("readable-tools", toolSource) ? null : tool &&
              registrations.has("readable-tools") ? (
              <Tool
                {...common}
                item={{ type: "plugin", kind: "readable-tool", version: 1, data: tool }}
              />
            ) : (
              native(toolSource.detail.command)
            )}
            {registrations.has("readable-messages") ? (
              <Message
                {...common}
                item={{ type: "plugin", kind: "readable-message", version: 1, data: message }}
              />
            ) : (
              <div style={{ fontSize: 15, lineHeight: 1.8 }}>
                <h2 style={{ fontSize: 21 }}>已完成连接状态的排版调整</h2>
                <p>
                  本例正文排版已关闭，此处为原生正文的合成占位。开启设置后显示真实 Markdown 组件。
                </p>
              </div>
            )}
          </View>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
