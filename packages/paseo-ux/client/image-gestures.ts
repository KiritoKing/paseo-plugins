import { type GestureResponderEvent, PanResponder } from "react-native";
import {
  clampViewport,
  dragViewport,
  type ImageViewport,
  type ViewportBounds,
  zoomAt,
} from "../shared/viewport";

type Point = { x: number; y: number };
type Touch = { locationX?: number; locationY?: number; pageX?: number; pageY?: number };
type GestureState = {
  mode: "pending" | "pan" | "pinch";
  startZoom: number;
  startDX: number;
  startDY: number;
  baseViewport: ImageViewport;
  hadMultipleTouches: boolean;
  pinch?: { center: Point; distance: number };
  startTime: number;
  startPoint: Point;
};

export type ImageGestureActions = {
  enabled: () => boolean;
  readViewport: () => ImageViewport;
  readBounds: () => ViewportBounds;
  updateViewport: (viewport: ImageViewport) => void;
  previous: () => void;
  next: () => void;
  reset: () => void;
};

function activeTouches(event: GestureResponderEvent): Touch[] {
  const touches = (event.nativeEvent as typeof event.nativeEvent & { touches?: Touch[] }).touches;
  return Array.isArray(touches) ? touches : [];
}

function point(touch: Touch): Point {
  return { x: touch.locationX ?? touch.pageX ?? 0, y: touch.locationY ?? touch.pageY ?? 0 };
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}
function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
function local(point: Point, bounds: ViewportBounds): Point {
  return { x: point.x - bounds.width / 2, y: point.y - bounds.height / 2 };
}

export function createImagePanResponder(actions: ImageGestureActions) {
  let active: GestureState | null = null;
  let lastTap: { at: number; point: Point } | null = null;

  const applyPinch = (event: GestureResponderEvent) => {
    const touches = activeTouches(event).slice(0, 2);
    if (touches.length < 2 || !active) return;
    const first = point(touches[0]!);
    const second = point(touches[1]!);
    const center = midpoint(first, second);
    const nextDistance = Math.max(1, distance(first, second));
    const previous = active.pinch;
    if (!previous) {
      active.pinch = { center, distance: nextDistance };
      active.mode = "pinch";
      active.baseViewport = actions.readViewport();
      return;
    }
    const bounds = actions.readBounds();
    const scaled = zoomAt(
      actions.readViewport(),
      nextDistance / previous.distance,
      local(previous.center, bounds),
    );
    const panned = dragViewport(scaled, {
      x: center.x - previous.center.x,
      y: center.y - previous.center.y,
    });
    actions.updateViewport(clampViewport(panned, bounds));
    active.pinch = { center, distance: nextDistance };
    active.mode = "pinch";
  };

  const handlers = PanResponder.create({
    onStartShouldSetPanResponder: () => actions.enabled(),
    onMoveShouldSetPanResponder: (_event, state) =>
      actions.enabled() &&
      (state.numberActiveTouches > 1 || Math.abs(state.dx) + Math.abs(state.dy) > 3),
    onPanResponderGrant: (event, state) => {
      const viewport = actions.readViewport();
      active = {
        mode: viewport.zoom > 1.01 ? "pan" : "pending",
        startZoom: viewport.zoom,
        startDX: state.dx,
        startDY: state.dy,
        baseViewport: viewport,
        hadMultipleTouches: false,
        startTime: Date.now(),
        startPoint: { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
      };
      const touches = activeTouches(event);
      if (touches.length >= 2) {
        active.hadMultipleTouches = true;
        applyPinch(event);
      }
    },
    onPanResponderMove: (event, state) => {
      if (!active) return;
      const touches = activeTouches(event);
      if (touches.length >= 2) {
        active.hadMultipleTouches = true;
        applyPinch(event);
        return;
      }
      if (active.mode !== "pan") {
        active.mode = "pan";
        active.baseViewport = actions.readViewport();
        active.startDX = state.dx;
        active.startDY = state.dy;
        active.pinch = undefined;
        return;
      }
      const viewport = actions.readViewport();
      if (viewport.zoom <= 1.01) return;
      const bounds = actions.readBounds();
      const panned = dragViewport(active.baseViewport, {
        x: state.dx - active.startDX,
        y: state.dy - active.startDY,
      });
      actions.updateViewport(clampViewport(panned, bounds));
    },
    onPanResponderRelease: (_event, state) => {
      if (!active) return;
      const gesture = active;
      active = null;
      if (
        !gesture.hadMultipleTouches &&
        gesture.startZoom <= 1.01 &&
        Math.abs(state.dx) > 48 &&
        Math.abs(state.dx) > Math.abs(state.dy) * 1.2
      ) {
        if (state.dx < 0) actions.next();
        else actions.previous();
        lastTap = null;
        return;
      }
      const isTap =
        !gesture.hadMultipleTouches &&
        Math.abs(state.dx) < 8 &&
        Math.abs(state.dy) < 8 &&
        Date.now() - gesture.startTime < 500;
      if (!isTap) return;
      const tap = { at: Date.now(), point: gesture.startPoint };
      if (lastTap && tap.at - lastTap.at <= 500 && distance(tap.point, lastTap.point) <= 32) {
        lastTap = null;
        actions.reset();
        return;
      }
      lastTap = tap;
    },
    onPanResponderTerminate: () => {
      active = null;
      lastTap = null;
    },
  });
  return handlers;
}
