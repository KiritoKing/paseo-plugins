import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import {
  DIVIDER_SIZE,
  layoutPreferences,
  layoutRpcs,
  splitSize,
  stackLayout,
  type WorkspaceLayout,
  workspaceLayoutSchema,
} from "../shared/layout";
import { saveWorkspaceLayout } from "./layout-store";

export function SplitPane({
  workspaceId,
  theme,
  compact,
  first,
  second,
}: {
  workspaceId: string;
  theme: PluginTheme;
  compact: boolean;
  first(controls: { stacked: boolean; toggleDirection(): void }): ReactNode;
  second: ReactNode;
}) {
  const settings = useSettings(layoutPreferences);
  const read = useRpc(layoutRpcs.read);
  const write = useRpc(layoutRpcs.write);
  const [layout, setLayout] = useState<WorkspaceLayout>(() =>
    settings.status === "ready"
      ? (settings.values.workspaces[workspaceId] ?? workspaceLayoutSchema.parse({}))
      : workspaceLayoutSchema.parse({}),
  );
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hydrated = useRef(false);
  const active = useRef(true);
  const queue = useRef(Promise.resolve());
  const currentLayout = useRef(layout);
  const start = useRef<{ stacked: boolean; extent: number; size: number } | null>(null);
  const stacked = stackLayout(layout.direction, compact, bounds.width);
  const extent = stacked ? bounds.height : bounds.width;
  const size = splitSize(extent, stacked ? layout.treeHeight : layout.treeWidth, stacked);
  const current = useRef({ stacked, extent, size });
  current.current = { stacked, extent, size };
  currentLayout.current = layout;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Hydrate once from the workspace snapshot for this settings revision; later updates use explicit commits.
  useEffect(() => {
    if (hydrated.current || settings.status !== "ready") return;
    hydrated.current = true;
    const restored = settings.values.workspaces[workspaceId];
    if (restored) {
      currentLayout.current = restored;
      setLayout(restored);
    }
  }, [settings.status, settings.status === "ready" ? settings.revision : null, workspaceId]);
  const commit = (value: WorkspaceLayout) => {
    hydrated.current = true;
    currentLayout.current = value;
    setLayout(value);
    setSaveError(null);
    // Serialize completed gestures; read the latest host revision for each write.
    queue.current = queue.current.then(async () => {
      try {
        await saveWorkspaceLayout(workspaceId, value, () => read({}), write);
        if (active.current) {
          setSaveError(null);
          await settings.reload();
        }
      } catch (error) {
        if (active.current)
          setSaveError(error instanceof Error ? error.message : "无法保存布局，请重试。");
      }
    });
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const move = (delta: number) => {
    const baseline = start.current;
    if (!baseline) return;
    const value = {
      ...currentLayout.current,
      [baseline.stacked ? "treeHeight" : "treeWidth"]: Math.max(
        80,
        Math.min(4000, splitSize(baseline.extent, baseline.size + delta, baseline.stacked)),
      ),
    };
    hydrated.current = true;
    currentLayout.current = value;
    setLayout(value);
  };
  const moveRef = useRef(move);
  moveRef.current = move;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => current.current.extent > DIVIDER_SIZE,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = { ...current.current };
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) =>
          moveRef.current(start.current?.stacked ? gesture.dy : gesture.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => {
          start.current = null;
          setDragging(false);
          commitRef.current(currentLayout.current);
        },
        onPanResponderTerminate: () => {
          start.current = null;
          setDragging(false);
          commitRef.current(currentLayout.current);
        },
      }),
    [],
  );
  const adjust = (delta: number) => {
    const measurement = current.current;
    commit({
      ...currentLayout.current,
      [measurement.stacked ? "treeHeight" : "treeWidth"]: Math.max(
        80,
        Math.min(
          4000,
          splitSize(measurement.extent, measurement.size + delta, measurement.stacked),
        ),
      ),
    });
  };
  const keyboard =
    Platform.OS === "web"
      ? {
          onKeyDown: (event: { key: string; preventDefault(): void }) => {
            const keys = stacked ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            adjust(event.key === keys[0] ? -20 : 20);
          },
        }
      : {};
  // React Native types only native cursors; React Native Web also accepts resize cursors.
  const cursorStyle =
    Platform.OS === "web"
      ? ({ cursor: stacked ? "row-resize" : "col-resize" } as unknown as ViewStyle)
      : {};
  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      <View
        testID="aiw-split-layout"
        onLayout={(event) =>
          setBounds({
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          })
        }
        style={{ flex: 1, minHeight: 0, minWidth: 0, flexDirection: stacked ? "column" : "row" }}
      >
        <View
          testID="aiw-tree-pane"
          style={{
            minWidth: 0,
            minHeight: 0,
            flexShrink: 0,
            ...(extent > 0 ? (stacked ? { height: size } : { width: size }) : { flex: 0.35 }),
          }}
        >
          {first({
            stacked,
            toggleDirection: () => commit({ ...layout, direction: stacked ? "row" : "column" }),
          })}
        </View>
        <View
          {...responder.panHandlers}
          {...keyboard}
          testID="aiw-split-handle"
          hitSlop={8}
          accessible
          focusable
          accessibilityRole="adjustable"
          accessibilityLabel={stacked ? "调整文件树高度" : "调整文件树宽度"}
          accessibilityHint="拖拽调整；方向键微调。松开后保存布局。"
          accessibilityValue={{
            min: 0,
            max: Math.max(0, extent - DIVIDER_SIZE),
            now: Math.round(size),
            text: `${Math.round(size)} 像素`,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) =>
            adjust(event.nativeEvent.actionName === "increment" ? 20 : -20)
          }
          style={[
            {
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              ...(stacked ? { height: DIVIDER_SIZE } : { width: DIVIDER_SIZE }),
            },
            cursorStyle,
          ]}
        >
          <View
            pointerEvents="none"
            style={{
              borderRadius: 2,
              backgroundColor: dragging ? theme.colors.accent : theme.colors.border,
              ...(stacked ? { height: 3, width: 36 } : { width: 3, height: 36 }),
            }}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{second}</View>
      </View>
      {saveError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重试保存布局"
          onPress={() => commit(currentLayout.current)}
        >
          <Text style={{ color: theme.colors.statusDanger, fontSize: 11, paddingVertical: 3 }}>
            布局未保存，点击重试：{saveError}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
