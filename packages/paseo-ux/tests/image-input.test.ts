import assert from "node:assert/strict";
import { test } from "node:test";
import { viewerKeyAction, wheelZoomFactor } from "../shared/image-input";

test("wheel steps zoom around the pointer and non-wheel input stays neutral", () => {
  assert.ok(wheelZoomFactor(-100) > 1.2, "wheel up zooms in");
  assert.ok(wheelZoomFactor(100) < 0.82, "wheel down zooms out");
  assert.ok(Math.abs(wheelZoomFactor(100) * wheelZoomFactor(-100) - 1) < 1e-9, "steps invert");
  assert.equal(wheelZoomFactor(0), 1);
  assert.equal(wheelZoomFactor(Number.NaN), 1);
});

test("viewer keys navigate and dismiss only as plain keys", () => {
  assert.equal(viewerKeyAction({ key: "ArrowLeft" }), "previous");
  assert.equal(viewerKeyAction({ key: "ArrowRight" }), "next");
  assert.equal(viewerKeyAction({ key: "Escape" }), "dismiss");
  assert.equal(viewerKeyAction({ key: "ArrowUp" }), null);
  assert.equal(viewerKeyAction({ key: "a" }), null);
  assert.equal(viewerKeyAction({ key: "Escape", shiftKey: true }), null);
  assert.equal(viewerKeyAction({ key: "ArrowRight", metaKey: true }), null);
  assert.equal(viewerKeyAction({ key: "ArrowRight", ctrlKey: true }), null);
  assert.equal(viewerKeyAction({ key: "ArrowRight", altKey: true }), null);
  assert.equal(viewerKeyAction({ key: "ArrowRight", defaultPrevented: true }), null);
  assert.equal(viewerKeyAction({ key: "Escape", isComposing: true }), null);
});
