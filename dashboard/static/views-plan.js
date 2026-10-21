// Overview, Copycat and Orders: from a fund's 13F to sized, risk-checked tickets.
import {
  actionBtn, api, badge, check, emptyState, field, fmt, h, input, load, panel, result,
  run, table, tickerList, toast, tone,
} from "./ui.js";

const weightsOf = (state) => state.targets?.weights ?? [];

function verdictFor(state, index) {
  const r = state.risk_state;
  return r?.results?.find((x) => x.index === index) ?? null;
}

function ordersTable(state) {
  const orders = state.orders?.orders ?? [];
  return table([
    { label: "#", render: (o) => String(orders.indexOf(o) + 1), num: true },
    { label: "Side", render: (o) => badge(o.side, o.side === "buy" ? "ok" : "warn") },
    { key: "symbol", label: "Ticker", cls: () => "mono" },
    { label: "Amount", num: true, render: (o) => (o.notional ? fmt.usd(+o.notional) : `${o.qty} sh`) },
    { label: "Type", render: (o) => `${o.type}, ${o.time_in_force}` },
    {
      label: "Risk",
      render: (o) => {
        const v = verdictFor(state, orders.indexOf(o) + 1);
        if (!v) return badge("not checked");
        return h("span", {}, badge(v.verdict, v.verdict === "PASS" ? "ok" : "bad"),
          v.reasons?.length ? h("div", { class: "small dim" }, v.reasons.join("; ")) : null);
      },
    },
  ], orders, "Run Size to budget to turn your targets into proposed orders.");
}

export function overview(root, ctx) {
  const { state } = ctx;
  const cfg = state.config ?? {};
  const prices = state.prices?.prices ?? {};
  const detail = state.prices?.detail ?? {};
  const investable = (cfg.budget ?? 0) * (1 - (cfg.cash_buffer_pct ?? 0) / 100);

  const stats = h("div", { class: "stats" },
    [["Budget", fmt.usd(cfg.budget)], ["To invest", fmt.usd(investable)],
      ["Cash buffer", fmt.pct(cfg.cash_buffer_pct, 0)], ["Max per stock", fmt.pct(cfg.max_position_pct, 0)],
      ["Account", cfg.paper === false ? "LIVE" : "Paper"], ["Orders proposed", String(state.orders?.orders?.length ?? 0)]]
      .map(([k, v]) => h("div", {}, h("div", { class: "stat-label" }, k), h("div", { class: "stat-value" }, v))));

  const targets = table([
    { key: "ticker", label: "Ticker", cls: () => "mono" },
    { key: "name", label: "Name" },
    { label: "Weight", num: true, render: (w) => fmt.pct(w.weight) },
    { label: "Before cap", num: true, render: (w) => fmt.usd((investable * w.weight) / 100) },
    { label: "Price", num: true, render: (w) => fmt.usd(prices[w.ticker]) },
    {
      label: "Day",
      num: true,
      render: (w) => {
        const p = prices[w.ticker], prev = detail[w.ticker]?.prev_close;
        return p && prev ? fmt.signedPct(((p - prev) / prev) * 100, 2) : "–";
      },
      cls: (w) => {
        const p = prices[w.ticker], prev = detail[w.ticker]?.prev_close;
        return p && prev ? tone(p - prev) : "";
      },
    },
  ], weightsOf(state), "No targets yet. Copy an investor on the Copycat page or type your own weights there.");

  const step = (label, action, params) => actionBtn(label, async () => {
    const r = await run(action, params());
    if (r.error) throw new Error(r.error);
    toast(`${label}: done`);
    await ctx.refresh();
  });
  const tickers = () => ({ tickers: weightsOf(ctx.state).map((w) => w.ticker) });
  const pipeline = h("div", { class: "actions" },
    step("1  Refresh prices", "quote", tickers),
    step("2  Size to budget", "budget", () => ({})),
    step("3  Risk check", "risk", () => ({})),
    actionBtn("Run all three", async () => {
      for (const [a, p] of [["quote", tickers()], ["budget", {}], ["risk", {}]]) {
        const r = await run(a, p);
        if (r.error && a !== "risk") throw new Error(`${a}: ${r.error}`);
      }
      toast("Prices, sizing and risk check finished");
      await ctx.refresh();
    }, { kind: "primary" }));

  root.replaceChildren(
    head("Overview", "Your targets, today's prices and the orders they turn into. Proposals only: nothing here reaches a broker."),
    h("div", { class: "grid" },
      panel("Account rules", { sub: `From trader/config.json. Prices as of ${fmt.time(state.prices?.as_of)}.`, body: stats, flush: true, i: 0 }),
      h("div", { class: "grid two" },
        panel("Targets", { sub: state.targets?.source ?? "Not set", body: targets, flush: true, i: 1 }),
        panel("Pipeline", {
          sub: "Run in order. Each step writes the file the next one reads.",
          i: 2,
          body: h("div", { class: "form" }, pipeline,
            h("p", { class: "note" }, "After the risk check, tickets wait on the Orders page. Placing an order is up to you, in your broker's own app.")),
        })),
      panel("Proposed orders", { sub: state.orders?.created_by ? `Written by ${state.orders.created_by}` : "", body: ordersTable(state), flush: true, i: 3 })));
}

export function copycat(root, ctx) {
  const q = input({ placeholder: "Buffett, Ackman, Scion, Pershing…", value: "" });
  const found = h("div", {}, emptyState("Search a fund or investor", "Names come from SEC EDGAR and the skill's bundled list."));
  const cikIn = input({ class: "mono", value: ctx.state.targets?.cik?.replace(/^0+/, "") ?? "1067983" });
  const top = input({ type: "number", value: "5", min: "1", max: "100" });
  const minPct = input({ type: "number", placeholder: "0", min: "0", max: "100", step: "0.1" });
  const exclude = input({ class: "mono", placeholder: "BAC, KO" });
  const preview = check("Preview only (do not write targets)");
  const copyOut = h("div", {});
  const diffOut = h("div", {}, emptyState("No filing loaded", "Pick a filer, then Show changes."));
  const editorSlot = h("div", { style: "margin-top:16px" }, targetsEditor(ctx));

  const showDiff = (cik) => load(diffOut, run("copycat_diff", { cik }), (r) => result(r, (d) => h("div", {},
    h("p", { class: "note", style: "margin:12px 18px" }, `${d.meta.filer}: ${d.meta.period} vs ${d.meta.prior_period}, filed ${d.meta.filed}`),
    table([
      { label: "Status", render: (c) => badge(c.status, c.status === "NEW" || c.status === "ADDED" ? "ok" : c.status === "SOLD OUT" ? "bad" : "warn") },
      { label: "Ticker", render: (c) => c.ticker || "–", cls: () => "mono" },
      { key: "issuer", label: "Issuer" },
      { label: "Shares before", num: true, render: (c) => fmt.num(c.shares_before, 0) },
      { label: "Shares after", num: true, render: (c) => fmt.num(c.shares_after, 0) },
      { label: "Change", num: true, render: (c) => (c.change_pct == null ? "–" : fmt.signedPct(c.change_pct)), cls: (c) => tone(c.change) },
    ], d.changes.filter((c) => c.status !== "SAME" && c.status !== "UNCHANGED"), "No changes since the prior quarter."))));

  const find = actionBtn("Find", async () => {
    const r = await run("copycat_find", { query: q.value });
    found.replaceChildren(result(r, (list) => (list.length ? h("div", { class: "list" }, list.map((f, i) => h("div", { class: "item", style: `--i:${i}` },
      h("div", { class: "item-title" }, f.name),
      h("div", { class: "item-meta" }, badge(`CIK ${f.cik}`), f.person ? h("span", {}, f.person) : null, f.last_13f ? h("span", {}, `last 13F ${f.last_13f}`) : null),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn ghost", onclick: () => { cikIn.value = f.cik.replace(/^0+/, ""); toast(`Using ${f.name}`); } }, "Use this filer"),
        h("button", { type: "button", class: "btn ghost", onclick: () => showDiff(f.cik.replace(/^0+/, "")) }, "Show changes")))))
      : emptyState("No match", "Try the fund's name as SEC lists it, or its CIK."))));
  }, { kind: "primary" });

  const copy = actionBtn("Copy portfolio", async () => {
    const r = await run("copycat_copy", {
      cik: cikIn.value, top: +top.value || 5, dry_run: preview.box.checked,
      ...(minPct.value ? { min_pct: +minPct.value } : {}), exclude: tickerList(exclude.value),
    });
    copyOut.replaceChildren(result(r, (d) => h("div", {},
      h("p", { class: "note" }, d.source),
      table([
        { key: "ticker", label: "Ticker", cls: () => "mono" }, { key: "name", label: "Name" },
        { label: "Your weight", num: true, render: (w) => fmt.pct(w.weight) },
        { label: "% of 13F", num: true, render: (w) => fmt.pct(w.pct_of_13f) },
        { label: "Fund holds", num: true, render: (w) => fmt.big(w.value) },
      ], d.weights),
      d.caveats?.length ? h("p", { class: "note warn" }, d.caveats.join(" ")) : null)));
    if (!preview.box.checked && r.ok) {
      toast("Targets written. Next: Size to budget.");
      await ctx.refreshQuiet();
      editorSlot.replaceChildren(targetsEditor(ctx));
    }
  }, { kind: "primary" });

  root.replaceChildren(
    head("Copycat", "Rebuild a fund's portfolio from its latest SEC 13F filing and turn it into your target weights."),
    h("div", { class: "grid even" },
      panel("Find a filer", { i: 0, body: h("div", { class: "form" }, h("div", { class: "row" }, field("Fund or person", q), h("div", {}, find))), }),
      panel("Copy top holdings", {
        i: 1,
        body: h("div", { class: "form" },
          h("div", { class: "row" }, field("CIK", cikIn, "Berkshire is 1067983"), field("Top positions", top), field("Min % of fund", minPct)),
          field("Exclude tickers", exclude, "Comma or space separated"),
          h("div", { class: "actions" }, preview, copy), copyOut),
      })),
    h("div", { class: "grid even", style: "margin-top:16px" },
      panel("Search results", { body: found, flush: true, i: 2 }),
      panel("Changes since last quarter", {
        i: 3, flush: true, body: diffOut,
        actions: h("button", { type: "button", class: "btn ghost", onclick: () => showDiff(cikIn.value) }, "Load for CIK above"),
      })),
    editorSlot);
}

function targetsEditor(ctx) {
  let rows = weightsOf(ctx.state).map((w) => ({ ...w }));
  const body = h("div", {});
  const total = h("span", { class: "badge" });

  const draw0 = () => {
    const sum = rows.reduce((s, r) => s + (+r.weight || 0), 0);
    total.textContent = `Total ${sum.toFixed(2)}%`;
    total.className = `badge ${Math.abs(sum - 100) < 0.05 ? "ok" : "warn"}`;
  };
  const draw = () => {
    draw0();
    body.replaceChildren(rows.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Ticker", "Name", "Weight %", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.map((r, i) => h("tr", {},
        h("td", {}, input({ class: "mono", value: r.ticker, "aria-label": "Ticker", oninput: (e) => { rows = rows.map((x, j) => (j === i ? { ...x, ticker: e.target.value.toUpperCase() } : x)); } })),
        h("td", {}, input({ value: r.name ?? "", "aria-label": "Name", oninput: (e) => { rows = rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)); } })),
        h("td", {}, input({ type: "number", step: "0.01", min: "0", value: r.weight, "aria-label": "Weight", oninput: (e) => { rows = rows.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)); draw0(); } })),
        h("td", {}, h("button", { type: "button", class: "btn ghost danger", onclick: () => { rows = rows.filter((_, j) => j !== i); draw(); } }, "Remove")))))))
      : emptyState("No targets", "Add a row, or copy a fund above."));
  };
  draw();

  const save = actionBtn("Save targets", async () => {
    const doc = {
      ...(ctx.state.targets ?? {}),
      method: "edited in the dashboard",
      weights: rows.filter((r) => r.ticker).map((r) => ({ ...r, ticker: r.ticker.trim(), weight: +r.weight })),
    };
    await api("PUT", "/api/files/targets", doc);
    toast("Targets saved");
    await ctx.refresh();
  }, { kind: "primary" });

  return panel("Target weights", {
    sub: "Edit by hand. The budget step scales these to 100% of the money you invest.",
    flush: true, i: 4, body,
    actions: [total, h("button", { type: "button", class: "btn", onclick: () => { rows = [...rows, { ticker: "", name: "", weight: 0 }]; draw(); } }, "Add row"), save],
  });
}

export function orders(root, ctx) {
  const cfg = ctx.state.config ?? {};
  const budget = input({ type: "number", value: cfg.budget ?? "", min: "1" });
  const whole = check("Whole shares only");
  const sizeOut = h("div", {});
  const riskOut = h("div", {});
  const ticketsOut = h("div", {});

  const sizing = (d) => {
    const r = d.result;
    return h("div", {},
      h("p", { class: "note", style: "margin:12px 18px" },
        `Budget ${fmt.usd(r.budget)}, cash buffer ${fmt.usd(r.cash_buffer)}, investing ${fmt.usd(r.investable)}, cap ${fmt.usd(r.cap)} per stock.`),
      table([
        { key: "ticker", label: "Ticker", cls: () => "mono" }, { key: "name", label: "Name" },
        { label: "Weight", num: true, render: (p) => fmt.pct(p.weight) },
        { label: "Dollars", num: true, render: (p) => fmt.usd(p.dollars) },
        { label: "Price", num: true, render: (p) => fmt.usd(p.price) },
        { label: "Shares", num: true, render: (p) => fmt.num(p.shares) },
        { label: "Note", render: (p) => (p.capped ? badge("capped", "warn") : "") },
      ], r.positions));
  };

  const risk = (d) => table([
    { key: "index", label: "#", num: true },
    { label: "Order", render: (o) => `${o.side} ${o.symbol} ${o.amount}` },
    { label: "Verdict", render: (o) => badge(o.verdict, o.verdict === "PASS" ? "ok" : "bad") },
    { label: "Reasons", render: (o) => [...(o.reasons ?? []), ...(o.warnings ?? [])].join("; ") || "–", cls: () => "small" },
  ], d.results, "No orders to check.");

  const tickets = (list) => (list.length ? h("div", {}, list.map((t) => h("article", { class: "ticket" },
    h("header", {}, h("strong", {}, `#${t.index}  ${t.plain}`),
      h("span", { class: "actions" }, badge(t.paper ? "paper" : "LIVE", t.paper ? "" : "bad"), badge(t.ready ? "ready" : "not ready", t.ready ? "ok" : "warn"))),
    h("div", { class: "why" }, t.status, t.why ? h("div", {}, t.why) : null),
    h("pre", {}, JSON.stringify(t.tool_input, null, 2))))) : emptyState("No tickets", "Size to budget, then run the risk check."));

  const loadTickets = () => load(ticketsOut, run("tickets"), (r) => result(r, tickets));
  loadTickets();

  root.replaceChildren(
    head("Orders", "Size your targets to the budget, check every order against your limits, and review the resulting tickets."),
    h("p", { class: "note warn", style: "margin-bottom:16px" },
      "This dashboard cannot approve or place orders. To act on a ticket, enter it yourself in your broker's app."),
    h("div", { class: "grid even" },
      panel("Size to budget", {
        i: 0,
        body: h("div", { class: "form" },
          h("div", { class: "row" }, field("Budget for this run", budget, "Leave as is to use Settings"), h("div", {}, whole)),
          h("div", { class: "actions" }, actionBtn("Size and write orders", async () => {
            const r = await run("budget", { ...(budget.value ? { budget: +budget.value } : {}), whole_shares: whole.box.checked });
            sizeOut.replaceChildren(result(r, sizing));
            if (r.ok) { toast("Orders written. Run the risk check next."); await ctx.refreshQuiet(); loadTickets(); }
          }, { kind: "primary" })), sizeOut),
      }),
      panel("Risk check", {
        i: 1,
        sub: "Blocked tickers, order size, position cap, cash buffer, margin, shorts, daily limit.",
        body: h("div", { class: "form" },
          h("div", { class: "actions" }, actionBtn("Check every order", async () => {
            const r = await run("risk");
            riskOut.replaceChildren(result(r, risk));
            await ctx.refreshQuiet();
            loadTickets();
          }, { kind: "primary" })), riskOut),
      })),
    h("div", { style: "margin-top:16px" },
      panel("Order tickets", { sub: "Exactly what a broker would receive. Read only.", i: 2, body: ticketsOut, actions: h("button", { type: "button", class: "btn ghost", onclick: loadTickets }, "Reload") })));
}

export function head(title, sub, actions) {
  return h("header", { class: "view-head" }, h("div", {}, h("h1", {}, title), h("p", {}, sub)), actions ?? null);
}
