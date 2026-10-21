import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaSettings } from "../shared/contracts";

test("media settings migration preserves v1 preferences and fills new defaults", async () => {
  const migrated = await mediaSettings.migrate!({ enabled: false, previewCount: 6 }, 1);

  assert.deepEqual(migrated, {
    enabled: false,
    previewCount: 6,
    attachmentsEnabled: true,
    imageGesturesEnabled: true,
    sessionsEnabled: true,
    audioPlaybackEnabled: true,
  });
});

test("invalid saved media settings are rejected instead of silently reset", () => {
  assert.throws(() => mediaSettings.schema.parse({ enabled: false, previewCount: 0 }));
  assert.throws(() => mediaSettings.migrate!({ enabled: "false", previewCount: 4 }, 1));
  assert.throws(() => mediaSettings.migrate!({ enabled: false, previewCount: 9 }, 1));
});
