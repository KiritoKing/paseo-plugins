// Synthetic host APIs only. React Native Web primitives and production components
// are real; this fixture cannot prove Paseo, iOS or Android acceptance.
import { useCallback, useSyncExternalStore } from "react";
import {
  FlatList,
  Modal as NativeModal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { featureValuesSchema, type MediaAsset } from "../../shared/contracts";
import {
  fixture as conversationFixture,
  useSettings as useAppearanceSettings,
} from "./conversation/host";

export { FlatList, ScrollView, TextInput };

const canvas = document.createElement("canvas");
canvas.width = 1600;
canvas.height = 1000;
const context = canvas.getContext("2d")!;
context.fillStyle = "#dbeafe";
context.fillRect(0, 0, 1600, 1000);
context.fillStyle = "#2563eb";
context.fillRect(80, 80, 1440, 840);
context.fillStyle = "#fff";
context.font = "bold 84px sans-serif";
context.fillText("Essentials sample", 200, 520);
export const sampleImage = canvas.toDataURL("image/png");
const listeners = new Set<() => void>();
const observers = new Set<{
  snapshot: (value: unknown) => void;
  update: (value: unknown) => void;
}>();
const agentObservers = new Set<(value: unknown) => void>();
const timelineObservers = new Set<(value: unknown) => void>();
let revision = 1;
let saveError: string | null = null;
let failNext = false;
let delayedAgent: string | undefined;
let values = featureValuesSchema.parse({});
let snapshot = makeSnapshot();
function emit() {
  snapshot = makeSnapshot();
  for (const listener of listeners) listener();
}
function makeSnapshot() {
  return {
    status: "ready" as const,
    values,
    revision: String(revision),
    saving: false,
    saveError,
    async save(next: typeof values, expected: string) {
      if (expected !== String(revision)) {
        saveError = "Preferences changed elsewhere. Reload saved values.";
        emit();
        return false;
      }
      values = featureValuesSchema.parse(next);
      revision++;
      saveError = null;
      emit();
      for (const observer of observers)
        observer.update({
          type: "status",
          payload: { status: "plugin_settings_changed", settingsId: "media" },
        });
      return true;
    },
    async reset() {
      values = featureValuesSchema.parse({});
      revision++;
      saveError = null;
      emit();
      return true;
    },
    async reload() {
      saveError = null;
      emit();
    },
  };
}
function useMediaSettings() {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => snapshot,
  );
}
export function useSettings(definition?: { id: string }) {
  const media = useMediaSettings();
  const appearance = useAppearanceSettings();
  return definition?.id === "appearance" ? appearance : media;
}
export function useAgent() {
  return { title: "Synthetic conversation" };
}
export function usePaseo() {
  return fakePaseo;
}
export function useRpc(contract: { name: string }) {
  return useCallback((input: unknown) => rpc(contract, input), [contract]);
}
export async function openExternalUrl() {
  /* Never open a real external site in this fixture. */
}
export async function copyText() {
  /* Preserve the user's clipboard in this fixture. */
}
export function useRevealedText(text: string) {
  return text;
}
export function useToast() {
  return { show() {}, error() {} };
}
export function Icon({ name, color, size = 20 }: { name: string; color: string; size: number }) {
  return (
    <Text style={{ color, fontSize: size }} accessibilityLabel={name}>
      ◇
    </Text>
  );
}
export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 17, fontWeight: "600" }}>{title}</Text>
      {children}
    </View>
  );
}
export function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ gap: 16, padding: 16, backgroundColor: "#f1f5f9", borderRadius: 10 }}>
      {children}
    </View>
  );
}
export function SettingsSwitch({
  label,
  hint,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text>{label}</Text>
        <Text style={{ fontSize: 12, color: "#475569" }}>{hint}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      />
    </View>
  );
}
export function SettingsSelect({
  label,
  value,
  options,
  onValueChange,
  disabled,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onValueChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text>{label}</Text>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </View>
  );
}
export function SettingsAction({
  label,
  actionLabel,
  onPress,
  disabled,
}: {
  label: string;
  actionLabel: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 10 }}
    >
      <Text>{actionLabel}</Text>
    </Pressable>
  );
}
export function Modal({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <NativeModal visible={open} transparent onRequestClose={() => onOpenChange(false)}>
      <View
        style={{
          flex: 1,
          padding: 24,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0006",
        }}
      >
        <View
          style={{ maxWidth: 560, width: "100%", padding: 16, gap: 12, backgroundColor: "#fff" }}
        >
          <Text>{title}</Text>
          {children}
        </View>
      </View>
    </NativeModal>
  );
}
Modal.Content = function Content({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: 12 }}>{children}</View>;
};
const baseAsset = {
  timestamp: "2026-10-20T00:00:00Z",
  origin: "assistant" as const,
  seq: 10,
  bytes: 4096,
  mimeType: null,
};
export const assets: MediaAsset[] = [
  {
    id: "img1",
    source: "sample-one.png",
    label: "Landscape image",
    kind: "image",
    preview: "image",
    ...baseAsset,
  },
  {
    id: "img2",
    source: "sample-two.png",
    label: "Second image",
    kind: "image",
    preview: "image",
    ...baseAsset,
  },
  {
    id: "video",
    source: "sample.mp4",
    label: "Product walkthrough.mp4",
    kind: "video",
    preview: "none",
    ...baseAsset,
  },
  {
    id: "audio",
    source: "sample.wav",
    label: "Welcome.wav",
    kind: "audio",
    preview: "audio",
    ...baseAsset,
  },
  {
    id: "doc",
    source: "guide.pdf",
    label: "Guide.pdf",
    kind: "document",
    preview: "none",
    ...baseAsset,
  },
  {
    id: "file",
    source: "export.bin",
    label: "Export.bin",
    kind: "file",
    preview: "none",
    ...baseAsset,
  },
];
let emptyHasMedia = false;
export const agent = (id: string) => ({
  id,
  workspaceId: "synthetic-workspace",
  updatedAt: String(revision),
});
export function addFirstAttachment() {
  emptyHasMedia = true;
  revision++;
  for (const observer of agentObservers) observer({ kind: "upsert", agent: agent("empty") });
  for (const observer of timelineObservers) observer({ event: { type: "turn_completed" } });
}
export function failHistory() {
  failNext = true;
}
export function delayNextHistory(agentId: string) {
  delayedAgent = agentId;
}
export const fakePaseo = {
  observeEvents() {
    return {
      ready: Promise.resolve({}),
      subscribe(observer: typeof observers extends Set<infer T> ? T : never) {
        observers.add(observer);
        queueMicrotask(() => observer.snapshot({}));
        return () => observers.delete(observer);
      },
      async release() {
        observers.clear();
      },
    };
  },
  agents: {
    subscribe(callback: (value: unknown) => void) {
      agentObservers.add(callback);
      return () => agentObservers.delete(callback);
    },
    async list() {
      return {
        entries: ["sample", "empty", "older"].map((id) => ({ agent: agent(id) })),
        pageInfo: { hasMore: false },
        subscription: { async release() {} },
      };
    },
    ref() {
      return {
        timeline: {
          subscribe(callback: (value: unknown) => void) {
            timelineObservers.add(callback);
            const stop = Object.assign(() => timelineObservers.delete(callback), {
              ready: Promise.resolve(),
            });
            return stop;
          },
        },
      };
    },
  },
  workspaces: {
    subscribe() {
      return () => {};
    },
    async list() {
      return { entries: [{ id: "synthetic-workspace" }], subscription: { async release() {} } };
    },
  },
};
conversationFixture.subscribe(() => {
  for (const observer of observers)
    observer.update({
      type: "status",
      payload: { status: "plugin_settings_changed", settingsId: "appearance" },
    });
});
export async function rpc(contract: { name: string }, raw: unknown): Promise<unknown> {
  const input = raw as { agentId: string; assetId: string; cursor?: unknown };
  if (contract.name === "features.read") return values;
  if (contract.name === "settings.appearance.read")
    return { status: "ready", revision: "fixture", values: conversationFixture.values };
  if (contract.name === "media.list") {
    if (failNext) {
      failNext = false;
      throw new Error("Synthetic history unavailable. Retry.");
    }
    const empty = input.agentId === "empty" && !emptyHasMedia;
    const firstOlder = input.agentId === "older" && !input.cursor;
    const page = {
      assets: empty || firstOlder ? [] : assets,
      hasOlder: firstOlder,
      cursor: firstOlder ? { epoch: "demo", seq: 4 } : null,
      epoch: "demo",
    };
    if (delayedAgent === input.agentId) {
      delayedAgent = undefined;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    return page;
  }
  if (contract.name === "media.read" || contract.name === "media.resolve")
    return input.assetId === "audio"
      ? { uri: "data:audio/wav;base64,UklGRg==", mimeType: "audio/wav", bytes: 4 }
      : { uri: sampleImage, mimeType: "image/png", bytes: 4096 };
  if (contract.name === "sessions.list")
    return { workspaceName: "Synthetic workspace", sessions: [] };
  throw new Error("Unknown synthetic RPC " + contract.name);
}
