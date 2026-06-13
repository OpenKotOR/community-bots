/** ModSync shell themes (K1 default, TSL, Light installer). */
export type ModsyncThemeId = "k1" | "tsl" | "light";

const STORAGE_KEY = "openkotor.modsync.theme";

const THEME_CLASS: Record<ModsyncThemeId, string | null> = {
  k1: null,
  tsl: "theme-tsl",
  light: "theme-light",
};

export function readStoredModsyncTheme(): ModsyncThemeId {
  if (typeof localStorage === "undefined") {
    return "k1";
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "tsl" || raw === "light" || raw === "k1") {
    return raw;
  }
  return "k1";
}

export function applyModsyncTheme(theme: ModsyncThemeId, root: HTMLElement = document.documentElement): void {
  root.classList.remove("theme-tsl", "theme-light");
  const cls = THEME_CLASS[theme];
  if (cls) {
    root.classList.add(cls);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

export function initModsyncTheme(root: HTMLElement = document.documentElement): ModsyncThemeId {
  const theme = readStoredModsyncTheme();
  applyModsyncTheme(theme, root);
  return theme;
}
