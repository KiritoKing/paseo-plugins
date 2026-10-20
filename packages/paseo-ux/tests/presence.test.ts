import assert from "node:assert/strict";
import { test } from "node:test";
import { type AttachmentPresence, createAttachmentPresence } from "../client/attachment-presence";
import type { MediaAsset, MediaCursor } from "../shared/contracts";

type Page = {
  assets: MediaAsset[];
  hasOlder: boolean;
  cursor: MediaCursor | null;
  epoch: string;
};

type Request = { agentId: string; cursor?: MediaCursor };
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function page(changes: Partial<Page> = {}): Page {
  return { assets: [], hasOlder: false, cursor: null, epoch: "epoch-1", ...changes };
}

const attachment: MediaAsset = {
  id: "asset-1",
  source: "/history/image.png",
  label: "image.png",
  kind: "image",
  mimeType: "image/png",
  bytes: 12,
  preview: "image",
  timestamp: "2026-10-20T00:00:00Z",
  origin: "user",
  seq: 10,
};

async function eventLoopTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("empty newest page still checks older pages before declaring attachments present", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests: Request[] = [];
  const pending: Deferred<Page>[] = [];
  const events: AttachmentPresence[] = [];
  const presence = createAttachmentPresence(
    (input) => {
      requests.push(input);
      const request = deferred<Page>();
      pending.push(request);
      return request.promise;
    },
    (_id, state) => events.push(state),
  );

  try {
    presence.invalidate("agent");
    t.mock.timers.tick(0);
    assert.equal(requests.length, 1);
    pending[0].resolve(page({ hasOlder: true, cursor: { epoch: "epoch-1", seq: 7 } }));
    await eventLoopTurn();

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].cursor, { epoch: "epoch-1", seq: 7 });
    pending[1].resolve(page({ assets: [attachment], epoch: "epoch-1" }));
    await eventLoopTurn();

    assert.deepEqual(presence.get("agent"), { status: "present", hasAttachments: true });
    assert.equal(events.at(-1)?.status, "present");
  } finally {
    presence.dispose();
  }
});

test("a fully empty history is marked empty only after the older page is checked", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let call = 0;
  const presence = createAttachmentPresence(
    async () => {
      call++;
      return call === 1
        ? page({ hasOlder: true, cursor: { epoch: "epoch-1", seq: 4 } })
        : page({ epoch: "epoch-1" });
    },
    () => {},
  );

  try {
    presence.invalidate("agent");
    t.mock.timers.tick(0);
    await eventLoopTurn();

    assert.equal(call, 2);
    assert.deepEqual(presence.get("agent"), { status: "empty", hasAttachments: false });
  } finally {
    presence.dispose();
  }
});

test("fetch errors retain a previously discovered attachment state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let call = 0;
  const pending = deferred<Page>();
  const presence = createAttachmentPresence(
    () => {
      call++;
      return call === 1 ? Promise.resolve(page({ assets: [attachment] })) : pending.promise;
    },
    () => {},
  );

  try {
    presence.invalidate("agent");
    t.mock.timers.tick(0);
    await eventLoopTurn();
    assert.deepEqual(presence.get("agent"), { status: "present", hasAttachments: true });

    presence.invalidate("agent");
    t.mock.timers.tick(0);
    assert.equal(call, 2);
    pending.reject(new Error("network unavailable"));
    await eventLoopTurn();

    assert.deepEqual(presence.get("agent"), {
      status: "error",
      hasAttachments: true,
      error: "network unavailable",
    });
  } finally {
    presence.dispose();
  }
});

test("a stale response cannot overwrite a newer generation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending: Deferred<Page>[] = [];
  const events: AttachmentPresence[] = [];
  const presence = createAttachmentPresence(
    () => {
      const request = deferred<Page>();
      pending.push(request);
      return request.promise;
    },
    (_id, state) => events.push(state),
  );

  try {
    presence.invalidate("agent");
    t.mock.timers.tick(0);
    presence.invalidate("agent");
    t.mock.timers.tick(0);
    assert.equal(pending.length, 2);

    pending[1].resolve(page());
    await eventLoopTurn();
    const latestState = presence.get("agent");
    const eventCount = events.length;
    assert.deepEqual(latestState, { status: "empty", hasAttachments: false });

    pending[0].resolve(page({ assets: [attachment] }));
    await eventLoopTurn();
    assert.deepEqual(presence.get("agent"), latestState);
    assert.equal(events.length, eventCount);
  } finally {
    presence.dispose();
  }
});

test("removing an agent prevents an in-flight response from writing state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<Page>();
  const events: AttachmentPresence[] = [];
  const presence = createAttachmentPresence(
    () => pending.promise,
    (_id, state) => events.push(state),
  );

  presence.invalidate("agent");
  t.mock.timers.tick(0);
  const eventCount = events.length;
  presence.remove("agent");
  pending.resolve(page({ assets: [attachment] }));
  await eventLoopTurn();

  assert.equal(presence.get("agent"), undefined);
  assert.equal(events.length, eventCount);
  presence.dispose();
});

test("disposing prevents in-flight responses from writing state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<Page>();
  const events: AttachmentPresence[] = [];
  const presence = createAttachmentPresence(
    () => pending.promise,
    (_id, state) => events.push(state),
  );

  presence.invalidate("agent");
  t.mock.timers.tick(0);
  const eventCount = events.length;
  presence.dispose();
  pending.resolve(page({ assets: [attachment] }));
  await eventLoopTurn();

  assert.equal(presence.get("agent"), undefined);
  assert.equal(events.length, eventCount);
});

test("an epoch change is surfaced as a visible failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let call = 0;
  const presence = createAttachmentPresence(
    async () => {
      call++;
      return call === 1
        ? page({ hasOlder: true, cursor: { epoch: "epoch-1", seq: 2 }, epoch: "epoch-1" })
        : page({ hasOlder: true, cursor: { epoch: "epoch-2", seq: 2 }, epoch: "epoch-2" });
    },
    () => {},
  );

  try {
    presence.invalidate("agent");
    t.mock.timers.tick(0);
    await eventLoopTurn();

    assert.equal(call, 2);
    assert.equal(presence.get("agent")?.status, "error");
    assert.match(presence.get("agent")?.error ?? "", /epoch/i);
  } finally {
    presence.dispose();
  }
});

test("a cursor that does not advance is surfaced as an error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let call = 0;
  const stalledCursor = { epoch: "epoch-1", seq: 3 };
  const presence = createAttachmentPresence(
    async () => {
      call++;
      return page({ hasOlder: true, cursor: stalledCursor });
    },
    () => {},
    { pagesPerBatch: 2 },
  );

  try {
    presence.invalidate("agent");
    t.mock.timers.tick(0);
    await eventLoopTurn();

    assert.equal(call, 2);
    assert.deepEqual(presence.get("agent"), {
      status: "error",
      hasAttachments: false,
      error: "Attachment history cursor did not advance.",
    });
  } finally {
    presence.dispose();
  }
});
