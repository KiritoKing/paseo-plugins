import type { PluginHostProps } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { fittedViewport, type ImageViewport, zoomAt } from "../shared/viewport";
import { type InlineImage, mountImageGestures, mountImageNavigation } from "./web";

export function ImagePreview({
  images,
  index,
  onClose,
  theme,
  resolve,
}: PluginHostProps & {
  images: InlineImage[];
  index: number;
  onClose: () => void;
  resolve?: (image: InlineImage) => Promise<string>;
}) {
  const [selected, setSelected] = useState(index);
  const [viewport, setViewport] = useState<ImageViewport>(fittedViewport);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const viewportId = `paseo-ux-preview-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const zoom = viewport.zoom;
  const setZoom = (update: (zoom: number) => number) =>
    setViewport((state) => zoomAt(state, update(state.zoom) / state.zoom, { x: 0, y: 0 }));
  const reset = useCallback(() => {
    viewportRef.current = fittedViewport;
    setViewport(fittedViewport);
  }, []);
  const [failed, setFailed] = useState(false);
  const toast = useToast();
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const move = (offset: number) => {
    const next = Math.max(0, Math.min(images.length - 1, selectedRef.current + offset));
    if (!images.length || next === selectedRef.current) return;
    selectedRef.current = next;
    setSelected(next);
    reset();
    setFailed(false);
  };
  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    selectedRef.current = index;
    setSelected(index);
    reset();
    setFailed(false);
  }, [index, reset]);
  const image = images[selected];
  // Polling can replace image and resolver objects without changing the asset.
  // Keep the latest inputs while loading only on source/URI changes or retry.
  const loadRef = useRef({ image, resolve });
  loadRef.current = { image, resolve };
  const [uri, setUri] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const { image: asset, resolve: load } = loadRef.current;
    let live = true;
    setUri(asset?.uri ?? "");
    setLoadError("");
    setFailed(false);
    if (asset && !asset.uri && load) {
      void load(asset)
        .then((value) => {
          if (live) setUri(value);
        })
        .catch((error) => {
          if (live) setLoadError(error instanceof Error ? error.message : "图片读取失败");
        });
    }
    return () => {
      live = false;
    };
  }, [image?.source, image?.uri, retry]);
  useEffect(
    () =>
      mountImageGestures({
        id: viewportId,
        read: () => viewportRef.current,
        update: (state) => {
          viewportRef.current = state;
          setViewport(state);
        },
      }),
    [viewportId],
  );
  useEffect(
    () =>
      mountImageNavigation({
        id: viewportId,
        previous: () => moveRef.current(-1),
        next: () => moveRef.current(1),
      }),
    [viewportId],
  );
  useEffect(() => reset(), [image?.source, reset]);
  if (!image) return null;
  const control = (label: string, icon: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={{ padding: 8, opacity: disabled ? 0.35 : 1, borderRadius: 8 }}
    >
      <Icon name={icon} color={theme.colors.foreground} size={18} />
    </Pressable>
  );
  return (
    <Modal
      title={`${image.label} · ${selected + 1} / ${images.length}`}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content
        scrollable={false}
        contentContainerStyle={{ padding: 12, gap: 12 }}
        style={{ backgroundColor: theme.colors.surface0 }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {control("上一张", "ChevronLeft", () => move(-1), selected === 0)}
            {control("下一张", "ChevronRight", () => move(1), selected === images.length - 1)}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {control(
              "缩小",
              "ZoomOut",
              () => setZoom((z) => Math.max(0.25, z / 1.25)),
              zoom <= 0.25,
            )}
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {Math.round(zoom * 100)}%
            </Text>
            {control("放大", "ZoomIn", () => setZoom((z) => Math.min(8, z * 1.25)), zoom >= 8)}
            {control("适应窗口", "Maximize", () => reset())}
            {control("复制图片路径", "Copy", () => {
              void copyText(image.source)
                .then(() => toast.show("已复制图片路径"))
                .catch(() => toast.error("复制失败"));
            })}
          </View>
        </View>
        <View
          testID={viewportId}
          style={{
            flex: 1,
            minHeight: 240,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {failed || loadError ? (
            <View style={{ gap: 12, padding: 20 }}>
              <Text style={{ color: theme.colors.foreground }}>{loadError || "图片加载失败"}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setFailed(false);
                  setRetry((value) => value + 1);
                }}
              >
                <Text style={{ color: theme.colors.accent }}>重试</Text>
              </Pressable>
            </View>
          ) : !uri ? (
            <Text style={{ color: theme.colors.foregroundMuted, padding: 32 }}>正在读取图片…</Text>
          ) : (
            <Image
              key={`${uri}:${retry}`}
              source={{ uri }}
              resizeMode="contain"
              style={{
                width: "100%",
                height: "100%",
                position: "absolute",
                transform: [
                  { translateX: viewport.x },
                  { translateY: viewport.y },
                  { scale: zoom },
                ],
              }}
              onError={() => setFailed(true)}
              accessibilityLabel={image.label}
            />
          )}
        </View>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          ← / → 切换 · 滚轮缩放 · 拖拽平移 · 双击复位
        </Text>
        <Text
          numberOfLines={1}
          selectable
          style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
        >
          {image.source.startsWith("data:") ? "内嵌图片" : image.source}
        </Text>
        <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
          {images.map((value, i) => (
            <Pressable
              // biome-ignore lint/suspicious/noArrayIndexKey: Repeated sources are distinct ordered image occurrences.
              key={`${value.source}:${i}`}
              accessibilityRole="button"
              accessibilityLabel={`查看第 ${i + 1} 张图片`}
              onPress={() => {
                setSelected(i);
                reset();
                setFailed(false);
              }}
              style={{
                borderWidth: 2,
                borderColor: selected === i ? theme.colors.accent : theme.colors.border,
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {value.uri ? (
                <Image
                  source={{ uri: value.uri }}
                  resizeMode="contain"
                  style={{ width: 52, height: 40 }}
                />
              ) : (
                <Text
                  style={{
                    color: theme.colors.foregroundMuted,
                    width: 52,
                    height: 40,
                    textAlign: "center",
                    paddingTop: 12,
                  }}
                >
                  {i + 1}
                </Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </Modal.Content>
    </Modal>
  );
}
