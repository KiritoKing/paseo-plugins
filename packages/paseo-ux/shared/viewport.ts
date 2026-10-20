export type ImageViewport = { zoom: number; x: number; y: number };
export const fittedViewport: ImageViewport = { zoom: 1, x: 0, y: 0 };
export function zoomAt(
  state: ImageViewport,
  factor: number,
  pointer: { x: number; y: number },
): ImageViewport {
  const zoom = Math.max(0.25, Math.min(8, state.zoom * factor));
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
