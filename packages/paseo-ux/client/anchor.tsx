import { type PluginButtonIconProps, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { mediaSettings } from "../shared/contracts";
import { ImagePreview } from "./preview";
import { type InlineImage, mountInlineMedia } from "./web";

export function makeMediaAnchor(onPanel: (workspaceId: string, agentId: string) => void) {
  return function MediaAnchor(props: PluginButtonIconProps) {
    const settings = useSettings(mediaSettings);
    const [preview, setPreview] = useState<{ images: InlineImage[]; index: number } | null>(null);
    const agentId = props.context === "agent" ? props.agentId : null;
    const enabled = settings.status === "ready" ? settings.values.enabled : false;
    const limit = settings.status === "ready" ? settings.values.previewCount : 3;
    useEffect(() => {
      if (!agentId) return;
      return mountInlineMedia({
        agentId,
        theme: props.theme,
        limit,
        enabled,
        onPreview: (images, index) => setPreview({ images, index }),
        onPanel: () => onPanel(props.workspaceId, agentId),
      });
    }, [agentId, props.theme, props.workspaceId, limit, enabled]);
    return (
      <View testID={agentId ? `paseo-ux-anchor-${agentId}` : "paseo-ux-anchor"}>
        <Icon name="Images" size={props.size} color={props.color} />
        {preview ? (
          <ImagePreview
            {...props}
            images={preview.images}
            index={preview.index}
            onClose={() => setPreview(null)}
          />
        ) : null}
      </View>
    );
  };
}
