import { createElement, type ReactNode, type Ref, useCallback, useEffect, useRef } from "react";
import { Platform, type StyleProp, View, type ViewProps, type ViewStyle } from "react-native";
import { viewerKeyAction, wheelZoomFactor } from "../shared/image-input";

// This adapter is the only Essentials module that mentions browser-only element
// props. React Native Web forwards them to its host element on web clients and
// native clients drop them, so no module reads or writes host DOM globals. The
// surface is built with createElement so the module stays plain TypeScript.

type WheelInput = { clientX: number; clientY: number; deltaY: number };
type KeyInput = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  isComposing?: boolean;
  preventDefault?: () => void;
  target?: { tagName?: string } | null;
};
type SurfaceHandle = {
  focus?: () => void;
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};
type SurfaceBox = { left: number; top: number; width: number; height: number };
type DesktopStyle = ViewStyle & { overscrollBehavior?: "auto" | "contain" | "none" };
type DesktopViewProps = ViewProps & {
  onWheel?: (event: WheelInput) => void;
  onKeyDown?: (event: KeyInput) => void;
  style?: StyleProp<DesktopStyle>;
  ref?: Ref<SurfaceHandle>;
};

function surface(props: DesktopViewProps, children?: ReactNode) {
  return createElement(View as unknown as (props: DesktopViewProps) => ReactNode, props, children);
}

function editableTarget(event: KeyInput): boolean {
  const tag = event.target?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function centerOf(box: SurfaceBox, event: WheelInput) {
  return {
    x: event.clientX - box.left - box.width / 2,
    y: event.clientY - box.top - box.height / 2,
  };
}

export type DesktopZoomActions = {
  /** Feature gate for desktop zoom gestures. */
  enabled: () => boolean;
  /** Apply a zoom factor around a pointer position measured from the surface center. */
  zoom: (factor: number, center: { x: number; y: number }) => void;
};

/**
 * Desktop wheel zoom for the image surface. The anchor uses the surface's window
 * box from the public `measureInWindow` contract; `overscrollBehavior` keeps the
 * wheel on the viewer instead of scrolling the host behind it.
 */
export function DesktopZoomSurface({
  actions,
  children,
  onLayout,
  style,
  testID,
  ...viewProps
}: Omit<ViewProps, "style" | "onLayout" | "testID" | "children"> & {
  actions: DesktopZoomActions;
  children?: ReactNode;
  onLayout?: ViewProps["onLayout"];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const surfaceRef = useRef<SurfaceHandle | null>(null);
  const box = useRef<SurfaceBox>({ left: 0, top: 0, width: 0, height: 0 });
  const measure = useCallback(() => {
    surfaceRef.current?.measureInWindow?.((left, top, width, height) => {
      box.current = { left, top, width, height };
    });
  }, []);
  const handleLayout: ViewProps["onLayout"] = (event) => {
    measure();
    onLayout?.(event);
  };
  const handleWheel = (event: WheelInput) => {
    if (!actions.enabled() || Platform.OS !== "web") return;
    const factor = wheelZoomFactor(event.deltaY);
    if (factor === 1) return;
    const current = box.current;
    if (current.width > 0 && current.height > 0) {
      actions.zoom(factor, centerOf(current, event));
      return;
    }
    surfaceRef.current?.measureInWindow?.((left, top, width, height) => {
      box.current = { left, top, width, height };
      actions.zoom(factor, centerOf(box.current, event));
    });
  };
  return surface(
    {
      ...viewProps,
      ref: surfaceRef,
      testID,
      onLayout: handleLayout,
      onWheel: Platform.OS === "web" ? handleWheel : undefined,
      style: Platform.OS === "web" ? [style, { overscrollBehavior: "none" }] : style,
    },
    children,
  );
}

export type DesktopNavigationActions = {
  previous: () => void;
  next: () => void;
  dismiss: () => void;
};

/**
 * Desktop keyboard handling for the viewer: arrows navigate and Escape closes,
 * owned by the plugin instead of the host modal's key handling. Text entry keeps
 * its own keys. The surface takes focus on mount so keys work without a click.
 */
export function DesktopKeySurface({
  actions,
  children,
  style,
  ...viewProps
}: Omit<ViewProps, "style" | "children"> & {
  actions: DesktopNavigationActions;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const surfaceRef = useRef<SurfaceHandle | null>(null);
  useEffect(() => {
    surfaceRef.current?.focus?.();
  }, []);
  const handleKeyDown = (event: KeyInput) => {
    if (Platform.OS !== "web") return;
    const action = viewerKeyAction(event);
    if (!action || (action !== "dismiss" && editableTarget(event))) return;
    event.preventDefault?.();
    if (action === "previous") actions.previous();
    else if (action === "next") actions.next();
    else actions.dismiss();
  };
  return surface(
    {
      ...viewProps,
      ref: surfaceRef,
      focusable: true,
      style,
      onKeyDown: Platform.OS === "web" ? handleKeyDown : undefined,
    },
    children,
  );
}
