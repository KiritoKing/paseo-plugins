import type { PluginTheme } from "@getpaseo/plugin/client";

const palettes = {
  light: {
    surface0: "#ffffff",
    surface1: "#f1f5f9",
    surface2: "#e2e8f0",
    foreground: "#0f172a",
    foregroundMuted: "#475569",
    border: "#cbd5e1",
    accent: "#2563eb",
    statusDanger: "#b91c1c",
  },
  dark: {
    surface0: "#111827",
    surface1: "#1f2937",
    surface2: "#334155",
    foreground: "#f8fafc",
    foregroundMuted: "#cbd5e1",
    border: "#475569",
    accent: "#60a5fa",
    statusDanger: "#f87171",
  },
} satisfies Record<"light" | "dark", PluginTheme["colors"]>;

/** Synthetic host theme used by Essentials browser fixtures. */
export function syntheticHostTheme(appearance: "light" | "dark"): PluginTheme {
  return { appearance, colors: palettes[appearance] };
}
