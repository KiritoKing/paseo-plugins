import type {
  PluginButtonRegistration,
  PluginClientContext,
  PluginSurfaceProps,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { useEffect } from "react";
import type { z } from "zod";
import { createAttachmentPresence } from "./client/attachment-presence";
import { gallerySchema, ImageGallery } from "./client/gallery";
import { MediaPanel } from "./client/panel";
import { makeSessionControls } from "./client/session-controls";
import { createSessionDialogs } from "./client/session-dialogs";
import { makeSessionOpener } from "./client/session-opener";
import { MediaSettings } from "./client/settings";
import { type FeatureValues, listMedia, readFeatures } from "./shared/contracts";
import { extractImageOnlyMessage } from "./shared/media";

export default function contribute(client: PluginClientContext) {
  let disposed = false;
  let settingsRequest = 0;
  let values: FeatureValues | undefined;
  let stopAttachments: (() => void) | undefined;
  let stopSessions: (() => void) | undefined;
  let stopGalleries: (() => void) | undefined;
  let presence: ReturnType<typeof createAttachmentPresence> | undefined;
  const dialogs = createSessionDialogs();
  const openAgent = (agentId: string) =>
    client.openScreen({ screenId: "sessions", params: { agentId, request: String(Date.now()) } });
  const SessionIcon = makeSessionControls(dialogs, openAgent);

  function Settings(props: PluginSurfaceProps) {
    return <MediaSettings {...props} onChange={settingsChanged} />;
  }
  function Gallery(props: PluginTimelineItemProps<z.infer<typeof gallerySchema>>) {
    useEffect(() => {
      presence?.seen(props.agentId);
    }, [props.agentId, props.item]);
    return <ImageGallery {...props} />;
  }

  const cleanups = [
    client.addScreen({
      id: "sessions",
      title: "Opening conversation",
      Component: makeSessionOpener(dialogs),
    }),
    client.addSettingsScreen({
      id: "media",
      title: "Features",
      icon: "SlidersHorizontal",
      Component: Settings,
    }),
    client.addCommandCenterItem({
      id: "features",
      title: "Essentials · Features",
      icon: "SlidersHorizontal",
      context: "global",
      onSelect: () => client.openSettings("media"),
    }),
    // Keep already-open panels mounted when a feature is turned off.
    client.addWorkspacePanel({
      id: "media",
      title: "Attachments",
      icon: "Paperclip",
      context: "agent",
      locations: ["workspace", "explorer"],
      Component: (props) => (
        <MediaPanel
          {...props}
          playAudio={
            typeof client.playAudio === "function"
              ? (source) => client.playAudio(source)
              : undefined
          }
          onOpenSettings={() => client.openSettings("media")}
        />
      ),
    }),
    client.addTimelineRenderer({
      kind: "image-gallery",
      version: 1,
      schema: gallerySchema,
      Component: Gallery,
    }),
  ];

  function startAttachments() {
    let stopped = false;
    const pills = new Map<
      string,
      { workspaceId: string; registration: PluginButtonRegistration; updatedAt?: string }
    >();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const releases: Array<() => void> = [];
    const index = createAttachmentPresence(
      (input) => client.rpc(listMedia, input),
      (id, state) => {
        pills.get(id)?.registration.update({ visible: state.hasAttachments });
      },
    );
    presence = index;
    const sync = (agent: {
      id: string;
      workspaceId?: string;
      archivedAt?: string | null;
      updatedAt?: string;
    }) => {
      if (stopped) return;
      const previous = pills.get(agent.id);
      if (agent.archivedAt || !agent.workspaceId) {
        previous?.registration.remove();
        pills.delete(agent.id);
        index.remove(agent.id);
        const timer = timers.get(agent.id);
        if (timer) clearTimeout(timer);
        timers.delete(agent.id);
        return;
      }
      if (previous?.workspaceId === agent.workspaceId) {
        if (previous.updatedAt !== agent.updatedAt) {
          previous.updatedAt = agent.updatedAt;
          const old = timers.get(agent.id);
          if (old) clearTimeout(old);
          timers.set(
            agent.id,
            setTimeout(() => {
              timers.delete(agent.id);
              index.invalidate(agent.id);
            }, 600),
          );
        }
        return;
      }
      previous?.registration.remove();
      const workspaceId = agent.workspaceId;
      pills.set(agent.id, {
        workspaceId,
        updatedAt: agent.updatedAt,
        registration: client.addComposerPill({
          id: "media",
          workspaceId,
          agentId: agent.id,
          button: {
            title: "Conversation attachments",
            label: "Attachments",
            icon: "Paperclip",
            visible: false,
            behavior: {
              kind: "action",
              onPress: () =>
                client.openPanel("media", { workspaceId, agentId: agent.id, location: "explorer" }),
            },
          },
        }),
      });
      index.invalidate(agent.id);
    };
    releases.push(
      client.addCommandCenterItem({
        id: "media",
        title: "Essentials · Conversation attachments",
        icon: "Paperclip",
        keywords: ["images", "video", "audio", "files", "附件"],
        context: "agent",
        onSelect: ({ openPanel }) => openPanel("media", { location: "explorer" }),
      }),
    );
    releases.push(
      client.addSlashCommand({
        name: "media",
        argumentHint: "",
        description: "Browse this conversation’s attachments",
        context: "agent",
        onSubmit: ({ openPanel }) => openPanel("media", { location: "explorer" }),
      }),
    );
    releases.push(
      client.paseo.agents.subscribe((update) => {
        if (update.kind === "upsert") sync(update.agent);
        else {
          pills.get(update.agentId)?.registration.remove();
          pills.delete(update.agentId);
          index.remove(update.agentId);
        }
      }),
    );
    void (async () => {
      let cursor: string | undefined;
      do {
        const result = cursor
          ? await client.paseo.agents.list({ page: { limit: 200, cursor } })
          : await client.paseo.agents.list({ page: { limit: 200 }, subscribe: {} });
        if (result.subscription) {
          if (stopped) {
            void result.subscription.release();
            return;
          }
          releases.push(() => {
            void result.subscription?.release();
          });
        }
        if (stopped) return;
        for (const entry of result.entries) sync(entry.agent);
        const next = result.pageInfo.hasMore
          ? (result.pageInfo.nextCursor ?? undefined)
          : undefined;
        if (next === cursor) break;
        cursor = next;
      } while (cursor);
    })().catch(() => {
      if (!stopped)
        console.warn(
          "Essentials could not load the conversation directory. Use the attachments command to retry for a conversation.",
        );
    });
    return () => {
      stopped = true;
      index.dispose();
      if (presence === index) presence = undefined;
      for (const timer of timers.values()) clearTimeout(timer);
      for (const pill of pills.values()) pill.registration.remove();
      for (const release of releases) release();
    };
  }

  function startSessions() {
    let stopped = false;
    const buttons = new Map<string, PluginButtonRegistration>();
    let releaseDirectory: (() => void) | undefined;
    const history = (workspaceId: string, latest = false) => dialogs.open(workspaceId, latest);
    const sync = (workspace: { id: string }) => {
      if (stopped || buttons.has(workspace.id)) return;
      buttons.set(
        workspace.id,
        client.addHeaderButton({
          id: "sessions",
          workspaceId: workspace.id,
          button: {
            title: "Workspace conversations",
            label: "Sessions",
            icon: SessionIcon,
            behavior: {
              kind: "menu",
              items: [
                {
                  kind: "item",
                  id: "history",
                  title: "Workspace conversations",
                  icon: "History",
                  behavior: { kind: "action", onPress: () => history(workspace.id) },
                },
                {
                  kind: "item",
                  id: "reopen",
                  title: "Reopen last closed conversation",
                  icon: "RotateCcw",
                  behavior: { kind: "action", onPress: () => history(workspace.id, true) },
                },
              ],
            },
          },
        }),
      );
    };
    const stopEvents = client.paseo.workspaces.subscribe((update) => {
      if (update.kind === "upsert") sync(update.workspace);
      else {
        buttons.get(update.id)?.remove();
        buttons.delete(update.id);
        dialogs.remove(update.id);
      }
    });
    void client.paseo.workspaces
      .list({ subscribe: {} })
      .then((result) => {
        if (stopped) {
          void result.subscription.release();
          return;
        }
        releaseDirectory = () => {
          void result.subscription.release();
        };
        result.entries.forEach(sync);
      })
      .catch(() => {
        if (!stopped) console.warn("Essentials could not load workspace conversations.");
      });
    const stopCommand = client.addCommandCenterItem({
      id: "sessions",
      title: "Essentials · Workspace conversations",
      icon: "History",
      context: "workspace",
      onSelect: ({ workspace }) => history(workspace.id),
    });
    return () => {
      stopped = true;
      stopEvents();
      releaseDirectory?.();
      stopCommand();
      for (const button of buttons.values()) button.remove();
      dialogs.dispose();
    };
  }

  function apply(next?: FeatureValues) {
    if (disposed) return;
    if (!!next?.attachmentsEnabled !== !!values?.attachmentsEnabled) {
      stopAttachments?.();
      stopAttachments = next?.attachmentsEnabled ? startAttachments() : undefined;
    }
    if (!!next?.sessionsEnabled !== !!values?.sessionsEnabled) {
      stopSessions?.();
      stopSessions = next?.sessionsEnabled ? startSessions() : undefined;
    }
    if (!!next?.enabled !== !!values?.enabled) {
      stopGalleries?.();
      stopGalleries = undefined;
      if (next?.enabled) {
        const transform = ({
          item,
          phase,
        }: {
          item: { text: string };
          phase: "complete" | "streaming";
        }) => {
          if (phase !== "complete") return;
          const images = extractImageOnlyMessage(item.text);
          if (
            !images?.length ||
            images.length > 64 ||
            images.some((image) => image.source.length > 24_000)
          )
            return;
          const data = { images: images.map(({ source, label }) => ({ source, label })) };
          // Stay below the public 64 KiB timeline payload limit, including UTF-8.
          if (JSON.stringify(data).length > 20_000) return;
          return {
            items: [
              {
                type: "plugin" as const,
                kind: "image-gallery",
                version: 1,
                data,
              },
            ],
          };
        };
        const removers = [
          client.addTimelineTransformer({
            id: "assistant-images",
            query: { itemType: "assistant_message" },
            transform,
          }),
          client.addTimelineTransformer({
            id: "user-images",
            query: { itemType: "user_message" },
            transform,
          }),
        ];
        stopGalleries = () => {
          for (const remove of removers) void remove();
        };
      }
    }
    values = next;
  }
  function settingsChanged(next: FeatureValues) {
    settingsRequest++;
    apply(next);
  }
  async function refreshSettings() {
    const request = ++settingsRequest;
    try {
      const next = await client.rpc(readFeatures, {});
      if (request === settingsRequest) apply(next);
    } catch {
      if (request === settingsRequest) apply(undefined);
    }
  }
  // The SDK owns reconnection. A new snapshot reloads saved values rather than
  // retaining stale preferences or silently substituting defaults.
  const changes = client.paseo.observeEvents(["status.plugin_settings_changed"]);
  const removeObserver = changes.subscribe({
    snapshot: () => {
      void refreshSettings();
    },
    update: (message) => {
      if (
        message.type === "status" &&
        message.payload.status === "plugin_settings_changed" &&
        message.payload.settingsId === "media"
      )
        void refreshSettings();
    },
    error: () => {
      if (!disposed) apply(undefined);
    },
  });
  void changes.ready.catch(() => {
    if (!disposed) apply(undefined);
  });
  void refreshSettings();
  return () => {
    disposed = true;
    settingsRequest++;
    removeObserver();
    void changes.release();
    stopAttachments?.();
    stopSessions?.();
    stopGalleries?.();
    dialogs.dispose();
    for (const cleanup of cleanups) void cleanup();
  };
}
