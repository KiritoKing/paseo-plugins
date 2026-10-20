import {
  openExternalUrl,
  type PluginAgentPanelProps,
  useAgent,
  usePaseo,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import { copyText, FlatList, Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import {
  type FeatureValues,
  listMedia,
  type MediaAsset,
  type MediaCursor,
  mediaSettings,
  readMedia,
} from "../shared/contracts";
import { ImagePreview } from "./preview";

type PanelProps = PluginAgentPanelProps & {
  playAudio?: (source: { base64: string; mimeType: string }) => Promise<void>;
  onOpenSettings?: () => void;
};
const kindLabels = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  document: "Documents",
  file: "Files",
};
const kindIcons = {
  image: "Image",
  video: "Video",
  audio: "Music",
  document: "FileText",
  file: "File",
};

export function MediaPanel(props: PanelProps) {
  const state = useSettings(mediaSettings);
  if (state.status !== "ready" || !state.values.attachmentsEnabled)
    return (
      <View style={{ padding: 20, gap: 16 }}>
        <Text style={{ color: props.theme.colors.foreground }}>
          {state.status === "loading"
            ? "Loading preferences…"
            : state.status !== "ready"
              ? state.error
              : "Conversation attachments are turned off."}
        </Text>
        {state.status !== "loading" ? (
          <Pressable
            accessibilityRole="button"
            onPress={props.onOpenSettings}
            style={{ padding: 12 }}
          >
            <Text style={{ color: props.theme.colors.accent }}>Open Essentials Features</Text>
          </Pressable>
        ) : null}
      </View>
    );
  return <Attachments {...props} features={state.values} />;
}

function Attachments(props: PanelProps & { features: FeatureValues }) {
  const { agentId, host, theme, layout, features } = props;
  const agent = useAgent(agentId, ({ title }) => ({ title }));
  const paseo = usePaseo();
  const list = useRpc(listMedia);
  const read = useRpc(readMedia);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [cursor, setCursor] = useState<MediaCursor | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const epoch = useRef("");
  const oldest = useRef<MediaCursor | null>(null);
  const generation = useRef(0);
  const historyRevision = useRef(0);
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<MediaAsset["kind"] | "all">("all");
  const [preview, setPreview] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const playingRef = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mergePage = (page: Awaited<ReturnType<typeof list>>, older: boolean) => {
    const reset = !!epoch.current && epoch.current !== page.epoch;
    setAssets((previous) => (reset ? page.assets : mergeAssets(previous, page.assets)));
    epoch.current = page.epoch;
    if (older || reset || !oldest.current) {
      oldest.current = page.cursor;
      setCursor(page.cursor);
      setHasOlder(page.hasOlder);
    }
    if (reset) setPreview(null);
    setError("");
  };
  const mergeRef = useRef(mergePage);
  mergeRef.current = mergePage;
  useEffect(() => {
    const current = ++generation.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (disposed || inFlight.current) return;
      const revision = historyRevision.current;
      inFlight.current = true;
      try {
        const page = await list({ agentId });
        if (!disposed && revision === historyRevision.current) mergeRef.current(page, false);
      } catch (cause) {
        if (!disposed && revision === historyRevision.current) setError(message(cause));
      } finally {
        if (!disposed && revision === historyRevision.current) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    };
    inFlight.current = false;
    epoch.current = "";
    oldest.current = null;
    setAssets([]);
    setCursor(null);
    setLoading(true);
    setError("");
    setPreview(null);
    setSearch("");
    setKind("all");
    void refresh();
    const stop = paseo.agents.ref(agentId).timeline.subscribe((event) => {
      if (disposed || current !== generation.current) return;
      if (event.event.type === "error") {
        setError("Conversation connection interrupted. Refresh to retry.");
        return;
      }
      if (event.event.type === "replacement") {
        historyRevision.current++;
        inFlight.current = false;
        epoch.current = "";
        oldest.current = null;
        setAssets([]);
        setCursor(null);
        setHasOlder(false);
        setPreview(null);
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, 600);
    });
    void stop.ready.catch(() => {
      if (!disposed) setError("Live attachment updates are unavailable. Refresh to retry.");
    });
    return () => {
      disposed = true;
      generation.current++;
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [agentId, host.id, list, paseo]);

  const reload = async (older = false) => {
    if (inFlight.current) return;
    const current = generation.current;
    const revision = historyRevision.current;
    inFlight.current = true;
    setLoading(true);
    try {
      const page = await list({ agentId, ...(older && cursor ? { cursor } : {}) });
      if (current === generation.current && revision === historyRevision.current)
        mergePage(page, older);
    } catch (cause) {
      if (current === generation.current && revision === historyRevision.current)
        setError(message(cause));
    } finally {
      if (current === generation.current && revision === historyRevision.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  };
  const filtered = useMemo(
    () =>
      assets
        .filter(
          (asset) =>
            (kind === "all" || asset.kind === kind) &&
            (asset.label + " " + asset.source).toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => b.seq - a.seq),
    [assets, search, kind],
  );
  const images = filtered.filter(
    (asset) => asset.kind === "image" && ["image", "external"].includes(asset.preview),
  );
  const selected = images.findIndex((asset) => asset.id === preview);
  const resolve = async (image: { source: string }) => {
    const asset = images.find((asset) => asset.source === image.source);
    if (!asset) throw new Error("The image is no longer in this list.");
    return (await read({ agentId, assetId: asset.id })).uri;
  };
  const play = async (asset: MediaAsset) => {
    if (playingRef.current || !features.audioPlaybackEnabled || !props.playAudio) return;
    const current = generation.current;
    playingRef.current = true;
    setPlaying(asset.id);
    setError("");
    try {
      const data = await read({ agentId, assetId: asset.id });
      const comma = data.uri.indexOf(",");
      if (
        !data.uri.startsWith("data:") ||
        !data.uri.slice(0, comma).endsWith(";base64") ||
        !data.mimeType.startsWith("audio/")
      )
        throw new Error("This audio source cannot be played here.");
      if (current !== generation.current) return;
      await props.playAudio({ base64: data.uri.slice(comma + 1), mimeType: data.mimeType });
    } catch (cause) {
      if (current === generation.current) setError(message(cause));
    } finally {
      playingRef.current = false;
      if (mounted.current) setPlaying(null);
    }
  };
  const openSource = async (source: string) => {
    try {
      await openExternalUrl(source);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const copy = async (source: string) => {
    try {
      await copyText(source);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const columns = layout.compact ? 1 : 2;
  const kinds = (Object.keys(kindLabels) as Array<MediaAsset["kind"]>).filter((value) =>
    assets.some((asset) => asset.kind === value),
  );
  return (
    <View
      testID="essentials-attachments-panel"
      style={{ flex: 1, backgroundColor: theme.colors.surface0, padding: 16 }}
    >
      <FlatList
        key={columns}
        data={filtered}
        numColumns={columns}
        style={{ flex: 1, minHeight: 0 }}
        initialNumToRender={10}
        windowSize={3}
        maxToRenderPerBatch={6}
        keyExtractor={(asset) => asset.id}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "600" }}>
                  Conversation attachments
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
                >
                  {agent?.title ?? "Current conversation"}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh attachments"
                disabled={loading}
                onPress={() => void reload()}
                style={{ padding: 12 }}
              >
                <Icon name="RefreshCw" size={18} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {assets.length} attachments ·{" "}
              {hasOlder ? "More history available" : "All loaded history"}
            </Text>
            <TextInput
              accessibilityLabel="Search attachments"
              placeholder="Search name or source"
              placeholderTextColor={theme.colors.foregroundMuted}
              value={search}
              onChangeText={setSearch}
              style={{
                padding: 12,
                color: theme.colors.foreground,
                backgroundColor: theme.colors.surface1,
                borderColor: theme.colors.border,
                borderWidth: 1,
                borderRadius: 8,
              }}
            />
            {kinds.length > 1 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {(["all", ...kinds] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: kind === value }}
                    onPress={() => {
                      setKind(value);
                      setPreview(null);
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      backgroundColor:
                        kind === value ? theme.colors.surface2 : theme.colors.surface1,
                    }}
                  >
                    <Text
                      style={{
                        color: kind === value ? theme.colors.accent : theme.colors.foregroundMuted,
                      }}
                    >
                      {value === "all" ? "All" : kindLabels[value]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {error ? (
              <View
                style={{
                  padding: 12,
                  gap: 8,
                  backgroundColor: theme.colors.surface1,
                  borderRadius: 8,
                }}
              >
                <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
                  {error}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void reload()}
                  style={{ padding: 8 }}
                >
                  <Text style={{ color: theme.colors.accent }}>Retry</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <AttachmentTile
            asset={item}
            agentId={agentId}
            hostId={host.id}
            theme={theme}
            onPreview={() => setPreview(item.id)}
            onOpen={() => void openSource(item.source)}
            onCopy={() => void copy(item.source)}
            onPlay={() => void play(item)}
            audioEnabled={features.audioPlaybackEnabled && !!props.playAudio}
            playing={playing === item.id}
            audioBusy={!!playing}
          />
        )}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.foregroundMuted, padding: 24, textAlign: "center" }}>
            {loading
              ? "Reading conversation attachments…"
              : search || kind !== "all"
                ? "No matching attachments"
                : hasOlder
                  ? "No attachments in this part of the history. Load earlier history to continue."
                  : "This conversation has no attachments."}
          </Text>
        }
        ListFooterComponent={
          hasOlder ? (
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => void reload(true)}
              style={{ padding: 16, alignItems: "center" }}
            >
              <Text style={{ color: theme.colors.accent }}>
                {loading ? "Loading…" : "Load earlier attachments"}
              </Text>
            </Pressable>
          ) : null
        }
      />
      {selected >= 0 ? (
        <ImagePreview
          {...props}
          images={images.map((asset) => ({ source: asset.source, label: asset.label }))}
          index={selected}
          resolve={resolve}
          gesturesEnabled={features.imageGesturesEnabled}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </View>
  );
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : "The attachment action failed. Please retry.";
}
function mergeAssets(previous: MediaAsset[], next: MediaAsset[]) {
  const map = new Map(previous.map((asset) => [asset.id, asset]));
  for (const asset of next) map.set(asset.id, asset);
  return [...map.values()];
}
function formatBytes(bytes: number | null) {
  return bytes === null
    ? "Size unknown"
    : bytes < 1024
      ? bytes + " B"
      : bytes < 1024 * 1024
        ? (bytes / 1024).toFixed(1) + " KiB"
        : (bytes / 1024 / 1024).toFixed(1) + " MiB";
}
function AttachmentTile({
  asset,
  agentId,
  hostId,
  theme,
  onPreview,
  onPlay,
  onOpen,
  onCopy,
  audioEnabled,
  playing,
  audioBusy,
}: {
  asset: MediaAsset;
  agentId: string;
  hostId: string;
  theme: PluginAgentPanelProps["theme"];
  onPreview: () => void;
  onPlay: () => void;
  onOpen: () => void;
  onCopy: () => void;
  audioEnabled: boolean;
  playing: boolean;
  audioBusy: boolean;
}) {
  const read = useRpc(readMedia);
  const [failed, setFailed] = useState(false);
  const image = asset.kind === "image" && ["image", "external"].includes(asset.preview);
  const query = useQuery({
    queryKey: ["essentials-image", hostId, agentId, asset.id],
    queryFn: () => read({ agentId, assetId: asset.id }),
    enabled: image,
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
  });
  const external = /^https?:\/\//i.test(asset.source);
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 10, paddingHorizontal: 8, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: theme.colors.accent, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={{
        flex: 1,
        margin: 4,
        padding: 12,
        gap: 8,
        borderRadius: 9,
        borderColor: theme.colors.border,
        borderWidth: 1,
        backgroundColor: theme.colors.surface1,
      }}
    >
      {image ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"View " + asset.label}
          onPress={onPreview}
          style={{
            height: 140,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.surface2,
            borderRadius: 6,
          }}
        >
          {query.data && !failed ? (
            <View pointerEvents="none" style={{ width: "100%", height: "100%" }}>
              <Image
                source={{ uri: query.data.uri }}
                resizeMode="contain"
                style={{ width: "100%", height: "100%" }}
                onError={() => setFailed(true)}
              />
            </View>
          ) : (
            <View style={{ alignItems: "center", gap: 8 }}>
              <Icon
                name={failed || query.isError ? "ImageOff" : "Image"}
                size={24}
                color={theme.colors.foregroundMuted}
              />
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {failed || query.isError ? "Open to retry" : "Loading image…"}
              </Text>
            </View>
          )}
        </Pressable>
      ) : (
        <Icon name={kindIcons[asset.kind]} size={26} color={theme.colors.foregroundMuted} />
      )}
      <Text numberOfLines={2} style={{ color: theme.colors.foreground, fontWeight: "600" }}>
        {asset.label}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        {kindLabels[asset.kind]} · {formatBytes(asset.bytes)} · {asset.origin}
      </Text>
      <Text
        numberOfLines={2}
        selectable
        style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
      >
        {asset.source.startsWith("embedded:") ? "Embedded attachment" : asset.source}
      </Text>
      {!image ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {asset.preview === "audio"
            ? audioEnabled
              ? "Play on this device"
              : "Audio playback is turned off or unavailable."
            : asset.kind === "video"
              ? "Video collected. In-app playback is planned."
              : external
                ? "Open the original source externally."
                : "Preview is unavailable. This path belongs to the connected host."}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {image ? action("View image", onPreview) : null}
        {asset.preview === "audio"
          ? action(playing ? "Playing…" : "Play audio", onPlay, !audioEnabled || audioBusy)
          : null}
        {external ? action("Open source", onOpen) : null}
        {!asset.source.startsWith("embedded:") ? action("Copy source", onCopy) : null}
      </View>
    </View>
  );
}
