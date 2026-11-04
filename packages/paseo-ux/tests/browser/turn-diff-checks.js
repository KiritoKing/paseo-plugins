// Deterministic component checks using only fixture controls and real UI actions.
// RPC responses are synthetic; these checks do not prove daemon acceptance.
import { turnDiffFixture } from "./turn-diff-fixture";

export async function runTurnDiffChecks(resetQueries = () => {}) {
  const passed = [];
  const failed = [];
  const frame = (milliseconds = 40) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const text = () => document.querySelector("main")?.textContent || "";
  const button = (label) =>
    [...document.querySelectorAll("button,[role=button]")].find(
      (node) => node.getAttribute("aria-label") === label || node.textContent === label,
    );
  const click = async (label) => {
    const node = button(label);
    if (!node) throw new Error(`Missing action: ${label}`);
    node.click();
    await frame();
  };
  const wait = async (predicate, name) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) {
        passed.push(name);
        return;
      }
      await frame();
    }
    throw new Error(name);
  };
  const assert = (condition, name) => {
    if (!condition) throw new Error(name);
    passed.push(name);
  };
  const conversation = async (id) => {
    const select = document.querySelector('select[aria-label="Conversation"]');
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await frame();
  };
  try {
    await click("features");
    turnDiffFixture.reset();
    resetQueries();
    const feature = document.querySelector('[role="switch"][aria-label="Turn changes"]');
    if (!feature?.checked) {
      feature.click();
      await frame();
    }
    await conversation("sample");
    await click("turn-card");
    await wait(
      () => text().includes("5 files · 1 commits"),
      "timeline card shows files and commits",
    );
    assert(text().includes("Save turn changes"), "timeline card shows commit subjects");
    await click("View changes: src/example.ts");
    await wait(
      () => text().includes("+const result = true;"),
      "card opens a saved file outside the first history page",
    );
    assert(
      text().includes("Concurrent turns shared this directory"),
      "shared directory warning remains visible",
    );
    assert(text().includes("src/old-name.ts → src/new-name.ts"), "renames show both paths");
    await click("View changes: sample.bin");
    await wait(
      () => text().includes("Binary file changed."),
      "binary files show an explicit non-text state",
    );
    await click("View changes: large.blob");
    await wait(
      () => text().includes("Untracked file exceeded 1 MiB"),
      "omitted snapshots explain the size limit",
    );
    await click("View changes: long.ts");
    await wait(() => text().includes("Diff preview truncated"), "truncated previews show a notice");
    assert(
      document.querySelectorAll('[data-testid="turn-diff-row"]').length === 2_000,
      "long previews render at most 2,000 rows",
    );
    await click("Fail next saved diff");
    await click("View changes: src/example.ts");
    await wait(
      () => text().includes("Synthetic saved diff error"),
      "saved diff errors are visible",
    );
    await click("Retry saved diff");
    await wait(
      () => text().includes("+const result = true;"),
      "saved diff retry restores the preview",
    );
    await click("Delay next saved diff");
    await click("View changes: src/new-name.ts");
    await conversation("empty");
    await wait(
      () => text().includes("No recorded changes"),
      "empty agents have an explanatory state",
    );
    await frame(1_000);
    assert(
      !text().includes("+const result = true;"),
      "late diff responses cannot populate another agent panel",
    );
    await conversation("sample");
    await click("Open turn history command");
    await wait(() => !!button("Open turn image-turn"), "Command Center opens saved history");
    await click("Load older turns");
    await wait(() => !!button("Open turn text-turn"), "history loads older turns");
    await click("Fail next turn history");
    await click("Refresh turn changes");
    await wait(
      () => text().includes("Synthetic turn history error"),
      "history errors preserve retry controls",
    );
    await click("Refresh turn changes");
    await wait(
      () => !text().includes("Synthetic turn history error") && !!button("Open turn image-turn"),
      "history retry restores the saved list",
    );
    await click("Open turn image-turn");
    await click("View changes: sample.png");
    await wait(() => {
      const images = [...document.querySelectorAll("main img")];
      return (
        images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0)
      );
    }, "before and after images both decode");
    const images = [...document.querySelectorAll("main img")];
    assert(images[0].src !== images[1].src, "image sides use distinct saved sources");
    await click("features");
    document.querySelector('[role="switch"][aria-label="Turn changes"]').click();
    await wait(
      () => !document.querySelector('[data-registration="command:turn-changes"]'),
      "feature off removes only its command",
    );
    assert(
      !!document.querySelector('[data-registration="command:sessions"]'),
      "session history stays enabled",
    );
    await click("turn-changes");
    await wait(
      () => text().includes("Turn changes are turned off."),
      "already open panels respect the feature switch",
    );
    await click("features");
    document.querySelector('[role="switch"][aria-label="Turn changes"]').click();
    await wait(
      () => !!document.querySelector('[data-registration="command:turn-changes"]'),
      "feature can be re-enabled",
    );
    await click("Open turn history command");
  } catch (error) {
    failed.push(error.message);
  }
  return {
    passed,
    failed,
    ...(failed.length
      ? { requests: turnDiffFixture.calls.slice(-8), visible: text().slice(-800) }
      : {}),
  };
}
