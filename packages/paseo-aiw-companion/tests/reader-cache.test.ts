import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Reader } from "../client/model";
import { patchQueryKey, retainPatchData } from "../client/reader-cache";

const reader = (path = "a.go", snapshotId = "first"): Reader =>
  ({
    locator: { workspaceId: "workspace", repoId: "repo-a", path },
    change: { repoId: "repo-a", path, origin: "combined" },
    group: { snapshotId },
  }) as Reader;

test("unchanged polling keeps the cached diff and does not issue a new patch request", () => {
  const client = new QueryClient();
  const key = patchQueryKey("workspace", reader(), "all");
  const patch = { patch: "content" };
  client.setQueryData(key, patch);
  let requests = 0;
  const options = (value: Reader) => ({
    queryKey: patchQueryKey("workspace", value, "all"),
    queryFn: async () => {
      requests++;
      return patch;
    },
    staleTime: Infinity,
  });
  const observer = new QueryObserver<{ patch: string }>(client, options(reader()));
  const unsubscribe = observer.subscribe(() => {});
  for (let i = 0; i < 3; i++) observer.setOptions(options(reader()));
  assert.equal(requests, 0);
  assert.equal(observer.getCurrentResult().isLoading, false);
  assert.equal(observer.getCurrentResult().data, patch);
  unsubscribe();
  client.clear();
});

test("snapshot refresh keeps the same file visible; switching files never shows its predecessor", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const oldPatch = { patch: "old" };
  client.setQueryData(patchQueryKey("workspace", reader(), "all"), oldPatch);
  let finish!: (value: { patch: string }) => void;
  const pending = new Promise<{ patch: string }>((resolve) => {
    finish = resolve;
  });
  const options = (value: Reader) => {
    const queryKey = patchQueryKey("workspace", value, "all");
    return {
      queryKey,
      queryFn: () => pending,
      staleTime: Infinity,
      placeholderData: (
        data: { patch: string } | undefined,
        query: { queryKey: readonly unknown[] } | undefined,
      ) => retainPatchData(data, query?.queryKey, queryKey),
    };
  };
  const observer = new QueryObserver<{ patch: string }>(client, options(reader()));
  const unsubscribe = observer.subscribe(() => {});
  observer.setOptions(options(reader("a.go", "second")));
  assert.equal(observer.getCurrentResult().data, oldPatch);
  assert.equal(observer.getCurrentResult().isLoading, false);
  assert.equal(observer.getCurrentResult().isPlaceholderData, true);
  finish({ patch: "new" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(observer.getCurrentResult().data, { patch: "new" });
  assert.equal(observer.getCurrentResult().isPlaceholderData, false);
  const nextKey = patchQueryKey("workspace", reader("b.go"), "all");
  observer.setOptions({ ...options(reader("b.go")), queryFn: () => new Promise(() => {}) });
  assert.equal(observer.getCurrentResult().data, undefined);
  assert.equal(observer.getCurrentResult().isLoading, true);
  assert.equal(
    retainPatchData(oldPatch, patchQueryKey("workspace", reader(), "all"), nextKey),
    undefined,
  );
  assert.equal(
    retainPatchData(
      oldPatch,
      patchQueryKey("workspace", reader(), "all"),
      patchQueryKey("workspace", reader(), "working"),
    ),
    undefined,
  );
  unsubscribe();
  client.clear();
});
