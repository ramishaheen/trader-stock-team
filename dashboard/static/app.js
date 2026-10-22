// Router and shared state for the dashboard.
import { actionBtn, api, errorBox, fmt, h, skeleton, toast } from "./ui.js";
import { icon } from "./icons.js";
import { themeToggle } from "./theme.js";
import { copycat, orders, overview } from "./views-plan.js";
import { alerts, congress, news, research } from "./views-watch.js";
import { holdings, settings, tax } from "./views-books.js";
import { team } from "./views-team.js";

const VIEWS = [
  ["team", "Team", team],
  ["overview", "Overview", overview, (s) => s.targets?.weights?.length],
  ["copycat", "Copycat", copycat],
  ["orders", "Orders", orders, (s) => s.orders?.orders?.length],
  ["news", "News", news],
  ["congress", "Congress", congress],
  ["research", "Research", research, (s) => s.metrics?.companies?.length],
  ["alerts", "Alerts", alerts, (s) => s.alerts?.rules?.length],
  ["holdings", "Holdings", holdings, (s) => s.portfolio?.positions?.length],
  ["tax", "Tax", tax],
  ["settings", "Settings", settings],
];

const view = document.getElementById("view");
const nav = document.getElementById("nav");
const ctx = {
  state: {},
  // Reload the trader/ files and redraw the current page.
  async refresh() {
    await ctx.refreshQuiet();
    render();
  },
  // Reload the files without redrawing (keeps on-screen results).
  async refreshQuiet() {
    ctx.state = await api("GET", "/api/state");
    drawNav();
  },
};

const current = () => {
  const name = location.hash.slice(1);
  return VIEWS.find(([n]) => n === name) ?? VIEWS[0];
};

function drawNav() {
  const [active] = current();
  nav.replaceChildren(...VIEWS.map(([name, label, , count]) => {
    const n = count ? count(ctx.state) : null;
    return h("button", {
      type: "button", "aria-current": name === active ? "page" : null,
      onclick: () => { location.hash = name; },
    }, icon(name), h("span", { class: "nav-label" }, label), n ? h("span", { class: "count" }, String(n)) : null);
  }));
}

// Right side of every page header: data freshness and a reload.
function pageMeta() {
  const asOf = ctx.state.prices?.as_of;
  return h("div", { class: "view-meta" },
    h("span", { class: "meta-time" }, asOf ? `Data as of ${fmt.time(asOf)}` : "No price data yet"),
    actionBtn(h("span", { class: "btn-label" }, icon("refresh", 16), "Reload data"), async () => {
      await ctx.refresh();
      toast("Data reloaded");
    }, { kind: "ghost", title: "Re-read the trader/ files" }));
}

function render() {
  const [, , draw] = current();
  // Stop the previous page's timers (the Team board polls for activity).
  ctx.cleanup?.();
  ctx.cleanup = null;
  drawNav();
  try {
    draw(view, ctx);
    view.querySelector(".view-head")?.append(pageMeta());
  } catch (e) {
    view.replaceChildren(errorBox(`This page failed to draw: ${e.message}`));
  }
  view.focus({ preventScroll: true });
}

async function clock() {
  const el = document.getElementById("market");
  try {
    const r = await api("POST", "/api/run/clock", {});
    const m = r.data;
    if (!m) throw new Error(r.error || "no clock");
    el.replaceChildren(h("span", { class: m.open ? "dot open" : "dot" }),
      h("span", {}, m.open ? `NYSE open until ${m.early_close ?? m.closes}` : `NYSE closed, opens ${m.next_open.slice(5)}`));
  } catch {
    el.replaceChildren(h("span", { class: "dot" }), h("span", {}, "Market status unavailable"));
  }
}

window.addEventListener("hashchange", () => { render(); window.scrollTo({ top: 0 }); });

document.getElementById("theme").replaceChildren(themeToggle());

(async function start() {
  view.replaceChildren(skeleton(8));
  try {
    await ctx.refreshQuiet();
    render();
  } catch (e) {
    view.replaceChildren(errorBox(e.message));
    toast(e.message, "bad");
  }
  clock();
  setInterval(clock, 60_000);
})();
