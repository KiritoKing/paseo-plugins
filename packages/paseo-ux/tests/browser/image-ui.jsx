import React, { useState } from "react";
import { Modal as HostModal } from "./screen-ui";
export { Icon, ScrollView, TextInput } from "./screen-ui";
export function Modal({ children, ...props }) {
  const [testing, setTesting] = useState(true);
  return (
    <HostModal {...props}>
      {testing ? (
        <div>
          <input aria-label="预览中的输入框" defaultValue="abc" style={{ margin: 12 }} />
          <button
            onClick={() => {
              for (let i = 0; i < 5; i++)
                document.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "ArrowRight",
                    code: "ArrowRight",
                    repeat: true,
                    bubbles: true,
                    cancelable: true,
                  }),
                );
            }}
          >
            连续右键
          </button>
          <button onClick={() => setTesting(false)}>隐藏测试控件</button>
        </div>
      ) : null}
      {children}
    </HostModal>
  );
}
Modal.Content = HostModal.Content;
export function useToast() {
  return { show() {}, error() {} };
}
export async function copyText() {}
