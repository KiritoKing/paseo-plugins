import { mountImageGestures, mountSessionControls } from "../../client/web";
import { fittedViewport } from "../../shared/viewport";

let state = { ...fittedViewport };
let restored = 0,
  terminals = 0,
  histories = 0;
const render = () => {
  document.querySelector("#state")!.textContent = JSON.stringify(state);
  (document.querySelector("#image") as HTMLElement).style.transform =
    `translate(${state.x}px,${state.y}px) scale(${state.zoom})`;
};
const keys = () =>
  (document.querySelector("#keys")!.textContent = JSON.stringify({
    restored,
    terminals,
    histories,
  }));
render();
keys();
const colors = {
  surface0: "#fff",
  surface1: "#fff",
  surface2: "#eee",
  border: "#ccc",
  foreground: "#222",
  foregroundMuted: "#666",
  accent: "#5957da",
  accentForeground: "#fff",
  statusSuccess: "#228855",
  statusWarning: "#bb8800",
  statusDanger: "#cc4444",
};
const gestures = mountImageGestures({
  id: "gesture-fixture",
  read: () => state,
  update: (next) => {
    state = next;
    render();
  },
});
window.addEventListener(
  "keydown",
  (event) => {
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "t") {
      terminals++;
      keys();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
const shortcuts = mountSessionControls({
  hostId: "fixture-host",
  workspaceId: "fixture-workspace",
  theme: { colors },
  onRestore: () => {
    restored++;
    keys();
  },
  onHistory: () => {
    histories++;
    keys();
  },
});
document.querySelector("#restore")!.addEventListener("click", () =>
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "T",
      code: "KeyT",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  ),
);
document.querySelector("#terminal")!.addEventListener("click", () =>
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  ),
);
document.querySelector("#menu")!.addEventListener("click", () => {
  const menu = document.createElement("div");
  menu.setAttribute("data-testid", "workspace-new-tab-menu");
  menu.setAttribute("role", "menu");
  menu.className = "native-menu";
  const row = (id: string, label: string, shortcut?: string) =>
    `<div data-testid="workspace-new-tab-menu-${id}" data-menu-item="true" data-menu-disabled="false" role="menuitem" tabindex="-1" class="native-row"><div class="native-leading"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div><div class="native-content"><span class="native-label">${label}</span></div>${shortcut ? `<div class="native-trailing"><div class="native-badge"><span>${shortcut}</span></div></div>` : ""}</div>`;
  menu.innerHTML =
    row("agent", "Agent", "⇧⌘A") +
    row("terminal", "Terminal", "⇧⌘T") +
    row("diff", "Diff", "⇧⌘G") +
    row("browser", "浏览器", "⇧⌘B") +
    '<div class="native-separator"></div>' +
    row("business", "AIW 业务仓") +
    row("search", "AIW 跨仓搜索") +
    '<div class="native-separator"></div><div class="native-section-label">Terminal profiles</div>' +
    row("codex", "Codex") +
    row("claude", "Claude Code") +
    '<div class="native-separator"></div><div role="menuitem" class="native-row"><span class="native-label">Edit profiles</span></div>';
  document.body.appendChild(menu);
});
document.querySelector("#stop")!.addEventListener("click", () => {
  gestures();
  shortcuts();
});
