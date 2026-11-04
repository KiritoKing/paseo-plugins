import type { PluginHostProps } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import {
  clampViewport,
  fittedViewport,
  type ImageViewport,
  type ViewportBounds,
  zoomAt,
} from "../shared/viewport";
import { createImagePanResponder, type ImageGestureActions } from "./image-gestures";
import { DesktopKeySurface, DesktopZoomSurface } from "./web";

export type PreviewImage = { source: string; label: string; uri?: string };
export function imageEntries(images: readonly PreviewImage[]) {
  const occurrences = new Map<string, number>();
  return images.map((image) => {
    const identity = JSON.stringify([image.source, image.label]);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return { image, key: `${identity}:${occurrence}` };
  });
}
type ImagePreviewProps = PluginHostProps & {
  images: PreviewImage[];
  index: number;
  onClose: () => void;
  resolve?: (image: PreviewImage) => Promise<string>;
  gesturesEnabled?: boolean;
};

export function ImagePreview({
  images,
  index,
  onClose,
  theme,
  resolve,
  gesturesEnabled = true,
}: ImagePreviewProps) {
  const [selected, setSelected] = useState(index);
  const selectedIndex = Math.max(0, Math.min(images.length - 1, selected));
  const image = images[selectedIndex];
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;
  const selectedImageRef = useRef(image);
  selectedImageRef.current = image;
  const [viewport, setViewport] = useState<ImageViewport>(fittedViewport);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [bounds, setBounds] = useState<ViewportBounds>({
    width: 0,
    height: 0,
    imageWidth: 0,
    imageHeight: 0,
  });
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const [resolved, setResolved] = useState({ key: "", uri: "" });
  const [loadError, setLoadError] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([selectedIndex, image?.source, image?.uri, retry]);
  // Never mount a previous attempt's URI while the current resolver is pending.
  const uri = image?.uri || (resolved.key === requestKey ? resolved.uri : "");
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const toast = useToast();

  const commitViewport = useCallback((next: ImageViewport) => {
    viewportRef.current = next;
    setViewport(next);
  }, []);
  const reset = useCallback(() => commitViewport(fittedViewport), [commitViewport]);
  const updateBounds = useCallback(
    (update: Partial<ViewportBounds>) => {
      const next = { ...boundsRef.current, ...update };
      boundsRef.current = next;
      setBounds(next);
      commitViewport(clampViewport(viewportRef.current, next));
    },
    [commitViewport],
  );
  const updateImageSize = useCallback(
    (source: string | undefined, width: number, height: number) => {
      if (
        selectedImageRef.current?.source === source &&
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0
      )
        updateBounds({ imageWidth: width, imageHeight: height });
    },
    [updateBounds],
  );
  const select = (next: number) => {
    if (next < 0 || next >= images.length || next === selectedRef.current) return;
    selectedRef.current = next;
    setSelected(next);
    reset();
    setFailed(false);
    setLoadError("");
    updateBounds({ imageWidth: 0, imageHeight: 0 });
  };
  const move = (offset: number) => select(selectedRef.current + offset);
  const moveRef = useRef(move);
  moveRef.current = move;
  const resetRef = useRef(reset);
  resetRef.current = reset;

  const gestureActionsRef = useRef<ImageGestureActions>({
    enabled: () => gesturesEnabled,
    readViewport: () => viewportRef.current,
    readBounds: () => boundsRef.current,
    updateViewport: (next: ImageViewport) => commitViewport(next),
    previous: () => moveRef.current(-1),
    next: () => moveRef.current(1),
    reset: () => resetRef.current(),
  });
  gestureActionsRef.current = {
    enabled: () => gesturesEnabled,
    readViewport: () => viewportRef.current,
    readBounds: () => boundsRef.current,
    updateViewport: (next: ImageViewport) => commitViewport(next),
    previous: () => moveRef.current(-1),
    next: () => moveRef.current(1),
    reset: () => resetRef.current(),
  };
  const panResponder = useMemo(
    () =>
      createImagePanResponder({
        enabled: () => gestureActionsRef.current.enabled(),
        readViewport: () => gestureActionsRef.current.readViewport(),
        readBounds: () => gestureActionsRef.current.readBounds(),
        updateViewport: (next) => gestureActionsRef.current.updateViewport(next),
        previous: () => gestureActionsRef.current.previous(),
        next: () => gestureActionsRef.current.next(),
        reset: () => gestureActionsRef.current.reset(),
      }),
    [],
  );

  useEffect(() => {
    const next = Math.max(0, Math.min(images.length - 1, index));
    selectedRef.current = next;
    setSelected(next);
    reset();
    setFailed(false);
    setLoadError("");
    updateBounds({ imageWidth: 0, imageHeight: 0 });
  }, [index, images.length, reset, updateBounds]);

  useEffect(() => {
    const currentImage = selectedImageRef.current;
    let live = true;
    setFailed(false);
    setLoadError("");
    reset();
    updateBounds({ imageWidth: 0, imageHeight: 0 });
    if (currentImage && !currentImage.uri) {
      const resolver = resolveRef.current;
      if (resolver) {
        void resolver(currentImage)
          .then((value) => {
            if (live && value) setResolved({ key: requestKey, uri: value });
            else if (live) setLoadError("图片地址为空");
          })
          .catch(() => {
            if (live) setLoadError("图片读取失败");
          });
      } else setLoadError("没有可读取的图片地址");
    }
    return () => {
      live = false;
    };
  }, [requestKey, reset, updateBounds]);

  useEffect(() => {
    if (!uri) return;
    let live = true;
    const source = selectedImageRef.current?.source;
    // Size lookup is optional metadata, not a prerequisite for rendering.
    // Native onLoad can also supply dimensions when getSize is unavailable.
    Image.getSize(
      uri,
      (width, height) => {
        if (live && requestKeyRef.current === requestKey) updateImageSize(source, width, height);
      },
      () => {
        // Only the rendered Image's onError determines a decoding failure.
      },
    );
    return () => {
      live = false;
    };
  }, [uri, requestKey, updateImageSize]);

  const onCanvasLayout = (event: {
    nativeEvent: { layout: { width: number; height: number } };
  }) => {
    const { width, height } = event.nativeEvent.layout;
    if (width === boundsRef.current.width && height === boundsRef.current.height) return;
    updateBounds({ width, height });
  };
  const setZoom = (factor: number) => {
    const next = zoomAt(viewportRef.current, factor, { x: 0, y: 0 });
    commitViewport(clampViewport(next, boundsRef.current));
  };
  const button = (label: string, icon: string, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={{
        width: 44,
        height: 44,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={icon} color={theme.colors.foreground} size={20} />
    </Pressable>
  );

  if (!image) return null;
  const zoom = viewport.zoom;
  return (
    <Modal
      title={image.label}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content
        scrollable={false}
        style={{ backgroundColor: theme.colors.surface0 }}
        contentContainerStyle={{ flex: 1, padding: 0, gap: 0 }}
      >
        <DesktopKeySurface
          actions={{ previous: () => move(-1), next: () => move(1) }}
          style={{ flex: 1 }}
        >
          <View style={{ flex: 1, paddingHorizontal: 8, backgroundColor: theme.colors.surface0 }}>
            <View style={{ height: 48, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text
                accessibilityLabel={`第 ${selectedIndex + 1} 张，共 ${images.length} 张`}
                style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 }}
              >
                {selectedIndex + 1} / {images.length}
              </Text>
              {button(detailsOpen ? "Hide image details" : "Show image details", "Info", () =>
                setDetailsOpen((open) => !open),
              )}
            </View>

            <View
              style={{
                height: 52,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <View style={{ flexDirection: "row", gap: 6 }}>
                {button("上一张", "ChevronLeft", () => move(-1), selectedIndex === 0)}
                {button(
                  "下一张",
                  "ChevronRight",
                  () => move(1),
                  selectedIndex === images.length - 1,
                )}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {button("缩小", "ZoomOut", () => setZoom(1 / 1.25), zoom <= 0.25)}
                <Text
                  accessibilityLiveRegion="polite"
                  style={{
                    minWidth: 32,
                    textAlign: "center",
                    color: theme.colors.foregroundMuted,
                    fontSize: 12,
                  }}
                >
                  {Math.round(zoom * 100)}%
                </Text>
                {button("放大", "ZoomIn", () => setZoom(1.25), zoom >= 8)}
                {button("适应窗口", "Maximize", reset)}
              </View>
            </View>

            <DesktopZoomSurface
              testID="image-preview-canvas"
              onLayout={onCanvasLayout}
              actions={{
                enabled: () => gesturesEnabled,
                zoom: (factor, center) =>
                  commitViewport(
                    clampViewport(zoomAt(viewportRef.current, factor, center), boundsRef.current),
                  ),
              }}
              {...(gesturesEnabled ? panResponder.panHandlers : {})}
              style={{
                flex: 1,
                minHeight: 64,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.surface0,
              }}
            >
              {failed || loadError ? (
                <View style={{ alignItems: "center", gap: 12, padding: 20 }}>
                  <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>
                    {loadError || "图片加载失败"}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="重试读取图片"
                    onPress={() => {
                      setFailed(false);
                      setLoadError("");
                      setRetry((value) => value + 1);
                    }}
                  >
                    <Text style={{ color: theme.colors.accent }}>重试</Text>
                  </Pressable>
                </View>
              ) : !uri ? (
                <Text style={{ color: theme.colors.foregroundMuted, padding: 24 }}>
                  正在读取图片…
                </Text>
              ) : (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    transform: [{ translateX: viewport.x }, { translateY: viewport.y }],
                  }}
                >
                  <Image
                    key={`${requestKey}:${uri}`}
                    source={{ uri }}
                    resizeMode="contain"
                    resizeMethod="resize"
                    style={{ width: "100%", height: "100%", transform: [{ scale: zoom }] }}
                    onLoad={(event) => {
                      if (requestKeyRef.current !== requestKey) return;
                      // RNW emits a browser event without nativeEvent.source.
                      const intrinsic = event.nativeEvent?.source;
                      if (intrinsic)
                        updateImageSize(image.source, intrinsic.width, intrinsic.height);
                    }}
                    onError={() => {
                      if (requestKeyRef.current === requestKey) setFailed(true);
                    }}
                    accessibilityLabel={image.label}
                    accessibilityHint={
                      gesturesEnabled
                        ? "双指或滚轮缩放，拖动已放大的图片，双击复位，左右方向键切换图片。"
                        : "左右方向键切换图片。"
                    }
                  />
                </View>
              )}
            </DesktopZoomSurface>

            {detailsOpen ? (
              <View style={{ height: 48, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  numberOfLines={1}
                  selectable
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: theme.colors.foregroundMuted,
                    fontSize: 11,
                  }}
                >
                  {image.source.startsWith("data:") ? "内嵌图片" : image.source}
                </Text>
                {button("复制图片来源", "Copy", () => {
                  void copyText(image.source)
                    .then(() => toast.show("已复制图片来源"))
                    .catch(() => toast.error("复制失败"));
                })}
              </View>
            ) : null}

            {detailsOpen && images.length > 1 ? (
              <ScrollView
                horizontal
                style={{ height: 56, flexGrow: 0 }}
                contentContainerStyle={{ alignItems: "center", gap: 8 }}
              >
                {imageEntries(images).map(({ image: item, key }, position) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={`查看第 ${position + 1} 张图片：${item.label}`}
                    accessibilityState={{ selected: selectedIndex === position }}
                    onPress={() => select(position)}
                    style={{
                      width: 48,
                      height: 48,
                      borderWidth: 2,
                      borderColor:
                        selectedIndex === position ? theme.colors.accent : theme.colors.border,
                      borderRadius: 6,
                      overflow: "hidden",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {item.uri ? (
                      <Image
                        source={{ uri: item.uri }}
                        resizeMode="contain"
                        style={{ width: 44, height: 44 }}
                      />
                    ) : (
                      <Text style={{ color: theme.colors.foregroundMuted }}>{position + 1}</Text>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </DesktopKeySurface>
      </Modal.Content>
    </Modal>
  );
}
