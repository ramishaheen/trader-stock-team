// News, Congress, Research (analyst + screener) and Alerts.
import {
  actionBtn, api, badge, check, emptyState, field, filterable, fmt, h, input, load, panel, result,
  run, safeLink, select, table, tickerList, toast, tone,
} from "./ui.js";
import { head } from "./views-plan.js";

const watchTickers = (state) => [
  ...new Set([...(state.portfolio?.positions ?? []).map((p) => p.ticker), ...(state.targets?.weights ?? []).map((w) => w.ticker)]),
];

export function news(root, ctx) {
  const hours = input({ type: "number", value: "48", min: "1", max: "720" });
  const tick = input({ class: "mono", placeholder: watchTickers(ctx.state).join(", ") || "AAPL, KO" });
  const all = check("Include items already seen", true);
  const mark = check("Mark these as seen");
  const out = h("div", {}, emptyState("No check yet", "Leave tickers empty to watch your holdings and targets."));

  const items = (d) => (d.items.length ? h("div", { class: "list" }, d.items.map((n, i) => h("div", { class: "item", style: `--i:${Math.min(i, 20)}` },
    h("div", { class: "item-meta" }, fmt.time(n.time), badge(n.ticker || (n.touches ?? []).join(", ")), h("span", {}, n.source),
      n.kind !== "headline" ? badge(n.kind, "warn") : null, n.new ? badge("new", "ok") : null, ...(n.tags ?? []).map((t) => badge(t))),
    h("div", { class: "item-title" }, safeLink(n.link, n.title)),
    n.summary ? h("div", { class: "small dim" }, n.summary) : null)))
    : emptyState("Nothing new", "No headlines or SEC 8-K filings in that window."));

  const go = actionBtn("Check news", async () => {
    const r = await run("news", { hours: +hours.value || 48, tickers: tickerList(tick.value), all: all.box.checked, mark_seen: mark.box.checked });
    out.replaceChildren(result(r, (d) => filterable(items(d), { label: "Filter headlines", noun: "items" })));
  }, { kind: "primary" });

  root.replaceChildren(
    head("News", "Yahoo Finance headlines and SEC 8-K filings for the stocks you hold or plan to copy."),
    h("div", { class: "grid" },
      panel("Check", { i: 0, body: h("div", { class: "form" }, h("div", { class: "row" }, field("Hours back", hours), field("Tickers", tick, "Empty: holdings and targets")), h("div", { class: "actions" }, all, mark, go)) }),
      panel("Headlines", { i: 1, flush: true, body: out })));
}

function reportView(rep) {
  return h("div", { style: "border-top:1px solid var(--line)" },
    h("div", { class: "item-meta", style: "padding:12px 18px" },
      h("strong", { style: "color:var(--text)" }, rep.name ?? "Filing"), badge(rep.district ?? ""), h("span", {}, `filed ${rep.filed}`),
      rep.url ? safeLink(rep.url, "PDF") : null),
    table([
      { label: "Traded", key: "date", cls: () => "mono" },
      { label: "Owner", render: (r) => r.owner_name || r.owner },
      { label: "Type", render: (r) => badge(r.type_name || r.type, r.type === "P" ? "ok" : r.type?.startsWith("S") ? "bad" : "") },
      { label: "Asset", render: (r) => h("span", {}, r.ticker ? h("strong", { class: "mono" }, `${r.ticker} `) : null, r.asset || r.description || "") },
      { label: "Amount", key: "amount" },
      { label: "Disclosed after", num: true, render: (r) => (r.days_to_disclose == null ? "–" : `${r.days_to_disclose} d`), cls: (r) => (r.late ? "neg" : "") },
    ], rep.rows, "No transactions could be read from this PDF."));
}

export function congress(root, ctx) {
  const member = input({ value: "Pelosi" });
  const year = input({ type: "number", value: String(new Date().getFullYear()), min: "2012" });
  const mark = check("Mark new filings as seen");
  const out = h("div", {}, emptyState("Nothing loaded", "Check for new filings, or browse every filing this year."));
  const params = () => ({ ...(member.value.trim() ? { member: member.value.trim() } : {}), year: +year.value });

  const reports = (d) => (d.reports?.length ? h("div", {}, d.reports.map((x) => reportView(x.report)))
    : emptyState("No new filings", "Nothing posted since your last check."));

  const index = (list) => table([
    { key: "filed", label: "Filed", cls: () => "mono" },
    { key: "name", label: "Member" }, { key: "district", label: "District" },
    { key: "type_name", label: "Report" },
    {
      label: "",
      render: (f) => h("button", {
        type: "button", class: "btn ghost",
        onclick: () => load(out, run("pelosi_fetch", { doc_id: f.doc_id, year: f.year }), (r) => result(r, (rep) => reportView(rep.report ?? rep))),
      }, "Read"),
    },
  ], list, "No filings match.");

  root.replaceChildren(
    head("Congress trades", "Stock trades members of the House disclose under the STOCK Act, read from the Clerk's PDFs. Filed up to 45 days after the trade."),
    h("div", { class: "grid" },
      panel("Filter", {
        i: 0,
        body: h("div", { class: "form" },
          h("div", { class: "row" }, field("Member last name", member, "Empty: every member"), field("Year", year)),
          h("div", { class: "actions" }, mark,
            actionBtn("New filings", async () => {
              const r = await run("pelosi_new", { ...params(), mark_seen: mark.box.checked });
              out.replaceChildren(result(r, reports));
            }, { kind: "primary" }),
            actionBtn("Browse all filings", async () => {
              const r = await run("pelosi_index", { ...params(), limit: 100 });
              out.replaceChildren(result(r, (list) => filterable(index(list), { label: "Filter filings", noun: "filings" })));
            }))),
      }),
      panel("Filings", { i: 1, flush: true, body: out })));
}

const METRICS = ["revenue_growth_yoy", "eps_growth_yoy", "net_income_growth_yoy", "gross_margin", "operating_margin",
  "net_margin", "eps_ttm", "revenue_ttm", "net_income_ttm", "pe", "earnings_yield"];
const OPS = [">", ">=", "<", "<=", "==", "!="];

export function research(root, ctx) {
  const tick = input({ class: "mono", value: watchTickers(ctx.state).join(", ") });
  const quarters = input({ type: "number", value: "4", min: "1", max: "20" });
  const filings = check("Also read the latest earnings release");
  const changes = h("div", {});

  const metricsTable = () => table([
    { key: "ticker", label: "Ticker", cls: () => "mono" }, { key: "name", label: "Company" },
    { key: "period_end", label: "Quarter end", cls: () => "mono" },
    { label: "Revenue TTM", num: true, render: (c) => fmt.big(c.revenue_ttm) },
    { label: "Rev YoY", num: true, render: (c) => fmt.signedPct(c.revenue_growth_yoy), cls: (c) => tone(c.revenue_growth_yoy) },
    { label: "Gross", num: true, render: (c) => fmt.pct(c.gross_margin, 1) },
    { label: "Operating", num: true, render: (c) => fmt.pct(c.operating_margin, 1) },
    { label: "Net", num: true, render: (c) => fmt.pct(c.net_margin, 1) },
    { label: "EPS TTM", num: true, render: (c) => (c.eps_ttm == null ? "–" : (+c.eps_ttm).toFixed(2)) },
    { label: "EPS YoY", num: true, render: (c) => fmt.signedPct(c.eps_growth_yoy), cls: (c) => tone(c.eps_growth_yoy) },
  ], ctx.state.metrics?.companies, "Run the analyst to pull reported numbers from SEC filings.");

  const analyze = actionBtn("Analyze", async () => {
    const r = await run("analyst", { tickers: tickerList(tick.value), quarters: +quarters.value || 4, filings: filings.box.checked });
    changes.replaceChildren(result(r, (list) => h("div", { class: "list" }, list.map((c, i) => h("div", { class: "item", style: `--i:${i}` },
      h("div", { class: "item-title" }, `${c.ticker}  ${c.result?.entity ?? ""}`),
      c.note ? h("div", { class: "small neg" }, c.note) : null,
      h("ul", { class: "small dim", style: "margin:0;padding-left:18px" }, (c.changes ?? []).map((x) => h("li", {}, x))))))));
    await ctx.refreshQuiet();
    metricsSlot.replaceChildren(metricsTable());
  }, { kind: "primary" });
  const metricsSlot = h("div", {}, metricsTable());

  root.replaceChildren(
    head("Research", "Reported numbers from SEC XBRL filings, and a screener that checks them against your own rules."),
    h("div", { class: "grid" },
      panel("Earnings analyst", {
        i: 0,
        body: h("div", { class: "form" },
          h("div", { class: "row" }, field("Tickers", tick), field("Quarters", quarters)),
          h("div", { class: "actions" }, filings, analyze), changes),
      }),
      panel("Latest metrics", { i: 1, flush: true, sub: ctx.state.metrics?.as_of ? `as of ${ctx.state.metrics.as_of}` : "", body: metricsSlot }),
      screener(ctx)));
}

function screener(ctx) {
  const doc = ctx.state.rules ?? { name: "My screen", rules: [], rank: [], missing: "fail", top: 10 };
  let rules = (doc.rules ?? []).map((r) => ({ ...r }));
  const name = input({ value: doc.name ?? "" });
  const list = h("div", {});
  const out = h("div", {});
  const metricList = h("datalist", { id: "metric-names" }, METRICS.map((m) => h("option", { value: m })));

  const setRule = (i, patch) => { rules = rules.map((r, j) => (j === i ? { ...r, ...patch } : r)); };
  const draw = () => list.replaceChildren(rules.length ? h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Metric", "Test", "Value", ""].map((t) => h("th", {}, t)))),
    h("tbody", {}, rules.map((r, i) => {
      const op = select(OPS.map((o) => [o, o]), r.op);
      op.addEventListener("change", () => setRule(i, { op: op.value }));
      return h("tr", {},
        h("td", {}, input({ class: "mono", list: "metric-names", value: r.metric, "aria-label": "Metric", oninput: (e) => setRule(i, { metric: e.target.value.trim() }) })),
        h("td", {}, op),
        h("td", {}, input({ type: "number", step: "any", value: r.value, "aria-label": "Value", oninput: (e) => setRule(i, { value: +e.target.value }) })),
        h("td", {}, h("button", { type: "button", class: "btn ghost danger", onclick: () => { rules = rules.filter((_, j) => j !== i); draw(); } }, "Remove")));
    }))))
    : emptyState("No rules", "Add a rule such as pe <= 30."));
  draw();

  const save = async () => {
    await api("PUT", "/api/files/rules", { ...doc, name: name.value || "My screen", rules });
    await ctx.refreshQuiet();
  };

  const verdicts = (d) => h("div", {},
    table([
      { label: "Rank", render: (p) => String(d.passed.indexOf(p) + 1), num: true },
      { key: "ticker", label: "Ticker", cls: () => "mono" }, { key: "name", label: "Company" },
      { label: "Score", num: true, render: (p) => (+p.score).toFixed(2) },
      { label: "Why", render: (p) => p.why.join("; "), cls: () => "small" },
    ], d.passed, "Nothing passes every rule."),
    d.failed?.length ? h("div", { style: "border-top:1px solid var(--line)" }, table([
      { key: "ticker", label: "Failed", cls: () => "mono" },
      { label: "Why", render: (f) => f.why.join("; "), cls: () => "small dim" },
    ], d.failed)) : null);

  return panel("Screener", {
    sub: "Rules run against the metrics above and today's prices.",
    i: 2,
    body: h("div", { class: "form" }, metricList, field("Screen name", name), list,
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn", onclick: () => { rules = [...rules, { metric: "pe", op: "<=", value: 30 }]; draw(); } }, "Add rule"),
        actionBtn("Save rules", async () => { await save(); toast("Screener rules saved"); }),
        actionBtn("Save and run", async () => {
          await save();
          const r = await run("screen");
          out.replaceChildren(result(r, verdicts));
        }, { kind: "primary" })),
      out),
  });
}

export function alerts(root, ctx) {
  const rules = ctx.state.alerts?.rules ?? [];
  const rung = ctx.state.alerts_state?.rung ?? {};
  const kind = select([["above", "Price at or above"], ["below", "Price at or below"], ["stop", "Stop (at or below)"], ["pct_move", "Moves % from prev close"], ["opening_bell", "Opening bell"]], "above");
  const sym = input({ class: "mono", placeholder: "AAPL" });
  const val = input({ type: "number", step: "any", placeholder: "350" });
  const note = input({ placeholder: "Optional" });
  const rearm = check("Re-arm after it rings");
  const out = h("div", {});

  const del = (id) => actionBtn("Delete", async () => {
    await api("PUT", "/api/files/alerts", { ...(ctx.state.alerts ?? {}), rules: rules.filter((r) => r.id !== id) });
    toast("Alert deleted");
    await ctx.refresh();
  }, { kind: "ghost danger" });

  const list = table([
    { key: "id", label: "Rule", cls: () => "mono small" },
    { label: "Ticker", render: (r) => r.symbol ?? "–", cls: () => "mono" },
    { label: "Condition", render: (r) => (r.type === "opening_bell" ? "NYSE opens" : r.type === "pct_move" ? `moves ${r.pct}%` : `${r.type} ${fmt.usd(r.price)}`) },
    { label: "Note", render: (r) => r.note ?? "" },
    { label: "Status", render: (r) => (rung[r.id] ? badge(`rang ${fmt.time(rung[r.id])}`, "warn") : badge("armed", "ok")) },
    {
      label: "",
      render: (r) => h("span", { class: "actions" },
        rung[r.id] ? actionBtn("Re-arm", async () => { const x = await run("alerts_reset", { id: r.id }); if (x.error) throw new Error(x.error); await ctx.refresh(); }, { kind: "ghost" }) : null,
        del(r.id)),
    },
  ], rules, "No alerts yet. Add one on the left.");

  const add = actionBtn("Add alert", async () => {
    const r = await run("alerts_add", { kind: kind.value, symbol: sym.value, value: +val.value, note: note.value || undefined, rearm: rearm.box.checked });
    if (r.error) throw new Error(r.error);
    toast("Alert added");
    await ctx.refresh();
  }, { kind: "primary" });

  const checkNow = actionBtn("Check now", async () => {
    const r = await run("alerts_check");
    out.replaceChildren(result(r, (d) => h("div", { class: "form" },
      h("p", { class: "note" }, d.market.open ? `NYSE open, closes ${d.market.closes}` : `NYSE closed (${d.market.reason}). Next open ${d.market.next_open}.`),
      d.rings.length ? h("div", { class: "list" }, d.rings.map((x) => h("div", { class: "item" }, h("div", { class: "item-title" }, x.message ?? JSON.stringify(x)))))
        : emptyState("Nothing rang", "No rule's condition is met right now."),
      d.errors?.length ? h("p", { class: "note warn" }, d.errors.join("; ")) : null)));
    await ctx.refreshQuiet();
  });

  root.replaceChildren(
    head("Alerts", "Price targets, stops, big moves and the opening bell. Each rings once until you re-arm it."),
    h("div", { class: "grid two" },
      panel("Rules", { i: 0, flush: true, body: list, actions: checkNow }),
      panel("New alert", {
        i: 1,
        body: h("div", { class: "form" },
          field("Kind", kind), h("div", { class: "row" }, field("Ticker", sym), field("Price or %", val)),
          field("Note", note), h("div", { class: "actions" }, rearm, add), out),
      })));
}
