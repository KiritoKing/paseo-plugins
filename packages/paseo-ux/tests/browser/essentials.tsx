import type { PluginClientContext } from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ImageGallery } from "../../client/gallery";
import { MediaPanel } from "../../client/panel";
import { MediaSettings } from "../../client/settings";
import contribute from "../../index.client";
import { addFirstAttachment, failHistory, fakePaseo, rpc, sampleImage } from "./essentials-host";

const colors = {
  surface0: "#fff",
  surface1: "#f1f5f9",
  surface2: "#e2e8f0",
  foreground: "#0f172a",
  foregroundMuted: "#475569",
  border: "#cbd5e1",
  accent: "#2563eb",
  statusDanger: "#b91c1c",
};
const registrations = new Map<string, { visible?: boolean }>();
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
  openPanel() {},
  async playAudio() {},
  addScreen: () => register("screen"),
  addSettingsScreen: () => register("settings"),
  addWorkspacePanel: () => register("panel"),
  addTimelineRenderer: () => register("renderer"),
  addTimelineTransformer: (item: { id: string }) => register(item.id),
  addCommandCenterItem: (item: { id: string }) => register("command:" + item.id),
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
  const [, render] = useState(0);
  useEffect(() => {
    const callback = () => render((value) => value + 1);
    callbacks.add(callback);
    const stop = contribute(client);
    return () => {
      callbacks.delete(callback);
      stop();
    };
  }, []);
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 700);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const props = {
    host: { id: "synthetic-host", label: "Synthetic host" },
    theme: { appearance: "light" as const, colors },
    layout: { platform: "web" as const, compact },
  };
  return (
    <QueryClientProvider client={queries}>
      <header>
        <strong>Essentials component fixture</strong>
        <span> Synthetic host APIs; real React Native Web components.</span>
      </header>
      <nav aria-label="Fixture controls">
        {["attachments", "features", "gallery"].map((value) => (
          <button type="button" key={value} onClick={() => setRoute(value)}>
            {value}
          </button>
        ))}
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
      </nav>
      <aside aria-label="Registration state">
        {Array.from(registrations, ([id, state]) => (
          <span key={id} data-registration={id} data-visible={state.visible}>
            {id}
            {state.visible === undefined ? "" : state.visible ? ":visible" : ":hidden"}{" "}
          </span>
        ))}
      </aside>
      <main>
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
      </main>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
