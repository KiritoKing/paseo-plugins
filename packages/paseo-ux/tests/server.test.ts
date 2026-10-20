import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assetId,
  catalogs,
  loadMedia,
  readAsset,
  readImageFile,
  readReferencedAsset,
} from "../server/media";

function timelinePage(options: {
  entries?: Array<{ item: unknown; timestamp?: string; seqStart: number; seqEnd?: number }>;
  epoch?: string;
  start?: number | null;
  end?: number | null;
  hasOlder?: boolean;
  cwd?: string;
  reset?: boolean;
  staleCursor?: boolean;
  gap?: boolean;
}) {
  const epoch = options.epoch ?? "epoch-1";
  const cursor = (seq: number | null) => (seq === null ? null : { epoch, seq });
  return {
    projection: "canonical",
    epoch,
    reset: options.reset ?? false,
    staleCursor: options.staleCursor ?? false,
    gap: options.gap ?? false,
    agent: { cwd: options.cwd ?? "/tmp" },
    entries: (options.entries ?? []).map((entry) => ({
      provider: "test",
      item: entry.item,
      timestamp: entry.timestamp ?? "2026-10-20T00:00:00.000Z",
      seqStart: entry.seqStart,
      seqEnd: entry.seqEnd ?? entry.seqStart,
      sourceSeqRanges: [],
      collapsed: [],
    })),
    startCursor: cursor(options.start ?? null),
    endCursor: cursor(options.end ?? null),
    hasOlder: options.hasOlder ?? false,
    hasNewer: false,
  };
}

function contextFor(pages: unknown[], cwd: string | null = "/tmp") {
  const requests: Array<Record<string, unknown>> = [];
  const ref = {
    cwd,
    refresh: async () => ({ agent: { cwd: cwd ?? "/refreshed" } }),
    timeline: {
      refetch: async (options: Record<string, unknown>) => {
        requests.push(options);
        const page = pages.shift();
        if (!page) throw new Error("unexpected timeline refetch");
        return page;
      },
    },
  };
  const context = { paseo: { agents: { ref: () => ref } } };
  return { context: context as never, requests };
}

test("media listing pages only canonical timeline entries and keeps first source metadata when older pages repeat it", async () => {
  catalogs.clear();
  const newer = timelinePage({
    start: 20,
    end: 30,
    hasOlder: true,
    entries: [
      {
        item: { type: "user_message", text: "![photo](/tmp/photo.png)" },
        timestamp: "newest-source",
        seqStart: 20,
      },
      { item: { type: "assistant_message", text: "[web](https://example.com)" }, seqStart: 30 },
    ],
  });
  const older = timelinePage({
    start: 2,
    end: 19,
    hasOlder: false,
    entries: [
      {
        item: { type: "assistant_message", text: "![duplicate](photo.png)" },
        timestamp: "older-duplicate",
        seqStart: 8,
      },
      {
        item: { type: "assistant_message", text: "[PDF](/tmp/report.pdf)" },
        timestamp: "pdf-time",
        seqStart: 9,
      },
      {
        item: {
          type: "tool_call",
          detail: { type: "file", mimeType: "application/octet-stream", path: "/tmp/no-extension" },
        },
        timestamp: "tool-time",
        seqStart: 10,
      },
    ],
  });
  const { context, requests } = contextFor([newer, older]);
  try {
    const first = await loadMedia({ agentId: "paged-agent" }, context);
    assert.equal(first.assets.length, 1);
    assert.equal(first.assets[0]?.timestamp, "newest-source");
    assert.equal(first.assets[0]?.mimeType, "image/png");
    assert.equal(first.assets[0]?.bytes, null);
    assert.equal(first.hasOlder, true);
    assert.deepEqual(first.cursor, { epoch: "epoch-1", seq: 20 });
    const second = await loadMedia({ agentId: "paged-agent", cursor: first.cursor! }, context);
    assert.deepEqual(
      second.assets.map((asset) => [asset.kind, asset.mimeType, asset.timestamp]),
      [
        ["image", "image/png", "newest-source"],
        ["document", "application/pdf", "pdf-time"],
        ["file", "application/octet-stream", "tool-time"],
      ],
    );
    assert.equal(second.hasOlder, false);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.direction, "tail");
    assert.equal(requests[0]?.projection, "canonical");
    assert.equal(requests[1]?.direction, "before");
    assert.deepEqual(requests[1]?.cursor, first.cursor);
  } finally {
    catalogs.clear();
  }
});

test("listing rejects a cursor from a replaced canonical timeline epoch", async () => {
  catalogs.clear();
  const { context } = contextFor([timelinePage({ epoch: "epoch-2", start: 4, entries: [] })]);
  await assert.rejects(
    () => loadMedia({ agentId: "stale-agent", cursor: { epoch: "epoch-1", seq: 5 } }, context),
    /历史已更新/,
  );
});

test("media reads require a listed asset owned by the same agent and never fetch a remote URL", async () => {
  catalogs.clear();
  const id = assetId("/tmp/private.png");
  await assert.rejects(
    () => readAsset({ agentId: "not-listed", assetId: id }, contextFor([]).context),
    /先刷新/,
  );
  catalogs.set("a", {
    cwd: "/tmp",
    epoch: "1",
    updated: Date.now(),
    assets: new Map([
      [
        id,
        {
          id,
          source: "https://example.com/photo.png",
          label: "photo",
          kind: "image",
          mimeType: "image/png",
          bytes: null,
          preview: "external",
          origin: "assistant",
          seq: 1,
          timestamp: "2026-10-12",
        },
      ],
    ]),
  });
  try {
    await assert.rejects(
      () => readAsset({ agentId: "b", assetId: id }, contextFor([]).context),
      /先刷新/,
    );
    assert.equal(
      (
        await readAsset(
          { agentId: "a", assetId: id },
          contextFor([timelinePage({ epoch: "1" })]).context,
        )
      ).uri,
      "https://example.com/photo.png",
    );
  } finally {
    catalogs.clear();
  }
});

test("bounds image and portable audio reads, verifies exact readback, and rejects unsupported local file types", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-essentials-test-"));
  catalogs.clear();
  try {
    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(dir, "a.png"), imageBytes);
    const image = await readImageFile(join(dir, "a.png"));
    assert.equal(image.bytes, imageBytes.length);
    assert.equal(image.uri, `data:image/png;base64,${imageBytes.toString("base64")}`);

    const audioBytes = Buffer.from("portable-audio");
    await writeFile(join(dir, "clip.mp3"), audioBytes);
    const id = assetId(join(dir, "clip.mp3"));
    catalogs.set("audio-agent", {
      cwd: dir,
      epoch: "1",
      updated: Date.now(),
      assets: new Map([
        [
          id,
          {
            id,
            source: join(dir, "clip.mp3"),
            label: "clip.mp3",
            kind: "audio",
            mimeType: "audio/mpeg",
            bytes: audioBytes.length,
            preview: "audio",
            origin: "assistant",
            seq: 1,
            timestamp: "2026-10-20",
          },
        ],
      ]),
    });
    const audio = await readAsset(
      { agentId: "audio-agent", assetId: id },
      contextFor([timelinePage({ epoch: "1", cwd: dir })], dir).context,
    );
    assert.equal(audio.bytes, audioBytes.length);
    assert.equal(audio.uri, `data:audio/mpeg;base64,${audioBytes.toString("base64")}`);

    await writeFile(join(dir, "secret.json"), "{}");
    await assert.rejects(() => readImageFile(join(dir, "secret.json")), /不支持/);
    await writeFile(join(dir, "large.png"), Buffer.alloc(16 * 1024 * 1024 + 1));
    await assert.rejects(() => readImageFile(join(dir, "large.png")), /16 MiB/);
  } finally {
    catalogs.clear();
    await rm(dir, { recursive: true, force: true });
  }
});

test("readReferencedAsset searches earlier canonical pages before authorizing an exact source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-essentials-resolve-"));
  catalogs.clear();
  try {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=",
      "base64",
    );
    const source = join(dir, "historical.png");
    await writeFile(source, bytes);
    const { context, requests } = contextFor(
      [
        timelinePage({
          start: 80,
          end: 90,
          hasOlder: true,
          cwd: dir,
          entries: [{ item: { type: "assistant_message", text: "recent" }, seqStart: 90 }],
        }),
        timelinePage({
          start: 12,
          end: 79,
          hasOlder: false,
          cwd: dir,
          entries: [{ item: { type: "user_message", text: `![older](${source})` }, seqStart: 12 }],
        }),
      ],
      dir,
    );
    const result = await readReferencedAsset({ agentId: "history-agent", source }, context);
    assert.equal(result.bytes, bytes.length);
    assert.equal(result.uri, `data:image/png;base64,${bytes.toString("base64")}`);
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.direction, "before");
    assert.deepEqual(requests[1]?.cursor, { epoch: "epoch-1", seq: 80 });
  } finally {
    catalogs.clear();
    await rm(dir, { recursive: true, force: true });
  }
});

test("readReferencedAsset rejects unlisted sources, replaced epochs, and non-advancing history cursors", async () => {
  const absent = contextFor([
    timelinePage({
      start: 4,
      entries: [{ item: { type: "assistant_message", text: "no attachment" }, seqStart: 4 }],
    }),
  ]);
  await assert.rejects(
    () =>
      readReferencedAsset({ agentId: "absent-agent", source: "/tmp/secret.png" }, absent.context),
    /不在此会话/,
  );

  const replaced = contextFor([
    timelinePage({ epoch: "epoch-1", start: 8, hasOlder: true }),
    timelinePage({ epoch: "epoch-2", start: 3, hasOlder: false }),
  ]);
  await assert.rejects(
    () =>
      readReferencedAsset(
        { agentId: "replaced-agent", source: "/tmp/secret.png" },
        replaced.context,
      ),
    /历史已更新/,
  );

  const stalled = contextFor([
    timelinePage({ start: 8, hasOlder: true }),
    timelinePage({ start: 8, hasOlder: true }),
  ]);
  await assert.rejects(
    () =>
      readReferencedAsset({ agentId: "stalled-agent", source: "/tmp/secret.png" }, stalled.context),
    /游标没有向更早/,
  );
});

test("canonical history without an agent snapshot resolves cwd through the public agent handle", async () => {
  catalogs.clear();
  const source = "https://example.com/sample.png";
  const page = {
    ...timelinePage({
      entries: [{ item: { type: "assistant_message", text: `![sample](${source})` }, seqStart: 2 }],
    }),
    agent: undefined,
  };
  const listContext = contextFor([page], null);
  const listed = await loadMedia({ agentId: "metadata-agent" }, listContext.context);
  assert.equal(listed.assets.length, 1);
  assert.equal(catalogs.get("metadata-agent")?.cwd, "/refreshed");
  const resolveContext = contextFor([page], null);
  assert.equal(
    (await readReferencedAsset({ agentId: "metadata-agent", source }, resolveContext.context)).uri,
    source,
  );
  catalogs.clear();
});

test("a cached attachment is refused after canonical history replacement", async () => {
  catalogs.clear();
  const source = "https://example.com/old.png";
  const indexed = timelinePage({
    entries: [{ item: { type: "user_message", text: `![old](${source})` }, seqStart: 3 }],
  });
  const { assets } = await loadMedia({ agentId: "changed-agent" }, contextFor([indexed]).context);
  const replacement = contextFor([timelinePage({ epoch: "epoch-2" })]);
  await assert.rejects(
    () => readAsset({ agentId: "changed-agent", assetId: assets[0]!.id }, replacement.context),
    /history changed/,
  );
  assert.equal(catalogs.has("changed-agent"), false);
  assert.equal(replacement.requests[0]?.limit, 1);
});
