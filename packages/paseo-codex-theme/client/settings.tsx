import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { type Appearance, appearanceSettings } from "../shared/appearance";
import type { AppearanceController } from "./controller";
import { createPresentationViews } from "./views";

export function createAppearanceSettings(controller: AppearanceController) {
  const { Tool, Reasoning } = createPresentationViews(controller);
  return function AppearanceSettings(props: PluginSurfaceProps) {
    const { theme, layout } = props;
    const state = useSettings(appearanceSettings);
    const current = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getSnapshot,
    );
    const text = { fontSize: 13, lineHeight: 21, color: theme.colors.foregroundMuted };
    const reload = () => {
      void Promise.all([state.reload(), controller.reload()]);
    };
    if (state.status !== "ready")
      return (
        <View style={{ padding: layout.compact ? 16 : 24, gap: 16 }}>
          <Text style={text}>{state.status === "loading" ? "正在读取会话外观…" : state.error}</Text>
          {state.status !== "loading" ? (
            <SettingsAction
              label="重新读取"
              actionLabel="重试"
              onPress={reload}
              disabled={state.saving}
            />
          ) : null}
          {state.status === "invalid" ? (
            <SettingsAction
              label="恢复默认外观"
              hint="已保存的外观设置无法读取；恢复后使用默认值。"
              actionLabel="恢复默认"
              disabled={state.saving}
              onPress={() => {
                void state.reset().then((saved) => {
                  if (saved) void controller.reload();
                });
              }}
            />
          ) : null}
          {state.saveError ? (
            <Text accessibilityRole="alert" style={text}>
              {state.saveError}
            </Text>
          ) : null}
        </View>
      );

    const save = (patch: Partial<Appearance>) => {
      void state.save({ ...state.values, ...patch }, state.revision).then((saved) => {
        if (saved) void controller.reload();
      });
    };
    const disabled = state.saving;
    const outputOnly = state.values.activityMode === "output-only";
    const activityDisabled = disabled || outputOnly;
    return (
      <View style={{ padding: layout.compact ? 16 : 24, gap: 24, maxWidth: 900, width: "100%" }}>
        {current.status !== "ready" ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={text}>
              {current.status === "unavailable"
                ? "当前客户端不支持会话呈现扩展，正在使用原生呈现。主题仍可单独使用。"
                : current.status === "loading"
                  ? "正在应用外观设置…"
                  : "外观设置暂不可用，正在使用原生呈现。"}
            </Text>
            {current.status === "error" ? (
              <SettingsAction label="重新应用外观" actionLabel="重试" onPress={reload} />
            ) : null}
          </View>
        ) : null}
        <SettingsSection
          title="会话阅读"
          info="调整现有会话的阅读方式。原生操作、输入框和侧栏保持原有位置。"
        >
          <SettingsSwitch
            label="启用会话排版"
            value={state.values.enabled}
            onValueChange={(enabled) => save({ enabled })}
            disabled={disabled}
          />
          <SettingsSwitch
            label="逐条工具记录"
            hint="默认保留原生工具分组。开启后逐条查看完整命令、输出和退出码；失败记录默认展开。"
            value={state.values.tools}
            onValueChange={(tools) => save({ tools })}
            disabled={activityDisabled}
          />
          <SettingsSwitch
            label="思考记录样式"
            hint="默认折叠，保留完整原文，可随时展开或复制。"
            value={state.values.reasoning}
            onValueChange={(reasoning) => save({ reasoning })}
            disabled={activityDisabled}
          />
          <SettingsSwitch
            label="正文排版"
            hint="只排版已完成且支持的消息。含图片、表格或文件链接的消息使用原生呈现；同类聊天皮肤建议只开启一个。"
            value={state.values.messages}
            onValueChange={(messages) => save({ messages })}
            disabled={disabled}
          />
        </SettingsSection>
        <SettingsSection title="阅读偏好">
          <SettingsSelect
            label="过程记录"
            hint="全部折叠时隐藏工具与思考记录及其标题，只保留正文输出。切回按类别设置即可查看原记录；权限提示和运行控制仍由 Paseo 显示。"
            value={state.values.activityMode}
            options={[
              { label: "按类别设置", value: "custom" },
              { label: "全部折叠（仅输出）", value: "output-only" },
            ]}
            onValueChange={(activityMode) => save({ activityMode })}
            disabled={disabled}
          />
          <SettingsSelect
            label="密度"
            value={state.values.density}
            options={[
              { label: "舒适", value: "comfortable" },
              { label: "紧凑", value: "compact" },
            ]}
            onValueChange={(density) => save({ density })}
            disabled={disabled}
          />
          <SettingsSelect
            label="正文字号"
            value={state.values.fontSize}
            options={[
              { label: "14", value: "14" },
              { label: "15", value: "15" },
              { label: "16", value: "16" },
            ]}
            onValueChange={(fontSize) => save({ fontSize })}
            disabled={disabled}
          />
          <SettingsSelect
            label="阅读宽度"
            value={state.values.readingWidth}
            options={[
              { label: "标准", value: "normal" },
              { label: "宽", value: "wide" },
            ]}
            onValueChange={(readingWidth) => save({ readingWidth })}
            disabled={disabled}
          />
          <SettingsSelect
            label="工具默认展开"
            value={state.values.expandTools}
            options={[
              { label: "仅失败记录", value: "failed" },
              { label: "全部", value: "all" },
              { label: "仅保留标题", value: "none" },
            ]}
            onValueChange={(expandTools) => save({ expandTools })}
            disabled={activityDisabled}
          />
          <SettingsSwitch
            label="思考记录默认展开"
            value={state.values.expandReasoning}
            onValueChange={(expandReasoning) => save({ expandReasoning })}
            disabled={activityDisabled}
          />
          <SettingsSwitch
            label="代码自动换行"
            value={state.values.wrapCode}
            onValueChange={(wrapCode) => save({ wrapCode })}
            disabled={disabled}
          />
        </SettingsSection>
        {state.saveError ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={text}>
              {state.saveError}
            </Text>
            <SettingsAction
              label="重新读取已保存的设置"
              actionLabel="重新读取"
              onPress={reload}
              disabled={disabled}
            />
          </View>
        ) : null}
        <View style={{ gap: 10 }}>
          <Text style={{ ...text, fontWeight: "600", color: theme.colors.foreground }}>
            样式预览
          </Text>
          <Text style={text}>以下为合成示例，不会运行命令。</Text>
          {outputOnly ? (
            <Text style={text}>工具与思考已全部折叠，正文输出继续显示。</Text>
          ) : (
            <>
              <Tool
                {...props}
                agentId="appearance-preview"
                timestamp={new Date(0)}
                item={{
                  type: "plugin",
                  kind: "readable-tool",
                  version: 1,
                  data: {
                    callId: "preview-tool",
                    name: "shell",
                    command: "npm run typecheck",
                    status: "completed",
                    exitCode: 0,
                    output: "Typecheck passed.",
                    phase: "complete",
                  },
                }}
              />
              <Reasoning
                {...props}
                agentId="appearance-preview"
                timestamp={new Date(0)}
                item={{
                  type: "plugin",
                  kind: "readable-reasoning",
                  version: 1,
                  data: { text: "先检查已有实现，再验证本次改动。", phase: "complete" },
                }}
              />
            </>
          )}
        </View>
        <SettingsSection
          title="主题与兼容性"
          info="在设置 → 外观中选择 Codex Light 或 Codex Dark，也可以继续使用当前主题。"
        >
          <Text style={text}>
            同类消息使用一个呈现插件。若其他插件负责工具或思考，请先切回“按类别设置”，再关闭对应开关；正文可单独关闭。关闭总开关后恢复原生呈现；配色可以单独使用。
          </Text>
        </SettingsSection>
      </View>
    );
  };
}
