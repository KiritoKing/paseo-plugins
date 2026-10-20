import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ImagePreview } from "../../client/preview";
import { Modal } from "./screen-ui";

const images = [1, 2, 3].map((i) => {
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 240;
  const context = canvas.getContext("2d");
  context.fillStyle = ["#859bd5", "#d8b483", "#8eb8a2"][i - 1];
  context.fillRect(0, 0, 360, 240);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(180, 120, 70, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#344058";
  context.font = "80px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(i), 180, 124);
  return { source: `/tmp/test-${i}.png`, uri: canvas.toDataURL(), label: `测试图片 ${i}` };
});
const colors = {
  surface0: "#fff",
  surface1: "#f7f7f8",
  surface2: "#ececef",
  border: "#d9d9de",
  foreground: "#25252a",
  foregroundMuted: "#73737f",
  accent: "#5957da",
  statusDanger: "#cc4444",
};
function Fixture() {
  const [open, setOpen] = useState(false),
    [other, setOther] = useState(false);
  return (
    <>
      <h1>原工作区</h1>
      <button type="button" onClick={() => setOpen(true)}>
        打开图片预览
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setOther(true);
        }}
      >
        同时打开两个弹窗
      </button>
      {open ? (
        <ImagePreview
          images={images}
          index={0}
          theme={{ colors }}
          host={{ id: "fixture", label: "test" }}
          layout={{ compact: false, platform: "web" }}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {other ? (
        <Modal title="其他弹窗" open onOpenChange={setOther}>
          <Modal.Content>
            <button type="button">其他弹窗按钮</button>
          </Modal.Content>
        </Modal>
      ) : null}
    </>
  );
}
document.addEventListener("keydown", (event) => {
  if (event.key.startsWith("Arrow") && !event.defaultPrevented)
    document.querySelector("#unhandled").textContent = String(
      Number(document.querySelector("#unhandled").textContent) + 1,
    );
});
createRoot(document.querySelector("#root")).render(<Fixture />);
