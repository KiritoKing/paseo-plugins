import type { PluginHostProps, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, useRevealedText } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, Text, type TextStyle, View } from "react-native";
import type { Appearance } from "../../shared/conversation/appearance";
import type {
  BlockNode,
  InlineNode,
  MessagePresentation,
} from "../../shared/conversation/message-presentation";
import type {
  ReasoningPresentation,
  ToolPresentation,
} from "../../shared/conversation/tool-presentation";
import type { AppearanceController } from "./controller";

type Theme = PluginHostProps["theme"];
const mono = Platform.OS === "ios" ? "Menlo" : "monospace";

// Completed Markdown is immutable. Content plus duplicate occurrence preserves
// sibling identity if an already-complete message is refreshed or amended.
function sourceEntries<T>(values: readonly T[]) {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const content = JSON.stringify(value);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { value, key: `${content}:${occurrence}` };
  });
}

function RevealedReasoningText({
  text,
  phase,
  style,
}: {
  text: string;
  phase: "streaming" | "complete";
  style: TextStyle;
}) {
  const revealed = useRevealedText(text, phase);
  return (
    <Text selectable style={style}>
      {revealed}
    </Text>
  );
}

function Action({
  theme,
  label,
  icon,
  onPress,
}: {
  theme: Theme;
  label: string;
  icon: string;
  onPress(): void;
}) {
  const [focused, focus] = useState(false);
  const [hovered, hover] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={() => focus(true)}
      onBlur={() => focus(false)}
      onHoverIn={() => hover(true)}
      onHoverOut={() => hover(false)}
      style={({ pressed }) => ({
        minWidth: 44,
        minHeight: 44,
        padding: 8,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: focused ? theme.colors.accent : "transparent",
        backgroundColor: pressed || hovered ? theme.colors.surface2 : "transparent",
      })}
    >
      <Icon name={icon} size={15} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

function Copy({ theme, text, label = "复制原文" }: { theme: Theme; text: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = async () => {
    let copied = false;
    try {
      await copyText(text);
      copied = true;
      if (alive.current) setStatus("copied");
    } catch {
      if (alive.current) setStatus("failed");
    }
    if (!alive.current) return;
    clearTimeout(timer.current);
    if (copied)
      timer.current = setTimeout(() => {
        if (alive.current) setStatus("idle");
      }, 2500);
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
      {status !== "idle" ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
        >
          {status === "copied" ? "已复制" : "复制失败，请重试"}
        </Text>
      ) : null}
      <Action
        theme={theme}
        label={status === "failed" ? `${label}，上次失败，重试` : label}
        icon={status === "copied" ? "Check" : "Copy"}
        onPress={() => {
          void copy();
        }}
      />
    </View>
  );
}

function Code({
  theme,
  text,
  language,
  prefs,
}: {
  theme: Theme;
  text: string;
  language?: string;
  prefs: Appearance;
}) {
  const content = (
    <Text
      selectable
      style={{
        color: theme.colors.foreground,
        fontFamily: mono,
        fontSize: Number(prefs.fontSize) - 2,
        lineHeight: Number(prefs.fontSize) * 1.6,
        padding: 12,
      }}
    >
      {text}
    </Text>
  );
  return (
    <View
      style={{
        minWidth: 0,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 9,
        overflow: "hidden",
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View
        style={{
          paddingLeft: 12,
          paddingRight: 4,
          minHeight: 36,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
          {language || "文本"}
        </Text>
        <Copy theme={theme} text={text} label="复制完整代码" />
      </View>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 360 }}>
        {prefs.wrapCode ? (
          content
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            {content}
          </ScrollView>
        )}
      </ScrollView>
    </View>
  );
}

function Disclosure({
  theme,
  expanded,
  label,
  children,
  onPress,
}: {
  theme: Theme;
  expanded: boolean;
  label: string;
  children: ReactNode;
  onPress(): void;
}) {
  const [focused, focus] = useState(false);
  const [hovered, hover] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onPress}
      onFocus={() => focus(true)}
      onBlur={() => focus(false)}
      onHoverIn={() => hover(true)}
      onHoverOut={() => hover(false)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 40,
        minWidth: 0,
        flex: 1,
        paddingHorizontal: 8,
        paddingVertical: 7,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: focused ? theme.colors.accent : "transparent",
        backgroundColor: pressed || hovered ? theme.colors.surface1 : "transparent",
      })}
    >
      <Icon
        name={expanded ? "ChevronDown" : "ChevronRight"}
        size={14}
        color={theme.colors.foregroundMuted}
      />
      {children}
    </Pressable>
  );
}

export function createPresentationViews(controller: AppearanceController) {
  function usePreferences() {
    return useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getSnapshot,
    ).values;
  }

  function Tool({ theme, layout, item }: PluginTimelineItemProps<ToolPresentation>) {
    const prefs = usePreferences();
    const data = item.data;
    const problem =
      data.status === "failed" || (typeof data.exitCode === "number" && data.exitCode !== 0);
    const [override, setExpanded] = useState<boolean | undefined>(undefined);
    const expanded =
      override ?? (prefs.expandTools === "all" || (prefs.expandTools === "failed" && problem));
    const status =
      data.status === "running"
        ? "运行中"
        : data.status === "canceled"
          ? "已取消"
          : data.status === "failed"
            ? "失败"
            : data.exitCode === 0
              ? "已完成"
              : typeof data.exitCode === "number"
                ? `已结束 · 退出码 ${data.exitCode}`
                : "已结束";
    const color = problem ? theme.colors.statusDanger : theme.colors.foregroundMuted;
    const fullText = [
      data.name,
      `调用 ID: ${data.callId}`,
      `状态: ${status}`,
      data.command,
      data.cwd === undefined ? "" : `工作目录: ${data.cwd}`,
      data.output === undefined ? "" : `输出:\n${data.output}`,
      data.error === undefined ? "" : `错误:\n${data.error}`,
      data.exitCode === undefined ? "" : `退出码: ${String(data.exitCode)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return (
      <View
        style={{
          minWidth: 0,
          width: "100%",
          maxWidth: prefs.readingWidth === "wide" ? 980 : 760,
          marginVertical: prefs.density === "compact" ? 2 : 5,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: problem ? theme.colors.statusDanger : theme.colors.border,
          backgroundColor: theme.colors.surface0,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", minWidth: 0, paddingRight: 3 }}>
          <Disclosure
            theme={theme}
            expanded={expanded}
            label={`${expanded ? "收起" : "展开"}工具记录，${data.name}，${status}`}
            onPress={() => setExpanded(!expanded)}
          >
            <Icon
              name={
                data.status === "running" ? "LoaderCircle" : problem ? "CircleAlert" : "Terminal"
              }
              size={15}
              color={color}
            />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  fontFamily: mono,
                  fontSize: Number(prefs.fontSize) - 2,
                  color: theme.colors.foreground,
                }}
              >
                {data.command || data.name}
              </Text>
              <Text accessibilityLiveRegion="polite" style={{ fontSize: 11, color }}>
                {status}
              </Text>
            </View>
          </Disclosure>
          <Copy theme={theme} text={fullText} label="复制完整工具记录" />
        </View>
        {expanded ? (
          <View style={{ padding: layout.compact ? 10 : 12, paddingTop: 2, gap: 10 }}>
            <Code theme={theme} text={data.command} language={data.name} prefs={prefs} />
            {data.cwd !== undefined ? (
              <Text selectable style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
                工作目录 · {data.cwd}
              </Text>
            ) : null}
            {data.output !== undefined ? (
              <Code theme={theme} text={data.output} language="输出" prefs={prefs} />
            ) : null}
            {data.error !== undefined ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.statusDanger }}>
                  错误
                </Text>
                <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }}>
                  <Text
                    selectable
                    style={{
                      fontSize: Number(prefs.fontSize) - 1,
                      lineHeight: 21,
                      color: theme.colors.foreground,
                    }}
                  >
                    {data.error}
                  </Text>
                </ScrollView>
              </View>
            ) : null}
            {data.exitCode !== undefined ? (
              <Text selectable style={{ fontSize: 12, color }}>
                退出码 · {String(data.exitCode)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  function Reasoning({ theme, item }: PluginTimelineItemProps<ReasoningPresentation>) {
    const prefs = usePreferences();
    const [override, setExpanded] = useState<boolean | undefined>(undefined);
    const expanded = override ?? prefs.expandReasoning;
    return (
      <View
        style={{
          minWidth: 0,
          width: "100%",
          maxWidth: prefs.readingWidth === "wide" ? 980 : 760,
          marginVertical: prefs.density === "compact" ? 2 : 5,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Disclosure
            theme={theme}
            expanded={expanded}
            label={`${expanded ? "收起" : "展开"}思考记录`}
            onPress={() => setExpanded(!expanded)}
          >
            <Icon name="Brain" size={15} color={theme.colors.foregroundMuted} />
            <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>
              {item.data.phase === "streaming" ? "思考中" : "思考记录"}
            </Text>
          </Disclosure>
          <Copy theme={theme} text={item.data.text} label="复制完整思考记录" />
        </View>
        {expanded ? (
          <View
            style={{
              borderLeftWidth: 2,
              borderLeftColor: theme.colors.border,
              marginLeft: 16,
              marginTop: 3,
              paddingLeft: 14,
              paddingVertical: prefs.density === "compact" ? 4 : 8,
            }}
          >
            <RevealedReasoningText
              text={item.data.text}
              phase={item.data.phase}
              style={{
                fontSize: Number(prefs.fontSize) - 1,
                lineHeight: Number(prefs.fontSize) * 1.65,
                color: theme.colors.foregroundMuted,
              }}
            />
          </View>
        ) : null}
      </View>
    );
  }

  function Link({ url, children, theme }: { url: string; children: ReactNode; theme: Theme }) {
    const [failed, setFailed] = useState(false);
    return (
      <Text
        accessibilityRole="link"
        accessibilityHint={url}
        onPress={() => {
          setFailed(false);
          void openExternalUrl(url).catch(() => setFailed(true));
        }}
        style={{ color: theme.colors.accent, textDecorationLine: "underline" }}
      >
        {children}
        {failed ? "（打开失败，点击重试）" : ""}
      </Text>
    );
  }

  function Inline({ nodes, theme }: { nodes: InlineNode[]; theme: Theme }) {
    return (
      <>
        {sourceEntries(nodes).map(({ value: node, key }) => {
          switch (node.type) {
            case "text":
              return node.text;
            case "code":
              return (
                <Text
                  key={key}
                  style={{ fontFamily: mono, backgroundColor: theme.colors.surface2, fontSize: 13 }}
                >
                  {node.text}
                </Text>
              );
            case "break":
              return "\n";
            case "link":
              return (
                <Link key={key} url={node.url} theme={theme}>
                  <Inline nodes={node.children} theme={theme} />
                </Link>
              );
            case "strong":
            case "em":
            case "del":
              return (
                <Text
                  key={key}
                  style={
                    node.type === "strong"
                      ? { fontWeight: "600" }
                      : node.type === "em"
                        ? { fontStyle: "italic" }
                        : { textDecorationLine: "line-through" }
                  }
                >
                  <Inline nodes={node.children} theme={theme} />
                </Text>
              );
          }
          return null;
        })}
      </>
    );
  }

  function Blocks({
    blocks,
    theme,
    prefs,
  }: {
    blocks: BlockNode[];
    theme: Theme;
    prefs: Appearance;
  }) {
    const body: TextStyle = {
      fontSize: Number(prefs.fontSize),
      lineHeight: Number(prefs.fontSize) * 1.75,
      color: theme.colors.foreground,
    };
    return (
      <View style={{ gap: prefs.density === "compact" ? 10 : 15, minWidth: 0 }}>
        {sourceEntries(blocks).map(({ value: block, key }) => {
          switch (block.type) {
            case "paragraph":
              return (
                <Text key={key} selectable style={body}>
                  <Inline nodes={block.children} theme={theme} />
                </Text>
              );
            case "heading":
              return (
                <Text
                  key={key}
                  selectable
                  accessibilityRole="header"
                  {...(Platform.OS === "web" ? { "aria-level": block.level } : {})}
                  style={{
                    ...body,
                    fontWeight: "600",
                    fontSize: block.level === 1 ? 25 : block.level === 2 ? 21 : 17,
                    lineHeight: block.level === 1 ? 34 : 29,
                    marginTop: prefs.density === "compact" ? 2 : 6,
                  }}
                >
                  <Inline nodes={block.children} theme={theme} />
                </Text>
              );
            case "code":
              return (
                <Code
                  key={key}
                  text={block.text}
                  language={block.language}
                  theme={theme}
                  prefs={prefs}
                />
              );
            case "blockquote":
              return (
                <View
                  key={key}
                  style={{
                    borderLeftWidth: 2,
                    borderLeftColor: theme.colors.border,
                    paddingLeft: 14,
                  }}
                >
                  <Blocks blocks={block.blocks} theme={theme} prefs={prefs} />
                </View>
              );
            case "list":
              return (
                <View key={key} style={{ gap: 8 }}>
                  {sourceEntries(block.items).map(({ value: blocks, key: itemKey }, itemIndex) => (
                    <View key={itemKey} style={{ flexDirection: "row", gap: 9, minWidth: 0 }}>
                      <Text style={{ ...body, minWidth: 18, textAlign: "right" }}>
                        {block.ordered ? `${(block.start ?? 1) + itemIndex}.` : "•"}
                      </Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Blocks blocks={blocks} theme={theme} prefs={prefs} />
                      </View>
                    </View>
                  ))}
                </View>
              );
            case "hr":
              return (
                <View
                  key={key}
                  style={{ height: 1, marginVertical: 5, backgroundColor: theme.colors.border }}
                />
              );
          }
          return null;
        })}
      </View>
    );
  }

  function Message({ theme, item }: PluginTimelineItemProps<MessagePresentation>) {
    const prefs = usePreferences();
    return (
      <View
        style={{
          width: "100%",
          minWidth: 0,
          maxWidth: prefs.readingWidth === "wide" ? 980 : 760,
          paddingVertical: prefs.density === "compact" ? 3 : 8,
        }}
      >
        <Blocks blocks={item.data.blocks} theme={theme} prefs={prefs} />
        <View style={{ alignSelf: "flex-start", marginTop: 6 }}>
          <Copy theme={theme} text={item.data.sourceText} />
        </View>
      </View>
    );
  }

  return { Tool, Reasoning, Message };
}
