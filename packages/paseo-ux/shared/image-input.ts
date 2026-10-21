/** Pure input interpretation for the image viewer. Browser event shapes stay in `client/web.ts`. */

/**
 * Zoom factor for one wheel step. Desktop wheels report pixels, so the factor is
 * exponential: a 100px step is roughly a 22% change, matching the viewer's
 * 1.25 step buttons.
 */
export function wheelZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  return Math.exp(-deltaY * 0.002);
}

export type NavigationKeyInput = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
};

export type ViewerKeyAction = "previous" | "next" | "dismiss";

/** Viewer keyboard actions: plain arrows navigate, plain Escape closes. */
export function viewerKeyAction(input: NavigationKeyInput): ViewerKeyAction | null {
  if (input.defaultPrevented || input.isComposing) return null;
  const chord = input.altKey || input.ctrlKey || input.metaKey || input.shiftKey;
  if (chord) return null;
  if (input.key === "Escape") return "dismiss";
  if (input.key === "ArrowLeft") return "previous";
  if (input.key === "ArrowRight") return "next";
  return null;
}
