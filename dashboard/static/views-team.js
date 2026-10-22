// Team: every skill as an agent on a live graph. Agents animate while they work,
// and finished work travels along the edges to the agents that read it next.
import { actionBtn, api, badge, emptyState, h, panel, run, toast } from "./ui.js";
import { character, s } from "./characters.js";
import { head } from "./views-plan.js";

const W = 1100, H = 720;

const tickersOf = (st) => [...new Set([...(st.portfolio?.positions ?? []).map((p) => p.ticker), ...(st.targets?.weights ?? []).map((w) => w.ticker)])];

export const AGENTS = [
  { id: "copycat", name: "Copycat", role: "Researcher", x: 120, y: 90, page: "copycat",
    desc: "Reads a fund's quarterly 13F filing and turns it into target weights.", reads: "SEC EDGAR 13F", writes: "targets",
    quick: (st) => (st.targets?.cik ? { action: "copycat_diff", label: "Check fund changes", params: { cik: st.targets.cik.replace(/^0+/, "") } } : null) },
  { id: "alerts", name: "Watcher", role: "Prices & alerts", x: 120, y: 225, page: "alerts",
    desc: "Fetches delayed quotes, keeps the NYSE clock and rings your price alerts.", reads: "Yahoo, Stooq", writes: "prices",
    quick: (st) => ({ action: "quote", label: "Refresh prices", params: { tickers: tickersOf(st) } }) },
  { id: "analyst", name: "Analyst", role: "Earnings", x: 120, y: 360, page: "research",
    desc: "Pulls reported revenue, margins and EPS from SEC XBRL filings.", reads: "SEC XBRL", writes: "metrics",
    quick: (st) => (tickersOf(st).length ? { action: "analyst", label: "Read earnings", params: { tickers: tickersOf(st), quarters: 4 } } : null) },
  { id: "news", name: "Reporter", role: "News", x: 120, y: 495, page: "news",
    desc: "Watches headlines and 8-K filings for everything you hold or plan to buy.", reads: "Yahoo RSS, SEC 8-K", writes: "briefing",
    quick: () => ({ action: "news", label: "Scan the news", params: { hours: 48, all: true } }) },
  { id: "pelosi", name: "Investigator", role: "Congress trades", x: 120, y: 630, page: "congress",
    desc: "Reads House members' stock trade disclosures as they are posted.", reads: "House Clerk PTRs", writes: "filings",
    quick: () => ({ action: "pelosi_new", label: "Check new filings", params: { member: "Pelosi", year: new Date().getFullYear() } }) },
  { id: "budget", name: "Planner", role: "Budget", x: 400, y: 120, page: "orders",
    desc: "Sizes each target to your budget, keeps the cash buffer and caps any one stock.", reads: "targets, prices", writes: "orders",
    quick: () => ({ action: "budget", label: "Size to budget", params: {} }) },
  { id: "rebalance", name: "Balancer", role: "Rebalance", x: 400, y: 300, page: "holdings",
    desc: "Measures drift from your targets and proposes trades outside the band.", reads: "holdings, targets, prices", writes: "orders",
    quick: (st) => (st.portfolio ? { action: "rebalance", label: "Measure drift", params: { band: 5 } } : null) },
  { id: "screener", name: "Scout", role: "Screener", x: 400, y: 480, page: "research",
    desc: "Checks companies against your rules and ranks the ones that pass.", reads: "metrics, prices", writes: "shortlist",
    quick: () => ({ action: "screen", label: "Run the screen", params: {} }) },
  { id: "risk", name: "Guard", role: "Risk", x: 660, y: 190, page: "orders",
    desc: "Blocks any order that breaks your limits before it can reach a ticket.", reads: "orders, prices, config", writes: "verdicts",
    quick: () => ({ action: "risk", label: "Check every order", params: {} }) },
  { id: "tax", name: "Accountant", role: "Tax", x: 660, y: 365, page: "tax",
    desc: "Tracks cost-basis lots, gains, loss harvesting and wash sales.", reads: "holdings, prices", writes: "harvest sells",
    quick: (st) => (st.portfolio ? { action: "tax_report", label: "Tot up gains", params: {} } : null) },
  { id: "broker", name: "Trader", role: "Order desk", x: 880, y: 190, page: "orders",
    desc: "Turns passed orders into tickets. You place them yourself, in your broker's app.", reads: "orders, verdicts", writes: "tickets",
    quick: () => ({ action: "tickets", label: "Prepare tickets", params: {} }) },
];

const EDGES = [
  ["copycat", "budget", "targets"], ["copycat", "rebalance", "targets"],
  ["alerts", "budget", "prices"], ["alerts", "rebalance", "prices"], ["alerts", "risk", "prices"], ["alerts", "tax", "prices"],
  ["analyst", "screener", "metrics"],
  ["budget", "risk", "orders"], ["rebalance", "risk", "orders"], ["tax", "risk", "sells"],
  ["risk", "broker", "verdicts"],
  ["broker", "you", "tickets"], ["news", "you", "briefing"], ["pelosi", "you", "filings"], ["screener", "you", "shortlist"],
];
const YOU = { id: "you", x: 1030, y: 545 };
const LANES = [["Gather", 120], ["Decide", 400], ["Guard", 660], ["Deliver", 880]];
const pos = (id) => (id === "you" ? YOU : AGENTS.find((a) => a.id === id));
const curve = (a, b) => {
  const dx = Math.max(60, (b.x - a.x) / 2);
  return `M${a.x + 34} ${a.y} C${a.x + 34 + dx} ${a.y}, ${b.x - 34 - dx} ${b.y}, ${b.x - 34} ${b.y}`;
};

const ago = (t, now) => {
  const sec = Math.max(0, Math.round(now - t));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
};

export function team(root, ctx) {
  let selected = ctx.teamSelected ?? "budget";
  let snap = { running: [], recent: [], now: Date.now() / 1000 };
  let seen = null; // ids of finished tasks already animated
  const nodes = {}, edgeEls = [];

  const svg = s("svg", { class: "wires", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" },
    s("defs", {}, s("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" },
      s("path", { d: "M0 0 L10 5 L0 10 z", class: "arrowhead" }))));
  const labelled = new Set();
  for (const [from, to, label] of EDGES) {
    const d = curve(pos(from), pos(to));
    const path = s("path", { d, class: "wire", "marker-end": "url(#arrow)" });
    svg.append(path);
    // One label per source and file, placed near the source so labels don't pile up mid-board.
    if (!labelled.has(from + label)) {
      labelled.add(from + label);
      const a = pos(from), b = pos(to);
      svg.append(s("text", { x: a.x + 34 + (b.x - a.x - 68) * 0.3, y: a.y + (b.y - a.y) * 0.12 - 7, class: "wire-label", "text-anchor": "middle" },
        document.createTextNode(label)));
    }
    edgeEls.push({ from, to, d, path });
  }

  const board = h("div", { class: "board", role: "group", "aria-label": "Agent team graph" },
    LANES.map(([name, x]) => h("div", { class: "lane", style: `left:${(x / W) * 100}%` }, name)), svg);

  for (const a of AGENTS) {
    const status = h("div", { class: "agent-status" }, "idle");
    const bubble = h("div", { class: "bubble", "aria-live": "polite" });
    const el = h("button", {
      type: "button", class: `agent role-${a.id}`, style: `left:${(a.x / W) * 100}%;top:${(a.y / H) * 100}%`,
      "aria-pressed": a.id === selected ? "true" : "false",
      onclick: () => { selected = a.id; ctx.teamSelected = a.id; drawSelection(); },
    }, bubble, character(a.id, 58), h("div", { class: "agent-name" }, a.name), h("div", { class: "agent-role" }, a.role), status);
    nodes[a.id] = { el, status, bubble };
    board.append(el);
  }
  board.append(h("div", { class: "you-node", style: `left:${(YOU.x / W) * 100}%;top:${(YOU.y / H) * 100}%` },
    h("div", { class: "you-mark" }, "You"), h("div", { class: "agent-role" }, "decide and place orders in your broker")));

  const detail = h("div", {});
  const feed = h("div", {});
  const stats = h("div", { class: "team-stats" });

  function lastFor(id) { return snap.recent.find((t) => t.agent === id); }

  function drawSelection() {
    for (const a of AGENTS) nodes[a.id].el.setAttribute("aria-pressed", a.id === selected ? "true" : "false");
    const a = AGENTS.find((x) => x.id === selected);
    const q = a.quick(ctx.state);
    const mine = snap.recent.filter((t) => t.agent === a.id).slice(0, 6);
    detail.replaceChildren(h("div", { class: "agent-detail" },
      h("div", { class: "agent-detail-head" }, character(a.id, 84),
        h("div", {}, h("h3", {}, `${a.name}`), h("div", { class: "dim" }, `${a.role} agent`), h("p", {}, a.desc),
          h("div", { class: "item-meta" }, badge(`reads ${a.reads}`), badge(`writes ${a.writes}`)))),
      h("div", { class: "actions" },
        q ? actionBtn(q.label, async () => {
          const r = await run(q.action, q.params);
          if (r.error) throw new Error(r.error);
          toast(`${a.name}: done`);
          await ctx.refreshQuiet();
        }, { kind: "primary" }) : h("span", { class: "small dim" }, "Needs setup first: open its page."),
        h("button", { type: "button", class: "btn", onclick: () => { location.hash = a.page; } }, `Open ${a.page[0].toUpperCase()}${a.page.slice(1)}`)),
      h("div", { class: "small dim", style: "margin-top:6px" }, "Recent tasks"),
      mine.length ? h("div", { class: "list mini" }, mine.map((t) => taskRow(t, false))) : emptyState("No tasks yet", "Run its task above, or use its page.")));
  }

  function taskRow(t, withAvatar = true) {
    return h("div", { class: "item task" },
      h("div", { class: "task-line" },
        withAvatar ? h("span", { class: "task-av" }, character(t.agent, 26)) : null,
        h("div", { class: "task-main" },
          h("div", {}, h("strong", {}, AGENTS.find((a) => a.id === t.agent)?.name ?? t.agent), " ", h("span", { class: "dim" }, t.label)),
          h("div", { class: `small ${t.ok === false ? "neg" : "dim"}` }, t.summary ?? "working…")),
        h("div", { class: "task-meta" }, t.finished ? badge(t.ok ? "done" : "failed", t.ok ? "ok" : "bad") : badge("working", "warn"),
          h("div", { class: "small dim mono" }, t.finished ? `${(t.ms / 1000).toFixed(1)}s · ${ago(t.finished, snap.now)}` : `${Math.round(snap.now - t.started)}s`))));
  }

  function fly(fromId, ok) {
    for (const e of edgeEls.filter((x) => x.from === fromId)) {
      const dot = s("circle", { r: 6, class: ok ? "packet" : "packet bad" },
        s("animateMotion", { dur: "1.1s", path: e.d, fill: "freeze", calcMode: "spline", keyTimes: "0;1", keySplines: "0.16 1 0.3 1" }));
      svg.append(dot);
      dot.querySelector("animateMotion").beginElement?.();
      setTimeout(() => {
        dot.remove();
        if (e.to !== "you" && nodes[e.to]) {
          nodes[e.to].el.classList.add("received");
          setTimeout(() => nodes[e.to]?.el.classList.remove("received"), 900);
        }
      }, 1150);
    }
  }

  function paint() {
    const working = new Set(snap.running.map((t) => t.agent));
    for (const a of AGENTS) {
      const n = nodes[a.id];
      const task = snap.running.find((t) => t.agent === a.id);
      const last = lastFor(a.id);
      n.el.classList.toggle("working", !!task);
      n.bubble.textContent = task ? `${task.label}…` : "";
      n.status.textContent = task ? `${Math.max(0, Math.round(snap.now - task.started))}s` : last ? `${last.summary} · ${ago(last.finished, snap.now).replace(" ago", "")}` : "idle";
      n.status.className = `agent-status ${!task && last && !last.ok ? "neg" : ""}`;
    }
    for (const e of edgeEls) e.path.classList.toggle("flowing", working.has(e.from));
    const today = snap.recent.filter((t) => snap.now - t.finished < 86400);
    stats.replaceChildren(
      ...[["Working now", snap.running.length], ["Tasks today", today.length], ["Failed today", today.filter((t) => !t.ok).length],
        ["Agents", AGENTS.length]].map(([k, v]) => h("div", {}, h("div", { class: "stat-label" }, k), h("div", { class: "stat-value" }, String(v)))));
    const rows = [...snap.running.map((t) => ({ ...t })), ...snap.recent].slice(0, 25);
    feed.replaceChildren(rows.length ? h("div", { class: "list" }, rows.map((t) => taskRow(t))) : emptyState("Quiet so far", "Click an agent and run its task, or work on any page. Every task shows up here."));
  }

  async function poll() {
    try {
      const next = await api("GET", "/api/activity");
      const fresh = seen ? next.recent.filter((t) => !seen.has(t.id + ":" + t.finished)) : [];
      seen = new Set(next.recent.map((t) => t.id + ":" + t.finished));
      snap = next;
      paint();
      for (const t of fresh) {
        fly(t.agent, t.ok);
        const n = nodes[t.agent];
        if (n) { n.el.classList.add(t.ok ? "done" : "failed"); setTimeout(() => n.el.classList.remove("done", "failed"), 1600); }
      }
      if (fresh.some((t) => t.agent === selected)) drawSelection();
    } catch (e) {
      stats.replaceChildren(h("div", { class: "error-box" }, e.message));
    }
  }

  root.replaceChildren(
    head("Team", "Each skill is an agent. Watch who is working, what they hand to whom, and what they found. Click an agent to put it to work."),
    h("div", { class: "grid" },
      panel("Live board", { flush: true, i: 0, body: h("div", {}, stats, h("div", { class: "board-scroll" }, board)) }),
      h("div", { class: "grid two" },
        panel("Activity", { sub: "Every task any agent ran, newest first. Kept in trader/state/activity.json.", flush: true, i: 1, body: feed }),
        panel("Agent", { i: 2, body: detail }))));

  paint();
  drawSelection();
  poll();
  const timer = setInterval(poll, 1500);
  ctx.cleanup = () => clearInterval(timer);
}
