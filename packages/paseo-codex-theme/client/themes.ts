import type { PluginThemeContribution } from "@getpaseo/plugin";

// Codex-inspired palettes; Paseo derives its native surfaces and semantic colors.
// Keep the original blue accents for links, controls and selection.
export const codexThemes: PluginThemeContribution[] = [
  {
    id: "codex-light",
    name: "Codex Light",
    appearance: "light",
    colors: {
      background: "#ffffff",
      foreground: "#181818",
      raised: "#fafafa",
      control: "#f3f3f3",
      border: "#e4e4e4",
      accent: "#0969da",
      mutedForeground: "#6b6b6b",
      // Paseo also uses this as the light sidebar's selected-row fill.
      ring: "#e4edf9",
    },
  },
  {
    id: "codex-dark",
    name: "Codex Dark",
    appearance: "dark",
    colors: {
      background: "#181818",
      foreground: "#ededed",
      raised: "#222222",
      control: "#2b2b2b",
      border: "#3a3a3a",
      accent: "#6cb6ff",
      mutedForeground: "#a3a3a3",
      ring: "#777777",
    },
  },
];
