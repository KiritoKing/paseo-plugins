import type {
  PluginAgentPanelProps,
  PluginClientContext,
  PluginSurfaceProps,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ImageGallery } from "../../client/gallery";
import { MediaPanel } from "../../client/panel";
import { ImagePreview } from "../../client/preview";
import { MediaSettings } from "../../client/settings";
import contribute from "../../index.client";
import {
  addFirstAttachment,
  delayNextHistory,
  failHistory,
  fakePaseo,
  rpc,
  sampleImage,
} from "./essentials-host";
import { syntheticHostTheme } from "./host-theme";
import { runImageChecks } from "./image-checks";
import { runImageLoadChecks } from "./image-load-checks";
import { runTurnDiffChecks } from "./turn-diff-checks";
import { turnCard, turnDiffFixture } from "./turn-diff-fixture";

const registrations = new Map<string, { visible?: boolean }>();
const settingsScreens = new Map<string, ComponentType<PluginSurfaceProps>>();
const panels = new Map<string, ComponentType<PluginAgentPanelProps>>();
const renderers = new Map<string, ComponentType<PluginTimelineItemProps>>();
const commands = new Map<string, { onSelect(context: unknown): void }>();
let navigateToPanel = (_agentId?: string) => {};
const callbacks = new Set<() => void>();
function changed() {
  for (const callback of callbacks) callback();
}
function register(id: string, data = {}) {
  registrations.set(id, data);
  changed();
  return () => {
    registrations.delete(id);
    changed();
  };
}
const client = {
  paseo: fakePaseo,
  rpc,
  openScreen() {},
  openSettings() {},
  openPanel(_id: string, options: { agentId: string }) {
    navigateToPanel(options.agentId);
  },
  async playAudio() {},
  addScreen: () => register("screen"),
  addSettingsScreen: (item: { id: string; Component: ComponentType<PluginSurfaceProps> }) => {
    settingsScreens.set(item.id, item.Component);
    const remove = register("settings:" + item.id);
    return () => {
      settingsScreens.delete(item.id);
      remove();
    };
  },
  addWorkspacePanel: (item: { id: string; Component: ComponentType<PluginAgentPanelProps> }) => {
    panels.set(item.id, item.Component);
    const remove = register("panel:" + item.id);
    return () => {
      panels.delete(item.id);
      remove();
    };
  },
  addTimelineRenderer: (item: {
    kind: string;
    Component: ComponentType<PluginTimelineItemProps>;
  }) => {
    renderers.set(item.kind, item.Component);
    const remove = register("renderer:" + item.kind);
    return () => {
      renderers.delete(item.kind);
      remove();
    };
  },
  addTimelineTransformer: (item: { id: string }) => register(item.id),
  addCommandCenterItem: (item: { id: string; onSelect(context: unknown): void }) => {
    commands.set(item.id, item);
    const remove = register("command:" + item.id);
    return () => {
      commands.delete(item.id);
      remove();
    };
  },
  addSlashCommand: (item: { name: string }) => register("slash:" + item.name),
  addHeaderButton: () => {
    const remove = register("header");
    return { remove, update() {} };
  },
  addComposerPill: (item: { agentId: string; button: { visible: boolean } }) => {
    const key = "pill:" + item.agentId;
    const remove = register(key, item.button);
    return {
      remove,
      update(patch: { visible?: boolean }) {
        registrations.set(key, { ...registrations.get(key), ...patch });
        changed();
      },
    };
  },
} as unknown as PluginClientContext;
const queries = new QueryClient();
function App() {
  const [route, setRoute] = useState("attachments");
  const [agentId, setAgentId] = useState("sample");
  const [compact, setCompact] = useState(window.innerWidth < 700);
  const [appearance, setAppearance] = useState<"light" | "dark">("light");
  const [hideControls, setHideControls] = useState(false);
  const [previewCase, setPreviewCase] = useState<string | null>(null);
  const [imageCheckResult, setImageCheckResult] = useState("");
  const previewAttempts = useRef(0);
  const [, render] = useState(0);
  navigateToPanel = (id) => {
    if (id) setAgentId(id);
    setRoute("turn-changes");
  };
  useEffect(() => {
    const callback = () => render((value) => value + 1);
    callbacks.add(callback);
    const stop = contribute(client);
    window.runImageChecks = runImageChecks;
    window.runImageLoadChecks = runImageLoadChecks;
    window.runTurnDiffChecks = () => runTurnDiffChecks(() => queries.clear());
    return () => {
      callbacks.delete(callback);
      stop();
      delete window.runImageChecks;
      delete window.runImageLoadChecks;
      delete window.runTurnDiffChecks;
    };
  }, []);
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 700);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const props = {
    host: { id: "synthetic-host", label: "Synthetic host" },
    theme: syntheticHostTheme(appearance),
    layout: { platform: "web" as const, compact },
  };
  const ReadingSettings = settingsScreens.get("appearance");
  const TurnPanel = panels.get("turn-changes");
  const TurnCard = renderers.get("turn-changes");
  return (
    <QueryClientProvider client={queries}>
      <header>
        <strong>Essentials component fixture</strong>
        <span> Synthetic host APIs; real React Native Web components.</span>
        <button type="button" onClick={() => setHideControls((value) => !value)}>
          {hideControls ? "Show fixture controls" : "Hide fixture controls"}
        </button>
      </header>
      <nav aria-label="Fixture controls" style={{ display: hideControls ? "none" : undefined }}>
        {[
          "attachments",
          "features",
          "reading",
          "gallery",
          "image-load",
          "turn-card",
          "turn-changes",
        ].map((value) => (
          <button type="button" key={value} onClick={() => setRoute(value)}>
            {value}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAppearance((value) => (value === "light" ? "dark" : "light"))}
        >
          Toggle fixture theme
        </button>
        <button
          type="button"
          onClick={() => {
            turnDiffFixture.failList = true;
          }}
        >
          Fail next turn history
        </button>
        <button
          type="button"
          onClick={() => {
            turnDiffFixture.failDiff = true;
          }}
        >
          Fail next saved diff
        </button>
        <button
          type="button"
          onClick={() => {
            turnDiffFixture.delayDiff = true;
          }}
        >
          Delay next saved diff
        </button>
        <button
          type="button"
          onClick={() =>
            commands
              .get("turn-changes")
              ?.onSelect({ agent: { id: agentId }, openPanel: () => navigateToPanel() })
          }
        >
          Open turn history command
        </button>
        <button
          type="button"
          disabled={imageCheckResult.startsWith("Running ")}
          onClick={async () => {
            setImageCheckResult("Running turn changes checks…");
            setImageCheckResult(JSON.stringify(await window.runTurnDiffChecks()));
          }}
        >
          Run turn changes checks
        </button>
        <select
          aria-label="Conversation"
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
        >
          <option value="sample">Sample</option>
          <option value="empty">Empty</option>
          <option value="older">Older attachments</option>
        </select>
        <button type="button" onClick={addFirstAttachment}>
          Add first attachment
        </button>
        <button type="button" onClick={failHistory}>
          Fail next history request
        </button>
        <button type="button" onClick={() => delayNextHistory(agentId)}>
          Delay next history response
        </button>
        <button
          type="button"
          disabled={imageCheckResult.startsWith("Running ")}
          onClick={async () => {
            setImageCheckResult("Running image load checks…");
            setImageCheckResult(JSON.stringify(await runImageLoadChecks()));
          }}
        >
          Run image load checks
        </button>
        <button
          type="button"
          disabled={imageCheckResult.startsWith("Running ")}
          onClick={async () => {
            setImageCheckResult("Running image interaction checks…");
            setImageCheckResult(JSON.stringify(await runImageChecks()));
          }}
        >
          Run image interaction checks
        </button>
      </nav>
      {imageCheckResult ? (
        <output aria-label="Image check result">{imageCheckResult}</output>
      ) : null}
      <aside aria-label="Registration state" style={{ display: hideControls ? "none" : undefined }}>
        {Array.from(registrations, ([id, state]) => (
          <span key={id} data-registration={id} data-visible={state.visible}>
            {id}
            {state.visible === undefined ? "" : state.visible ? ":visible" : ":hidden"}{" "}
          </span>
        ))}
      </aside>
      <main>
        {route === "turn-card" && TurnCard ? (
          <TurnCard
            {...props}
            agentId={agentId}
            item={{ type: "plugin", kind: "turn-changes", version: 1, data: turnCard }}
            timestamp={new Date()}
          />
        ) : null}
        {route === "turn-changes" && TurnPanel ? (
          <TurnPanel
            {...props}
            context="agent"
            workspaceId="synthetic-workspace"
            agentId={agentId}
          />
        ) : null}
        {route === "attachments" ? (
          <MediaPanel
            {...props}
            agentId={agentId}
            workspaceId="synthetic-workspace"
            context="agent"
            playAudio={async () => {}}
            onOpenSettings={() => setRoute("features")}
          />
        ) : null}
        {route === "features" ? <MediaSettings {...props} /> : null}
        {route === "reading" && ReadingSettings ? <ReadingSettings {...props} /> : null}
        {route === "gallery" ? (
          <ImageGallery
            {...props}
            agentId="sample"
            item={{
              type: "plugin",
              kind: "image-gallery",
              version: 1,
              data: {
                images: [1, 2, 3, 4, 5].map((n) => ({ source: sampleImage, label: "Sample " + n })),
              },
            }}
            timestamp={new Date()}
          />
        ) : null}
        {route === "image-load" ? (
          <section aria-label="Image load failure cases">
            {["valid images", "renderer failure", "resolver failure"].map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => {
                  previewAttempts.current = 0;
                  setPreviewCase(value);
                }}
              >
                Open {value}
              </button>
            ))}
            {previewCase ? (
              <ImagePreview
                {...props}
                images={[
                  { source: "first-preview.png", label: "First preview" },
                  { source: "second-preview.png", label: "Second preview" },
                ]}
                index={0}
                resolve={async () => {
                  if (previewAttempts.current++ === 0) {
                    if (previewCase === "resolver failure") throw new Error("Synthetic read error");
                    if (previewCase === "renderer failure")
                      return "data:image/png;base64,aW52YWxpZA==";
                  }
                  return sampleImage;
                }}
                onClose={() => setPreviewCase(null)}
              />
            ) : null}
          </section>
        ) : null}
      </main>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
