// Line icons (24px grid, drawn at 18px, stroke 1.75, currentColor).
const NS = "http://www.w3.org/2000/svg";

const P = (d) => ["path", { d }];
const ICONS = {
  team: [P("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"), ["circle", { cx: 9, cy: 7, r: 4 }],
    P("M22 21v-2a4 4 0 0 0-3-3.87"), P("M16 3.13a4 4 0 0 1 0 7.75")],
  overview: [["rect", { x: 3, y: 3, width: 7, height: 9, rx: 1 }], ["rect", { x: 14, y: 3, width: 7, height: 5, rx: 1 }],
    ["rect", { x: 14, y: 12, width: 7, height: 9, rx: 1 }], ["rect", { x: 3, y: 16, width: 7, height: 5, rx: 1 }]],
  copycat: [["rect", { x: 8, y: 8, width: 14, height: 14, rx: 2 }], P("M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2")],
  orders: [["rect", { x: 8, y: 2, width: 8, height: 4, rx: 1 }],
    P("M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"),
    P("M12 11h4"), P("M12 16h4"), P("M8 11h.01"), P("M8 16h.01")],
  news: [P("M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"),
    P("M18 14h-8"), P("M15 18h-5"), P("M10 6h8v4h-8Z")],
  congress: [P("M3 22h18"), P("M6 18v-7"), P("M10 18v-7"), P("M14 18v-7"), P("M18 18v-7"), P("M12 2l8 5H4Z")],
  research: [["circle", { cx: 11, cy: 11, r: 8 }], P("m21 21-4.3-4.3"), P("M8 14v-2"), P("M11 14V8"), P("M14 14v-4")],
  alerts: [P("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), P("M10.3 21a1.94 1.94 0 0 0 3.4 0")],
  holdings: [P("M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"),
    P("M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4")],
  tax: [P("M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"),
    P("M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"), P("M12 17.5v-11")],
  settings: [P("M4 21v-7"), P("M4 10V3"), P("M12 21v-9"), P("M12 8V3"), P("M20 21v-5"), P("M20 12V3"),
    P("M1 14h6"), P("M9 8h6"), P("M17 16h6")],
  sun: [["circle", { cx: 12, cy: 12, r: 4 }], P("M12 2v2"), P("M12 20v2"), P("m4.93 4.93 1.41 1.41"), P("m17.66 17.66 1.41 1.41"),
    P("M2 12h2"), P("M20 12h2"), P("m6.34 17.66-1.41 1.41"), P("m19.07 4.93-1.41 1.41")],
  moon: [P("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")],
  monitor: [["rect", { x: 2, y: 3, width: 20, height: 14, rx: 2 }], P("M8 21h8"), P("M12 17v4")],
  refresh: [P("M21 12a9 9 0 1 1-2.64-6.36L21 8"), P("M21 3v5h-5")],
  search: [["circle", { cx: 11, cy: 11, r: 7 }], P("m20 20-3.5-3.5")],
};

// Decorative by default: the adjacent text names the action.
export function icon(name, size = 18) {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
    "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true", focusable: "false", class: "icon",
  })) svg.setAttribute(k, String(v));
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
