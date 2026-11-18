// Light / dark theme, shared by the live map and the About page.
// Default: follow the system setting. A choice made with the toggle is remembered
// in this browser only (localStorage, wrapped because it can be blocked).
export type Theme = "dark" | "light";
const KEY = "flive-theme";

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* storage blocked: fall through to the system setting */ }
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme, remember = false) {
  document.documentElement.dataset.theme = theme;
  if (remember) {
    try { localStorage.setItem(KEY, theme); } catch { /* not saved, still applied */ }
  }
}
