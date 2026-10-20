import React, { useEffect } from "react";
import { createPortal } from "react-dom";
export { TextInput } from "./screen-native";
import { View } from "./screen-native";
export function ScrollView({ children, contentContainerStyle, horizontal, style, ...props }) {
  return (
    <View
      {...props}
      style={{
        ...style,
        ...contentContainerStyle,
        flexDirection: horizontal ? "row" : "column",
        overflow: horizontal ? "auto" : undefined,
      }}
    >
      {children}
    </View>
  );
}
export function Icon({ name, size = 18, color = "currentColor" }) {
  const paths = {
    ChevronLeft: ["m15 18-6-6 6-6"],
    ChevronRight: ["m9 18 6-6-6-6"],
    ZoomIn: ["m21 21-4.3-4.3", "M11 8v6", "M8 11h6"],
    ZoomOut: ["m21 21-4.3-4.3", "M8 11h6"],
    Maximize: [
      "M8 3H5a2 2 0 0 0-2 2v3",
      "M16 3h3a2 2 0 0 1 2 2v3",
      "M21 16v3a2 2 0 0 1-2 2h-3",
      "M8 21H5a2 2 0 0 1-2-2v-3",
    ],
    Copy: ["M9 9h13v13H9z", "M5 15H3V3h12v2"],
  };
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name.startsWith("Zoom") ? <circle cx="11" cy="11" r="8" /> : null}
      {(paths[name] ?? ["M12 4v16"]).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function Modal({ title, open, onOpenChange, children }) {
  useEffect(() => {
    if (!open) return;
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onOpenChange]);
  if (!open) return null;
  return createPortal(
    <div
      data-testid="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#0006",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: 560,
          maxWidth: "90vw",
          background: "#fff",
          borderRadius: 12,
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        <header
          style={{ display: "flex", justifyContent: "space-between", padding: 16, fontWeight: 600 }}
        >
          {title}
          <button aria-label="关闭会话选择" onClick={() => onOpenChange(false)}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
Modal.Content = function Content({ children, style, contentContainerStyle }) {
  return <View style={{ ...style, ...contentContainerStyle }}>{children}</View>;
};
