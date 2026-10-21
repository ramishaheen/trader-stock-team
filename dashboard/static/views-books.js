// Holdings (portfolio + rebalance), Tax and Settings.
import {
  actionBtn, api, badge, check, emptyState, errorBox, field, fmt, h, input, load, panel, result,
  run, select, table, toast, tone,
} from "./ui.js";
import { head } from "./views-plan.js";

const today = () => new Date().toISOString().slice(0, 10);

export function holdings(root, ctx) {
  let doc = structuredClone(ctx.state.portfolio ?? { cash: 0, positions: [] });
  const cash = input({ type: "number", step: "0.01", min: "0", value: doc.cash ?? 0 });
  const lotsBody = h("div", {});

  const lots = () => doc.positions.flatMap((p) => (p.lots ?? []).map((l) => ({ ...l, ticker: p.ticker })));
  const drawLots = () => lotsBody.replaceChildren(table([
    { key: "ticker", label: "Ticker", cls: () => "mono" }, { key: "id", label: "Lot", cls: () => "mono small" },
    { key: "date", label: "Bought", cls: () => "mono" },
    { label: "Shares", num: true, render: (l) => fmt.num(l.shares) },
    { label: "Cost", num: true, render: (l) => fmt.usd(l.cost) },
    { label: "Per share", num: true, render: (l) => fmt.usd(l.cost / l.shares) },
    {
      label: "",
      render: (l) => h("button", {
        type: "button", class: "btn ghost danger",
        onclick: () => {
          doc = { ...doc, positions: doc.positions.map((p) => (p.ticker === l.ticker ? { ...p, lots: p.lots.filter((x) => x.id !== l.id) } : p)).filter((p) => p.lots?.length) };
          drawLots();
        },
      }, "Remove"),
    },
  ], lots(), "No holdings yet. Add the lots you own, or record a fill from your broker."));
  drawLots();

  const t = input({ class: "mono", placeholder: "KO" });
  const d = input({ type: "date", value: today() });
  const sh = input({ type: "number", step: "any", min: "0" });
  const cost = input({ type: "number", step: "0.01", min: "0", placeholder: "Total paid" });
  const addLot = h("button", {
    type: "button", class: "btn",
    onclick: () => {
      const ticker = t.value.trim().toUpperCase();
      if (!ticker || !(+sh.value > 0) || !(+cost.value >= 0) || !d.value) return toast("Fill in ticker, date, shares and cost", "bad");
      const pos = doc.positions.find((p) => p.ticker === ticker);
      const lot = { id: `${ticker}-${(pos?.lots?.length ?? 0) + 1}-${Date.now() % 100000}`, date: d.value, shares: +sh.value, cost: +cost.value };
      doc = pos
        ? { ...doc, positions: doc.positions.map((p) => (p === pos ? { ...p, lots: [...p.lots, lot] } : p)) }
        : { ...doc, positions: [...doc.positions, { ticker, lots: [lot] }] };
      drawLots();
    },
  }, "Add lot");

  const save = actionBtn("Save holdings", async () => {
    await api("PUT", "/api/files/portfolio", { ...doc, cash: +cash.value || 0 });
    toast("Holdings saved");
    await ctx.refresh();
  }, { kind: "primary" });

  // Record a fill that happened at your broker: adds a lot (buy) or removes shares (sell).
  const fs = input({ class: "mono", placeholder: "AAPL" });
  const side = select([["buy", "Bought"], ["sell", "Sold"]], "buy");
  const fq = input({ type: "number", step: "any", min: "0" });
  const fp = input({ type: "number", step: "0.0001", min: "0" });
  const fd = input({ type: "date", value: today() });
  const recordFill = actionBtn("Record fill", async () => {
    const r = await run("record_fill", { symbol: fs.value, side: side.value, qty: +fq.value, price: +fp.value, date: fd.value });
    if (r.error) throw new Error(r.error);
    toast(r.text?.split("\n")[0] || "Fill recorded");
    await ctx.refresh();
  });

  const band = input({ type: "number", value: "5", min: "0", max: "100", step: "0.5" });
  const untracked = check("Sell holdings that are not in the targets");
  const writeOrders = check("Write trades to orders.json");
  const rebOut = h("div", {});
  const rebalance = actionBtn("Rebalance", async () => {
    const r = await run("rebalance", { band: +band.value, sell_untracked: untracked.box.checked, write: writeOrders.box.checked });
    rebOut.replaceChildren(result(r, (x) => h("div", {},
      h("p", { class: "note", style: "margin:12px 18px" }, `Account ${fmt.usd(x.account_value)}, cash ${fmt.usd(x.cash)}, band ${x.band} points. Cash after trades ${fmt.usd(x.cash_after)}.`),
      table([
        { key: "ticker", label: "Ticker", cls: () => "mono" },
        { label: "Value", num: true, render: (w) => fmt.usd(w.value) },
        { label: "Now", num: true, render: (w) => fmt.pct(w.current_pct) },
        { label: "Target", num: true, render: (w) => fmt.pct(w.target_pct) },
        { label: "Drift", num: true, render: (w) => `${w.drift > 0 ? "+" : ""}${(+w.drift).toFixed(2)}`, cls: (w) => tone(w.drift) },
        { label: "Action", render: (w) => badge(w.action, w.action === "hold" ? "" : w.action === "buy" ? "ok" : "warn") },
      ], x.rows),
      ...(x.notes ?? []).map((n) => h("p", { class: "note", style: "margin:8px 18px" }, n)))));
    if (writeOrders.box.checked && r.ok) { toast("Rebalance trades written. Run the risk check on Orders."); await ctx.refreshQuiet(); }
  }, { kind: "primary" });

  root.replaceChildren(
    head("Holdings", "What you own, lot by lot. Tax, rebalance, news and Congress alerts all read this."),
    h("div", { class: "grid two" },
      panel("Lots", {
        i: 0, flush: true, body: lotsBody,
        actions: [field("Cash", cash), save],
      }),
      h("div", { class: "grid" },
        panel("Add a lot", { i: 1, body: h("div", { class: "form" }, h("div", { class: "row" }, field("Ticker", t), field("Bought on", d)), h("div", { class: "row" }, field("Shares", sh), field("Total cost", cost)), h("div", { class: "actions" }, addLot), h("small", { class: "dim" }, "Then Save holdings.")) }),
        panel("Record a broker fill", { i: 2, sub: "Saves straight to your holdings.", body: h("div", { class: "form" }, h("div", { class: "row" }, field("Ticker", fs), field("Side", side)), h("div", { class: "row" }, field("Shares", fq), field("Fill price", fp), field("Date", fd)), h("div", { class: "actions" }, recordFill)) }))),
    h("div", { style: "margin-top:16px" },
      panel("Rebalance", {
        i: 3, flush: true,
        body: h("div", {}, h("div", { class: "form", style: "padding:16px 18px" }, h("div", { class: "row" }, field("Band (points)", band), h("div", {}, untracked), h("div", {}, writeOrders), h("div", {}, rebalance))), rebOut),
      })));
}

export function tax(root, ctx) {
  const report = h("div", {});
  if (ctx.state.portfolio?.positions?.length) {
    load(report, run("tax_report"), (r) => result(r, (d) => h("div", {},
      table([
        { key: "ticker", label: "Ticker", cls: () => "mono" },
        { label: "Shares", num: true, render: (p) => fmt.num(p.shares) },
        { label: "Cost", num: true, render: (p) => fmt.usd(p.cost) },
        { label: "Value", num: true, render: (p) => fmt.usd(p.value) },
        { label: "Short-term", num: true, render: (p) => fmt.usd(p.short), cls: (p) => tone(p.short) },
        { label: "Long-term", num: true, render: (p) => fmt.usd(p.long), cls: (p) => tone(p.long) },
        { label: "Gain", num: true, render: (p) => `${fmt.usd(p.gain)} (${fmt.signedPct(p.pct, 2)})`, cls: (p) => tone(p.gain) },
      ], d.positions),
      h("p", { class: "note", style: "margin:12px 18px" },
        `Realized this year: ${fmt.usd(d.realized_ytd.short)} short term, ${fmt.usd(d.realized_ytd.long)} long term, ${fmt.usd(d.realized_ytd.disallowed)} disallowed by wash sales.`),
      d.missing_prices?.length ? h("p", { class: "note warn", style: "margin:0 18px 12px" }, `No price for ${d.missing_prices.join(", ")}. Refresh prices on the Overview page.`) : null)));
  } else {
    report.replaceChildren(emptyState("No holdings", "Add your lots on the Holdings page and the gains show up here."));
  }

  const minLoss = input({ type: "number", value: "100", min: "0" });
  const minPct = input({ type: "number", value: "5", min: "0", max: "100" });
  const writeH = check("Write harvest sells to orders.json");
  const hOut = h("div", {});
  const harvest = actionBtn("Find losses to harvest", async () => {
    const r = await run("tax_harvest", { min_loss: +minLoss.value, min_pct: +minPct.value, write: writeH.box.checked });
    hOut.replaceChildren(result(r, (d) => table([
      { key: "ticker", label: "Ticker", cls: () => "mono" },
      { label: "Sell", num: true, render: (c) => `${fmt.num(c.shares)} sh` },
      { label: "Loss", num: true, render: (c) => `${fmt.usd(c.loss)} (${fmt.pct(c.pct)})`, cls: () => "neg" },
      { label: "Term", render: (c) => (c.short && c.long ? "mixed" : c.long ? "long" : "short") },
      { label: "Wash sale", render: (c) => (c.wash?.length ? badge(`risk, ${fmt.usd(c.disallowed)} disallowed`, "bad") : badge("clear", "ok")) },
      { label: "Rebuy from", key: "rebuy_on_or_after", cls: () => "mono" },
    ], d.candidates, "No position is down past your thresholds.")));
  }, { kind: "primary" });

  const st = input({ class: "mono", placeholder: "KO" });
  const ss = input({ type: "number", step: "any", min: "0" });
  const sp = input({ type: "number", step: "0.01", min: "0", placeholder: "Latest price" });
  const method = select([["fifo", "First in, first out"], ["hifo", "Highest cost first"]], "fifo");
  const record = check("This sale already filled: update my lots");
  const sOut = h("div", {});
  const sell = actionBtn("Preview sale", async () => {
    const r = await run("tax_sell", { ticker: st.value, shares: +ss.value, method: method.value, record: record.box.checked, ...(sp.value ? { price: +sp.value } : {}) });
    sOut.replaceChildren(result(r, (d) => h("pre", { class: "out" }, JSON.stringify(d, null, 2))));
    if (record.box.checked && r.ok) await ctx.refreshQuiet();
  });

  const wt = input({ class: "mono", placeholder: "GOOGL" });
  const wOut = h("div", {});
  const wash = actionBtn("Check wash sale", async () => {
    const r = await run("tax_wash", { ticker: wt.value });
    wOut.replaceChildren(result(r, (d) => h("pre", { class: "out" }, JSON.stringify(d, null, 2))));
  });

  root.replaceChildren(
    head("Tax", "Cost basis, unrealized gains, loss harvesting and wash-sale checks. Arithmetic on your lots, not tax advice."),
    h("div", { class: "grid" },
      panel("Unrealized gains", { i: 0, flush: true, body: report }),
      h("div", { class: "grid even" },
        panel("Tax-loss harvesting", { i: 1, body: h("div", { class: "form" }, h("div", { class: "row" }, field("Min loss $", minLoss), field("Min loss %", minPct)), h("div", { class: "actions" }, writeH, harvest), hOut) }),
        panel("What would a sale cost?", { i: 2, body: h("div", { class: "form" }, h("div", { class: "row" }, field("Ticker", st), field("Shares", ss), field("Price", sp, "Empty: last refreshed price")), field("Lots to sell first", method), h("div", { class: "actions" }, record, sell), sOut) })),
      panel("Wash-sale check", { i: 3, body: h("div", { class: "form" }, h("div", { class: "row" }, field("Ticker", wt), h("div", {}, wash)), wOut) })));
}

export function settings(root, ctx) {
  const c = ctx.state.config ?? {};
  const num = (v, attrs = {}) => input({ type: "number", step: "any", value: v ?? "", ...attrs });
  const f = {
    budget: num(c.budget, { min: "1" }), cash_buffer_pct: num(c.cash_buffer_pct, { min: "0", max: "100" }),
    max_position_pct: num(c.max_position_pct, { min: "1", max: "100" }), max_order_usd: num(c.max_order_usd, { min: "1" }),
    min_order_usd: num(c.min_order_usd, { min: "0" }), max_orders_per_day: num(c.max_orders_per_day, { min: "1", step: "1" }),
  };
  const broker = select([["alpaca", "Alpaca"], ["ibkr", "Interactive Brokers"]], c.broker ?? "alpaca");
  const blocked = input({ class: "mono", value: (c.blocked ?? []).join(", "), placeholder: "TSLA, GME" });
  const ua = input({ value: c.sec_user_agent ?? "" });
  const flags = Object.fromEntries([
    ["fractional", "Fractional shares"], ["paper", "Paper account"], ["allow_options", "Allow options"],
    ["allow_margin", "Allow margin"], ["allow_short", "Allow short selling"],
  ].map(([k, label]) => [k, check(label, c[k] ?? (k === "fractional" || k === "paper"))]));
  const errBox = h("div", {});

  const save = actionBtn("Save settings", async () => {
    errBox.replaceChildren();
    const loosened = [
      c.paper !== false && !flags.paper.box.checked ? "turn paper trading off" : null,
      ...["allow_options", "allow_margin", "allow_short"].filter((k) => !c[k] && flags[k].box.checked).map((k) => `enable ${k.replace("allow_", "")}`),
      (c.blocked ?? []).length && !blocked.value.trim() ? "clear every blocked ticker" : null,
    ].filter(Boolean);
    // eslint-disable-next-line no-alert -- a deliberate speed bump before weakening guardrails
    if (loosened.length && !window.confirm(`This will ${loosened.join(", ")}. The risk check stops guarding against it. Continue?`)) return;
    const doc = {
      ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, +el.value])),
      broker: broker.value,
      blocked: blocked.value.toUpperCase().split(/[\s,]+/).filter(Boolean),
      sec_user_agent: ua.value.trim(),
      ...Object.fromEntries(Object.entries(flags).map(([k, el]) => [k, el.box.checked])),
    };
    try {
      await api("PUT", "/api/files/config", doc);
    } catch (e) {
      errBox.replaceChildren(errorBox(e.message));
      return;
    }
    toast("Settings saved");
    await ctx.refresh();
  }, { kind: "primary" });

  root.replaceChildren(
    head("Settings", "The limits every skill reads from trader/config.json."),
    h("div", { class: "grid two" },
      panel("Money and limits", {
        i: 0,
        body: h("div", { class: "form" },
          h("div", { class: "row" }, field("Budget $", f.budget), field("Cash buffer %", f.cash_buffer_pct), field("Max per stock %", f.max_position_pct)),
          h("div", { class: "row" }, field("Max order $", f.max_order_usd), field("Min order $", f.min_order_usd), field("Max orders a day", f.max_orders_per_day)),
          field("Blocked tickers", blocked, "The risk check blocks any order in these"),
          field("SEC user agent", ua, "Your name and email. SEC requires it for EDGAR requests."),
          errBox, h("div", { class: "actions" }, save)),
      }),
      panel("Account", {
        i: 1,
        body: h("div", { class: "form" }, field("Broker", broker), ...Object.values(flags),
          c.paper === false ? h("p", { class: "note warn" }, "Paper is off. The skills label tickets as LIVE. The dashboard still never places orders.") : null),
      })));
}
