// Light / Dark / System switch. "System" removes data-theme so the CSS
// prefers-color-scheme block decides. theme-init.js applies the choice before paint.
import { h } from "./ui.js";
import { icon } from "./icons.js";

const KEY = "trader-desk-theme";
const MODES = [["light", "Light", "sun"], ["dark", "Dark", "moon"], ["system", "System", "monitor"]];

function saved() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(mode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch { /* storage blocked: the choice lasts for this page only */ }
}

export function themeToggle() {
  const current = saved();
  const buttons = MODES.map(([mode, label, ic]) => h("button", {
    type: "button", "data-mode": mode, "aria-pressed": String(mode === current), title: `${label} theme`,
    onclick: () => {
      apply(mode);
      for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    },
  }, icon(ic, 16), h("span", {}, label)));
  return h("div", { class: "theme-toggle", role: "group", "aria-label": "Color theme" }, buttons);
}
