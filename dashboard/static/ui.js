// DOM and API helpers. Everything external is inserted as text, never as HTML.

export async function api(method, path, body) {
  const opts = { method, headers: { "X-Trader-Dashboard": "1" } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("Cannot reach the dashboard server. Is server.py still running?");
  }
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Server returned ${res.status} without JSON`);
  }
  if (!payload.success) throw new Error(payload.error || `Request failed (${res.status})`);
  return payload.data;
}

// Runs a skill action. Resolves to {ok, data, text, error, warnings}; throws
// only when the script produced nothing usable.
export async function run(action, params = {}) {
  const r = await api("POST", `/api/run/${action}`, params);
  if (!r.ok && r.data == null && !r.text) throw new Error(r.error || `${action} failed`);
  return r;
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const fmt = {
  usd(n, dp) {
    if (n == null || Number.isNaN(+n)) return "–";
    const d = dp ?? (Math.abs(n) >= 1000 ? 0 : 2);
    return (n < 0 ? "-$" : "$") + Math.abs(+n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  big(n) {
    if (n == null) return "–";
    const a = Math.abs(n);
    if (a >= 1e12) return fmt.usd(n / 1e12, 2) + "T";
    if (a >= 1e9) return fmt.usd(n / 1e9, 2) + "B";
    if (a >= 1e6) return fmt.usd(n / 1e6, 1) + "M";
    return fmt.usd(n);
  },
  pct(n, dp = 2) {
    return n == null || Number.isNaN(+n) ? "–" : `${(+n).toFixed(dp)}%`;
  },
  signedPct(n, dp = 1) {
    return n == null ? "–" : `${n > 0 ? "+" : ""}${(+n).toFixed(dp)}%`;
  },
  num(n, dp = 4) {
    return n == null ? "–" : (+n).toLocaleString("en-US", { maximumFractionDigits: dp });
  },
  time(s) {
    if (!s) return "–";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  },
};

export const tone = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

export function safeLink(url, text) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") {
      return h("a", { href: u.href, target: "_blank", rel: "noopener noreferrer" }, text);
    }
  } catch { /* not a URL */ }
  return h("span", {}, text);
}

// columns: [{key, label, num, render(row) -> Node|string, cls(row)}]
export function table(columns, rows, empty = "Nothing here yet.") {
  if (!rows || !rows.length) return emptyState("No rows", empty);
  return h("div", { class: "table-wrap" },
    h("table", {},
      h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.num ? "num" : "" }, c.label)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, columns.map((c) => {
        const v = c.render ? c.render(r) : r[c.key];
        const cls = [c.num ? "num" : "", c.cls ? c.cls(r) : ""].join(" ").trim();
        return h("td", { class: cls }, v ?? "–");
      }))))));
}

export function panel(title, { sub, actions, body, flush, i = 0 } = {}) {
  return h("section", { class: "panel", style: `--i:${i}` },
    h("div", { class: "panel-head" },
      h("div", {}, h("h2", {}, title), sub ? h("div", { class: "sub" }, sub) : null),
      actions ? h("div", { class: "actions" }, actions) : null),
    h("div", { class: flush ? "panel-body flush" : "panel-body" }, body));
}

export function emptyState(title, hint) {
  return h("div", { class: "empty" }, h("strong", {}, title), hint ? h("span", {}, hint) : null);
}

export function skeleton(lines = 5) {
  return h("div", { class: "skel", "aria-busy": "true", "aria-label": "Loading" }, Array.from({ length: lines }, () => h("i")));
}

export function errorBox(msg) {
  return h("div", { class: "error-box", role: "alert" }, msg);
}

export function badge(text, kind = "") {
  return h("span", { class: `badge ${kind}` }, text);
}

export function toast(msg, kind = "") {
  const t = h("div", { class: `toast ${kind}` }, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), kind === "bad" ? 7000 : 3500);
}

// A button that shows a spinner while its async handler runs.
export function actionBtn(label, fn, { kind = "", title } = {}) {
  const b = h("button", { type: "button", class: `btn ${kind}`, title }, label);
  b.addEventListener("click", async () => {
    if (b.disabled) return;
    b.disabled = true;
    b.replaceChildren(h("span", { class: "spin" }), label);
    try {
      await fn();
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      b.disabled = false;
      b.replaceChildren(label);
    }
  });
  return b;
}

export function field(label, input, help) {
  return h("label", { class: "field" }, h("span", {}, label), input, help ? h("small", {}, help) : null);
}

export function input(attrs = {}) {
  return h("input", { type: "text", autocomplete: "off", spellcheck: "false", ...attrs });
}

export function select(options, value) {
  return h("select", {}, options.map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
}

export function check(label, checked = false) {
  const box = h("input", { type: "checkbox", checked });
  const el = h("label", { class: "check" }, box, label);
  el.box = box;
  return el;
}

export function tickerList(s) {
  return String(s || "").toUpperCase().split(/[\s,]+/).filter(Boolean);
}

// Swap a region's content: shows a skeleton while the promise runs, then the
// rendered result or an inline error.
export async function load(region, promise, render) {
  region.replaceChildren(skeleton());
  try {
    const value = await promise;
    region.replaceChildren(render(value));
  } catch (e) {
    region.replaceChildren(errorBox(e.message));
  }
}

// Renders a run() result: the structured view, plus stderr notes and errors.
export function result(r, render) {
  const parts = [];
  if (r.error) parts.push(errorBox(r.error));
  if (r.data != null) parts.push(render(r.data));
  else if (r.text) parts.push(h("pre", { class: "out" }, r.text));
  if (r.warnings) parts.push(h("pre", { class: "out small" }, r.warnings));
  return h("div", {}, parts.length ? parts : emptyState("No output", "The tool finished without printing anything."));
}
