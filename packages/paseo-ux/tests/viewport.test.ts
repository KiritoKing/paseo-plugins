import assert from "node:assert/strict";
import { test } from "node:test";
import { clampViewport, containedImageSize } from "../shared/viewport";

test("contain sizing uses the largest aspect-preserving image size inside the canvas", () => {
  assert.deepEqual(containedImageSize({ width: 300, height: 200 }, { width: 1000, height: 1000 }), {
    width: 200,
    height: 200,
  });
  assert.deepEqual(containedImageSize({ width: 300, height: 200 }, { width: 1200, height: 600 }), {
    width: 300,
    height: 150,
  });
  assert.deepEqual(containedImageSize({ width: 0, height: 200 }, { width: 1200, height: 600 }), {
    width: 0,
    height: 0,
  });
});

test("pan bounds keep all edges of an enlarged contain image inside the canvas", () => {
  const bounds = { width: 300, height: 200, imageWidth: 200, imageHeight: 200 };
  assert.deepEqual(clampViewport({ zoom: 2, x: -500, y: 500 }, bounds), {
    zoom: 2,
    x: -50,
    y: 100,
  });
  assert.deepEqual(clampViewport({ zoom: 1, x: 40, y: -60 }, bounds), { zoom: 1, x: 0, y: 0 });
});

test("resizing the available canvas clamps existing pan while unusable dimensions preserve state", () => {
  const zoomed = { zoom: 3, x: 180, y: -100 };
  assert.deepEqual(
    clampViewport(
      { zoom: 3, x: 500, y: -300 },
      { width: 240, height: 160, imageWidth: 800, imageHeight: 400 },
    ),
    { zoom: 3, x: 240, y: -100 },
  );
  assert.deepEqual(
    clampViewport(zoomed, { width: 0, height: 0, imageWidth: 800, imageHeight: 400 }),
    zoomed,
  );
});
