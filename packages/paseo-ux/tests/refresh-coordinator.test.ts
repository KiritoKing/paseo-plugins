import assert from "node:assert/strict";
import { test } from "node:test";
import { createRefreshCoordinator, type RefreshKind } from "../client/refresh-coordinator";

type Page = { assets: string[] };
type Call = {
  kind: RefreshKind;
  cursor: string | null;
  response: Deferred<Page>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type Deferred<T> = ReturnType<typeof deferred<T>>;

function harness(isCurrent: () => boolean = () => true, assets: string[] = []) {
  const calls: Call[] = [];
  const errors: unknown[] = [];
  const coordinator = createRefreshCoordinator<Page, string>({
    load: (kind, cursor) => {
      const response = deferred<Page>();
      calls.push({ kind, cursor, response });
      return response.promise;
    },
    onPage: (page) => {
      for (const asset of page.assets) {
        if (!assets.includes(asset)) assets.push(asset);
      }
    },
    onError: (cause) => errors.push(cause),
  });
  coordinator.activate(isCurrent);
  return { coordinator, calls, assets, errors };
}

test("a debounced timeline refresh during a pending head request coalesces into one follow-up", async () => {
  const panel = harness();
  const initial = panel.coordinator.request();

  // These represent refresh callbacks after the timeline debounce has elapsed.
  const eventRefreshes = [
    panel.coordinator.request(),
    panel.coordinator.request(),
    panel.coordinator.request("older", "old-cursor"),
  ];
  assert.deepEqual(
    panel.calls.map(({ kind }) => kind),
    ["head"],
    "requests arriving during the active RPC are recorded, not started in parallel",
  );

  panel.calls[0].response.resolve({ assets: [] });
  await initial;
  assert.deepEqual(
    panel.calls.map(({ kind, cursor }) => [kind, cursor]),
    [
      ["head", null],
      ["head", null],
    ],
  );

  panel.calls[1].response.resolve({ assets: ["new attachment"] });
  await Promise.all(eventRefreshes);
  assert.deepEqual(panel.assets, ["new attachment"]);
  assert.equal(panel.calls.length, 2, "all pending refresh intents share one head request");
});

test("a refresh queued during a manual older-page request runs as head after the older page", async () => {
  const panel = harness();
  const older = panel.coordinator.request("older", "cursor-older");
  const timeline = panel.coordinator.request("head");
  assert.deepEqual(
    panel.calls.map(({ kind, cursor }) => [kind, cursor]),
    [["older", "cursor-older"]],
  );

  panel.calls[0].response.resolve({ assets: ["older attachment"] });
  await older;
  assert.deepEqual(
    panel.calls.map(({ kind, cursor }) => [kind, cursor]),
    [
      ["older", "cursor-older"],
      ["head", null],
    ],
  );

  panel.calls[1].response.resolve({ assets: ["new head attachment"] });
  await timeline;
  assert.deepEqual(panel.assets, ["older attachment", "new head attachment"]);
});

test("replacement invalidates an older response and the queued head uses the new history revision", async () => {
  const panel = harness();
  const oldRevision = panel.coordinator.request();
  panel.coordinator.invalidate();
  const replacementRefresh = panel.coordinator.request();

  panel.calls[0].response.resolve({ assets: ["stale pre-replacement attachment"] });
  await oldRevision;
  assert.deepEqual(panel.assets, []);
  assert.equal(panel.calls.length, 2);

  panel.calls[1].response.resolve({ assets: ["replacement attachment"] });
  await replacementRefresh;
  assert.deepEqual(panel.assets, ["replacement attachment"]);
});

test("a disposed old generation cannot write over the new panel result", async () => {
  let generation = 1;
  const visibleAssets: string[] = [];
  const oldPanel = harness(() => generation === 1, visibleAssets);
  const oldRequest = oldPanel.coordinator.request();

  generation = 2;
  oldPanel.coordinator.dispose();
  const newPanel = harness(() => generation === 2, visibleAssets);
  const newRequest = newPanel.coordinator.request();

  newPanel.calls[0].response.resolve({ assets: ["new agent attachment"] });
  await newRequest;
  oldPanel.calls[0].response.resolve({ assets: ["old agent attachment"] });
  await oldRequest;
  assert.deepEqual(visibleAssets, ["new agent attachment"]);
  assert.equal(oldPanel.calls.length, 1, "disposing does not retry the old request");
});

test("a generation change suppresses a late response before the coordinator is disposed", async () => {
  let generation = 1;
  const panel = harness(() => generation === 1);
  const request = panel.coordinator.request();

  generation = 2;
  panel.calls[0].response.resolve({ assets: ["stale response"] });
  await request;

  assert.deepEqual(panel.assets, []);
  assert.equal(panel.calls.length, 1);
});

test("an ordinary RPC error does not trigger an automatic retry loop", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const coordinator = createRefreshCoordinator<Page, string>({
    load: async () => {
      calls++;
      throw new Error("temporary list failure");
    },
    onPage: () => assert.fail("failed RPC must not produce a page"),
    onError: (cause) => errors.push(cause),
  });
  coordinator.activate(() => true);

  await coordinator.request();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
});
