import {
  applyModsyncTheme,
  initModsyncTheme,
  type ModsyncThemeId,
} from "@openkotor/modsync-tokens/theme";

function wireThemeSwitcher(): void {
  const current = initModsyncTheme(document.documentElement);
  const buttons = document.querySelectorAll<HTMLButtonElement>(".modsync-hub__theme-seg[data-theme]");
  for (const button of buttons) {
    const id = button.dataset.theme as ModsyncThemeId;
    if (id === current) {
      button.classList.add("modsync-hub__theme-seg--active");
    }
    button.addEventListener("click", () => {
      applyModsyncTheme(id, document.documentElement);
      for (const peer of buttons) {
        peer.classList.toggle("modsync-hub__theme-seg--active", peer === button);
      }
    });
  }
}

wireThemeSwitcher();

const hubLink = document.getElementById("hub-link") as HTMLAnchorElement | null;
if (hubLink) {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
  hubLink.href = base && base !== "/" ? `${base}/` : "/";
}
