// Selectable themes. Each id except "system" is a token block `:root[data-theme="<id>"]` in index.css
// (checked by themes.check.ts); "system" picks light or dark from the OS.
export const THEMES = [
  { id: "system", label: "Follow system" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** A stored value from an older or newer build may be unknown; it falls back to "system". */
export function resolveTheme(theme: string | null | undefined): ThemeId {
  return THEMES.find((t) => t.id === theme)?.id ?? "system";
}
