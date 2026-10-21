import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type FeatureValues, mediaSettings } from "../shared/contracts";

export function MediaSettings({
  theme,
  host,
  onChange,
}: PluginSurfaceProps & { onChange?: (values: FeatureValues) => void }) {
  const state = useSettings(mediaSettings);
  const [confirmReset, setConfirmReset] = useState(false);
  const readyValues = state.status === "ready" ? state.values : undefined;
  useEffect(() => {
    if (readyValues) onChange?.(readyValues);
  }, [readyValues, onChange]);
  const textStyle = { color: theme.colors.foregroundMuted };
  function resetDialog() {
    return (
      <Modal
        title="Restore Essentials defaults?"
        open={confirmReset}
        onOpenChange={setConfirmReset}
      >
        <Modal.Content>
          <Text style={{ color: theme.colors.foreground }}>
            This replaces Essentials preferences for all devices connected to {host.label}.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void state.reset().then((saved) => {
                if (saved) setConfirmReset(false);
              });
            }}
            style={{ padding: 14 }}
          >
            <Text style={{ color: theme.colors.accent }}>Restore defaults</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmReset(false)}
            style={{ padding: 14 }}
          >
            <Text style={{ color: theme.colors.foreground }}>Cancel</Text>
          </Pressable>
        </Modal.Content>
      </Modal>
    );
  }
  if (state.status === "loading")
    return <Text style={textStyle}>Loading Essentials settings…</Text>;
  if (state.status !== "ready")
    return (
      <View style={{ gap: 16 }}>
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
          {state.error}
        </Text>
        <Text style={textStyle}>
          Saved values are preserved. Reload to retry, or explicitly restore the defaults.
        </Text>
        <SettingsAction
          label="Reload settings"
          actionLabel="Retry"
          onPress={() => void state.reload()}
        />
        <SettingsAction
          label="Restore defaults"
          actionLabel="Restore…"
          onPress={() => setConfirmReset(true)}
        />
        {resetDialog()}
      </View>
    );

  const values = state.values;
  const save = (patch: Partial<FeatureValues>) => {
    void state.save({ ...values, ...patch }, state.revision);
  };
  return (
    <View style={{ gap: 24 }}>
      <Text style={textStyle}>
        Preferences apply to every device connected to {host.label}. Empty conversations do not show
        an attachment button.
      </Text>
      <SettingsSection title="Conversation attachments">
        <SettingsCard>
          <SettingsSwitch
            label="Attachments"
            hint="Collect images, videos, audio and files referenced in a conversation."
            value={values.attachmentsEnabled}
            onValueChange={(attachmentsEnabled) => save({ attachmentsEnabled })}
            disabled={state.saving}
          />
          <SettingsSwitch
            label="Audio playback"
            hint="Play supported local MP3 and WAV attachments. Video playback will follow in a later release."
            value={values.audioPlaybackEnabled}
            onValueChange={(audioPlaybackEnabled) => save({ audioPlaybackEnabled })}
            disabled={state.saving || !values.attachmentsEnabled}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Image viewing">
        <SettingsCard>
          <SettingsSwitch
            label="Group image-only messages"
            hint="Use compact galleries for complete messages containing only images. Mixed text stays in Paseo’s renderer."
            value={values.enabled}
            onValueChange={(enabled) => save({ enabled })}
            disabled={state.saving}
          />
          <SettingsSelect
            label="Visible thumbnails"
            value={String(values.previewCount)}
            options={Array.from({ length: 8 }, (_, i) => ({
              label: String(i + 1),
              value: String(i + 1),
            }))}
            onValueChange={(value) => save({ previewCount: Number(value) })}
            disabled={state.saving || !values.enabled}
          />
          <SettingsSwitch
            label="Image gestures"
            hint="Zoom, pan and reset within the image viewer. Viewing and navigation buttons remain available when disabled."
            value={values.imageGesturesEnabled}
            onValueChange={(imageGesturesEnabled) => save({ imageGesturesEnabled })}
            disabled={state.saving}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Workspace sessions">
        <SettingsCard>
          <SettingsSwitch
            label="Session history"
            hint="Browse this workspace’s sessions. Reopening a closed session uses the official Paseo CLI on the host."
            value={values.sessionsEnabled}
            onValueChange={(sessionsEnabled) => save({ sessionsEnabled })}
            disabled={state.saving}
          />
        </SettingsCard>
      </SettingsSection>
      {state.saveError ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
            {state.saveError}
          </Text>
          <SettingsAction
            label="Reload saved values"
            actionLabel="Reload"
            onPress={() => void state.reload()}
            disabled={state.saving}
          />
        </View>
      ) : null}
      <SettingsSection title="Defaults">
        <SettingsCard>
          <SettingsAction
            label="Restore preferences"
            actionLabel="Restore…"
            onPress={() => setConfirmReset(true)}
            disabled={state.saving}
          />
        </SettingsCard>
      </SettingsSection>
      {resetDialog()}
    </View>
  );
}
