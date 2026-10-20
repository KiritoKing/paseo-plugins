import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetId, readImageFile, readAsset, catalogs } from "../server/media";

test("media read cannot request arbitrary unlisted paths or cross-agent assets", async () => {
  const id = assetId("/tmp/private.png");
  await assert.rejects(() => readAsset({ agentId: "not-listed", assetId: id }), /先刷新/);
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
          origin: "assistant",
          seq: 1,
          timestamp: "2026-10-12",
        },
      ],
    ]),
  });
  await assert.rejects(() => readAsset({ agentId: "b", assetId: id }), /先刷新/);
  assert.equal(
    (await readAsset({ agentId: "a", assetId: id })).uri,
    "https://example.com/photo.png",
  );
  catalogs.clear();
});
test("bounds file preview size and rejects non-images, with exact image readback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-ux-test-"));
  try {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(dir, "a.png"), bytes);
    const image = await readImageFile(join(dir, "a.png"));
    assert.equal(image.bytes, bytes.length);
    assert.equal(image.uri, `data:image/png;base64,${bytes.toString("base64")}`);
    await writeFile(join(dir, "secret.json"), "{}");
    await assert.rejects(() => readImageFile(join(dir, "secret.json")), /不支持/);
    await writeFile(join(dir, "large.png"), Buffer.alloc(16 * 1024 * 1024 + 1));
    await assert.rejects(() => readImageFile(join(dir, "large.png")), /16 MiB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
