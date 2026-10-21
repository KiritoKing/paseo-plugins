// Browser regression checks for the production image viewer. They drive the real
// preview through DOM input only and report pass/fail names; run them from the
// essentials fixture with `await window.runImageChecks()` after `pnpm fixtures:build`.
export async function runImageChecks() {
  const passed = [];
  const failed = [];
  const frame = () => new Promise((resolve) => setTimeout(resolve, 40));
  const waitFor = async (predicate, name) => {
    for (let i = 0; i < 40; i++) {
      if (predicate()) return true;
      await frame();
    }
    failed.push(name);
    return false;
  };
  const assert = (condition, name) => {
    if (condition) passed.push(name);
    else failed.push(name);
  };
  const canvas = () => document.querySelector('[data-testid="image-preview-canvas"]');
  const counter = () =>
    Array.from(document.querySelectorAll("div"))
      .map((node) => node.textContent)
      .find((text) => /^\d+ \/ \d+$/.test(text || ""));
  const zoom = () =>
    Number.parseInt(
      Array.from(document.querySelectorAll("div"))
        .map((node) => node.textContent)
        .find((text) => /^\d+%$/.test(text || "")) || "0",
      10,
    );
  const imageRect = () => {
    const image = canvas()?.querySelector("img");
    return image ? image.getBoundingClientRect().left : null;
  };
  const clickButton = (label) => {
    const node = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === label || button.getAttribute("aria-label") === label,
    );
    node?.click();
    return Boolean(node);
  };
  const pointer = (target, type, x, y) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
  const mouse = (target, type, x, y) =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
    );
  const drag = async (from, to) => {
    const surface = canvas();
    pointer(surface, "pointerdown", from[0], from[1]);
    mouse(surface, "mousedown", from[0], from[1]);
    for (let i = 1; i <= 8; i++) {
      const x = from[0] + ((to[0] - from[0]) * i) / 8;
      const y = from[1] + ((to[1] - from[1]) * i) / 8;
      pointer(surface, "pointermove", x, y);
      mouse(surface, "mousemove", x, y);
    }
    pointer(surface, "pointerup", to[0], to[1]);
    mouse(surface, "mouseup", to[0], to[1]);
    await frame();
  };
  const tap = async (x, y) => {
    const surface = canvas();
    pointer(surface, "pointerdown", x, y);
    mouse(surface, "mousedown", x, y);
    pointer(surface, "pointerup", x, y);
    mouse(surface, "mouseup", x, y);
    await frame();
  };
  const wheel = async (deltaY, x, y) => {
    canvas().dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, clientX: x, clientY: y }),
    );
    await frame();
  };
  const keyTarget = () =>
    document.activeElement?.isConnected ? document.activeElement : document.body;
  const key = async (value) => {
    const target = keyTarget();
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new KeyboardEvent("keyup", { key: value, bubbles: true, cancelable: true }),
    );
    await frame();
  };

  clickButton("gallery");
  await frame();
  clickButton("View Sample 1");
  await waitFor(canvas, "open image viewer");
  if (!canvas()) return { passed, failed };
  const box = canvas().getBoundingClientRect();
  const center = [box.left + box.width / 2, box.top + box.height / 2];

  // The viewer takes focus on open so its keys work without a prior click.
  const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
  await frame();
  assert(Boolean(dialog?.contains(document.activeElement)), "viewer takes focus on open");

  // Wheel zoom at the cursor, then back down.
  const beforeZoom = zoom();
  await wheel(-120, center[0], center[1]);
  assert(zoom() > beforeZoom, "wheel zooms in");
  await wheel(120, center[0], center[1]);
  assert(Math.abs(zoom() - beforeZoom) < 2, "wheel zooms out");
  await wheel(-240, center[0], center[1]);
  assert(zoom() > beforeZoom, "wheel zoom accumulates");

  // Arrow keys switch images while the viewer is open.
  const beforeKey = counter();
  await key("ArrowRight");
  assert(counter() !== beforeKey, "ArrowRight shows the next image");
  await key("ArrowLeft");
  assert(counter() === beforeKey, "ArrowLeft shows the previous image");
  await key("ArrowUp");
  assert(counter() === beforeKey, "other keys do not switch images");

  // Double click resets the zoom of the current image.
  await tap(center[0], center[1]);
  await tap(center[0], center[1]);
  await waitFor(() => zoom() === 100, "double click resets zoom");
  assert(zoom() === 100, "double click resets zoom");

  // Fitted images swipe between images; zoomed images pan under the pointer.
  const beforeSwipe = counter();
  await drag([center[0] + 160, center[1]], [center[0] - 160, center[1]]);
  assert(counter() !== beforeSwipe, "drag swipes to the next image");
  await drag([center[0] - 160, center[1]], [center[0] + 160, center[1]]);
  assert(counter() === beforeSwipe, "drag back swipes to the previous image");
  await wheel(-240, center[0], center[1]);
  assert(zoom() > 100, "wheel zooms before the pan check");
  const beforePan = imageRect();
  await drag([center[0] + 120, center[1]], [center[0] - 120, center[1]]);
  assert(imageRect() !== beforePan, "drag pans a zoomed image");

  // Two finger pinch zooms on touch screens.
  const surface = canvas();
  const beforePinch = zoom();
  const touches = (a, b) => [
    new Touch({ identifier: 1, target: surface, clientX: a[0], clientY: a[1] }),
    new Touch({ identifier: 2, target: surface, clientX: b[0], clientY: b[1] }),
  ];
  const touchEvent = (type, list) =>
    surface.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: list,
        targetTouches: list,
        changedTouches: list,
      }),
    );
  try {
    touchEvent("touchstart", touches([center[0] - 60, center[1]], [center[0] + 60, center[1]]));
    touchEvent("touchmove", touches([center[0] - 140, center[1]], [center[0] + 140, center[1]]));
    touchEvent("touchmove", touches([center[0] - 200, center[1]], [center[0] + 200, center[1]]));
    touchEvent("touchend", []);
    await frame();
    assert(zoom() > beforePinch, "pinch zooms in");
  } catch {
    failed.push("pinch zooms in (touch events unavailable)");
  }

  // Escape closes the viewer through the plugin's own keyboard handling.
  await key("Escape");
  await waitFor(() => !canvas(), "Escape closes the viewer");
  assert(!canvas(), "Escape closes the viewer");
  return { passed, failed };
}
