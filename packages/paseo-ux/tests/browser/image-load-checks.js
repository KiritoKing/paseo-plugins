import { Image } from "react-native";

// Fault injection changes the fixture's public Image API only. The gallery,
// viewer and rendered images are the real production components.
export async function runImageLoadChecks() {
  const passed = [];
  const failed = [];
  const frame = () => new Promise((resolve) => setTimeout(resolve, 40));
  const waitFor = async (predicate, name) => {
    for (let i = 0; i < 40; i++) {
      if (predicate()) {
        passed.push(name);
        return true;
      }
      await frame();
    }
    failed.push(name);
    return false;
  };
  const assert = (value, name) => (value ? passed : failed).push(name);
  const click = (label) => {
    const button = [...document.querySelectorAll("button")].find(
      (node) => node.textContent === label || node.getAttribute("aria-label") === label,
    );
    button?.click();
  };
  const canvas = () => document.querySelector('[data-testid="image-preview-canvas"]');
  const loaded = () => {
    const img = canvas()?.querySelector("img");
    return Boolean(img?.complete && img.naturalWidth > 0);
  };
  const error = () => canvas()?.querySelector('[role="alert"]')?.textContent;
  const close = async () => {
    click("Close");
    await frame();
  };
  const original = Image.getSize;
  try {
    click("gallery");
    await waitFor(
      () => document.querySelector('[aria-label="View Sample 1"] img')?.naturalWidth > 0,
      "gallery thumbnail loads before opening",
    );
    Image.getSize = (_uri, _success, failure) => failure(new Error("Synthetic size query failure"));
    click("View Sample 1");
    await waitFor(loaded, "size query failure still renders the full image");
    assert(!error(), "size query failure does not show an image load error");
    click("放大");
    await waitFor(
      () => loaded() && canvas()?.parentElement?.textContent.includes("125%"),
      "fallback image can zoom",
    );
    await close();

    click("image-load");
    await frame();
    const pending = [];
    Image.getSize = (_uri, success, failure) => pending.push({ success, failure });
    click("Open valid images");
    await waitFor(
      () => pending.length === 1 && loaded(),
      "image renders while size query is pending",
    );
    const first = pending[0];
    click("下一张");
    await waitFor(
      () => pending.length >= 2 && loaded(),
      "switch image while size query is pending",
    );
    first?.failure(new Error("Late size query failure"));
    first?.success(1, 1);
    await frame();
    assert(
      loaded() &&
        !error() &&
        document.querySelector('[role="heading"]')?.textContent === "Second preview",
      "late size callbacks do not replace the selected image",
    );
    await close();
    for (const callback of pending) callback.failure(new Error("Size query completed after close"));
    await frame();
    assert(!canvas(), "late size callbacks do not reopen a closed viewer");

    Image.getSize = original;
    for (const [scenario, message] of [
      ["renderer failure", "图片加载失败"],
      ["resolver failure", "图片读取失败"],
    ]) {
      click(`Open ${scenario}`);
      await waitFor(() => error() === message, `${scenario} shows its own error`);
      click("重试读取图片");
      await waitFor(loaded, `${scenario} recovers after retry`);
      assert(!error(), `${scenario} clears after retry`);
      await close();
    }
  } finally {
    Image.getSize = original;
    if (canvas()) await close();
  }
  return { passed, failed };
}
