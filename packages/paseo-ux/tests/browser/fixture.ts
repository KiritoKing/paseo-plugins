import { mountInlineMedia } from "../../client/web";

const source =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=";
const frame = (number: number) =>
  `<div data-paseo-markdown-tag="img" data-paseo-markdown-src="/tmp/image-${number}.png" data-paseo-markdown-alt="图片 ${number}"><button aria-label="原生图片 ${number}"><img alt="图片 ${number}" src="${source}" style="width:200px;height:220px;background:hsl(${number * 53} 45% 70%)"></button></div>`;
const message = document.querySelector('[data-testid="assistant-message"]')!;
message.innerHTML = `<p>前面的正文保留原样。</p>${[1, 2, 3, 4, 5].map(frame).join("")}<p>这里的文字隔开两组图片。</p>${frame(6)}<p>后面的正文保留原样。</p>`;
const colors = {
  surface0: "#ffffff",
  surface1: "#f7f7f8",
  surface2: "#ececef",
  border: "#d9d9de",
  foreground: "#25252a",
  foregroundMuted: "#73737f",
  accent: "#5957da",
  accentForeground: "#ffffff",
  statusSuccess: "#228855",
  statusWarning: "#bb8800",
  statusDanger: "#cc4444",
};
let dispose = mountInlineMedia({
  agentId: "fixture",
  theme: { colors },
  limit: 3,
  enabled: true,
  onPreview: (images, index) => {
    document.querySelector("#result")!.textContent =
      `已打开第 ${index + 1} / ${images.length} 张：${images[index]!.label}`;
  },
  onPanel: () => {
    document.querySelector("#result")!.textContent = "已打开会话媒体面板";
  },
});
document.querySelector("#append")!.addEventListener("click", () => {
  const last = message.querySelector('[data-paseo-markdown-src="/tmp/image-5.png"]')!;
  last.insertAdjacentHTML("afterend", frame(7));
});
document.querySelector("#remount")!.addEventListener("click", () => {
  const saved = [1, 2, 3, 4, 5, 7].map(frame).join("");
  message.innerHTML = `<p>前面的正文保留原样。</p>${saved}<p>这里的文字隔开两组图片。</p>${frame(6)}<p>后面的正文保留原样。</p>`;
});
document.querySelector("#stop")!.addEventListener("click", () => {
  dispose();
  document.querySelector("#result")!.textContent = "已卸载，恢复原生图片";
});
document.querySelector("#dark")!.addEventListener("click", () => {
  dispose();
  document.body.style.background = "#16161a";
  document.body.style.color = "#eeeef2";
  dispose = mountInlineMedia({
    agentId: "fixture",
    theme: {
      colors: {
        ...colors,
        surface0: "#16161a",
        surface1: "#222228",
        surface2: "#33333b",
        border: "#444450",
        foreground: "#eeeef2",
        foregroundMuted: "#aaaab6",
      },
    },
    limit: 3,
    enabled: true,
    onPreview: (images, index) => {
      document.querySelector("#result")!.textContent =
        `已打开第 ${index + 1} / ${images.length} 张`;
    },
    onPanel: () => {},
  });
});

document.querySelector("#split")!.addEventListener("click", () => {
  message.innerHTML = `<p>前面的正文保留原样。</p>`;
  const row = document.createElement("div");
  row.innerHTML = `<div data-testid="assistant-message">${frame(8)}</div><div data-testid="assistant-message">${frame(9)}</div><p>工具输出：分隔图片</p><div data-testid="assistant-message">${frame(10)}</div>`;
  message.appendChild(row);
});
