import { type PluginTimelineItemProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { mediaSettings, resolveMedia } from "../shared/contracts";
import { previewWindow } from "../shared/media";
import { ImagePreview, imageEntries, type PreviewImage } from "./preview";

export const gallerySchema = z.object({
  images: z
    .array(z.object({ source: z.string(), label: z.string() }))
    .min(1)
    .max(64),
});
type GalleryProps = PluginTimelineItemProps<z.infer<typeof gallerySchema>>;

export function ImageGallery(props: GalleryProps) {
  const { theme, item, agentId } = props;
  const state = useSettings(mediaSettings);
  const read = useRpc(resolveMedia);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  if (state.status !== "ready")
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading image preferences…</Text>;
  const images: PreviewImage[] = item.data.images.map((image) => ({
    ...image,
    uri: /^(?:https?:|data:image\/)/i.test(image.source) ? image.source : undefined,
  }));
  const resolve = async (image: PreviewImage) =>
    image.uri || (await read({ agentId, source: image.source })).uri;
  const window = previewWindow(images, state.values.previewCount, expanded);
  return (
    <View testID="essentials-image-gallery" style={{ gap: 10, paddingVertical: 8 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {images.length} {images.length === 1 ? "image" : "images"}
        </Text>
        {images.length > state.values.previewCount ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((value) => !value)}
            style={{ padding: 10 }}
          >
            <Text style={{ color: theme.colors.accent }}>
              {expanded ? "Show fewer" : `Show all ${images.length}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {imageEntries(window.visible).map(({ image, key }, index) => (
          <GalleryThumbnail
            key={key}
            {...props}
            image={image}
            resolve={resolve}
            onPress={() => setSelected(index)}
          />
        ))}
        {window.hidden ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Show ${window.hidden} more images`}
            onPress={() => setExpanded(true)}
            style={{
              width: 104,
              height: 80,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              backgroundColor: theme.colors.surface1,
            }}
          >
            <Text style={{ color: theme.colors.foreground }}>+{window.hidden}</Text>
          </Pressable>
        ) : null}
      </View>
      {selected !== null ? (
        <ImagePreview
          {...props}
          images={images}
          index={selected}
          resolve={resolve}
          gesturesEnabled={state.values.imageGesturesEnabled}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </View>
  );
}

function GalleryThumbnail({
  image,
  resolve,
  onPress,
  theme,
  host,
  agentId,
}: GalleryProps & {
  image: PreviewImage;
  resolve: (image: PreviewImage) => Promise<string>;
  onPress: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const query = useQuery({
    queryKey: ["essentials-gallery", host.id, agentId, image.source],
    queryFn: () => resolve(image),
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${image.label}`}
      onPress={onPress}
      style={{
        width: 104,
        height: 80,
        borderRadius: 8,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surface1,
      }}
    >
      {query.data && !failed ? (
        <View pointerEvents="none" style={{ width: "100%", height: "100%" }}>
          <Image
            source={{ uri: query.data }}
            resizeMode="contain"
            resizeMethod="resize"
            style={{ width: "100%", height: "100%" }}
            onError={() => setFailed(true)}
            accessibilityLabel={image.label}
          />
        </View>
      ) : (
        <View style={{ alignItems: "center", gap: 4 }}>
          <Icon
            name={query.isError || failed ? "ImageOff" : "Image"}
            size={22}
            color={theme.colors.foregroundMuted}
          />
          <Text
            numberOfLines={1}
            style={{ color: theme.colors.foregroundMuted, paddingHorizontal: 8 }}
          >
            {query.isError || failed ? "Open to retry" : "Loading…"}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
