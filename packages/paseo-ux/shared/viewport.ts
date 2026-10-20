export type ImageViewport = { zoom: number; x: number; y: number };
export const fittedViewport: ImageViewport = { zoom: 1, x: 0, y: 0 };
export type ViewportSize = { width: number; height: number };
export type ViewportBounds = ViewportSize & { imageWidth: number; imageHeight: number };
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

export function zoomAt(
  state: ImageViewport,
  factor: number,
  pointer: { x: number; y: number },
): ImageViewport {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));
  const ratio = zoom / state.zoom;
  return {
    zoom,
    x: pointer.x - (pointer.x - state.x) * ratio,
    y: pointer.y - (pointer.y - state.y) * ratio,
  };
}
export function dragViewport(state: ImageViewport, delta: { x: number; y: number }): ImageViewport {
  return { ...state, x: state.x + delta.x, y: state.y + delta.y };
}

/** Size of an image rendered with `resizeMode="contain"` inside a viewport. */
export function containedImageSize(viewport: ViewportSize, image: ViewportSize): ViewportSize {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0)
    return { width: 0, height: 0 };
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

/** Keep a zoomed image covering the viewport without changing the existing zoom/drag semantics. */
export function clampViewport(state: ImageViewport, bounds: ViewportBounds): ImageViewport {
  if (bounds.width <= 0 || bounds.height <= 0 || bounds.imageWidth <= 0 || bounds.imageHeight <= 0)
    return state;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom));
  const fitted = containedImageSize(bounds, {
    width: bounds.imageWidth,
    height: bounds.imageHeight,
  });
  const maxX = Math.max(0, (fitted.width * zoom - bounds.width) / 2);
  const maxY = Math.max(0, (fitted.height * zoom - bounds.height) / 2);
  const x = Math.max(-maxX, Math.min(maxX, state.x));
  const y = Math.max(-maxY, Math.min(maxY, state.y));
  return { zoom, x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y };
}
