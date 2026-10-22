// The team's characters: one friendly bean-shaped mascot, dressed for its role.
// Pure SVG, outlined "sticker" style so it reads on light and dark themes.

const NS = "http://www.w3.org/2000/svg";
const INK = "#2b2a2e";
const PAPER = "#f6f1e8";

export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

const line = { stroke: INK, "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" };
const ink = (extra = {}) => ({ ...line, fill: "none", ...extra });
const sticker = (extra = {}) => ({ ...line, fill: PAPER, ...extra });

// Accessories: drawn on top of the shared body. Right hand sits near (66, 60).
const GEAR = {
  glasses: () => s("g", {},
    s("circle", ink({ cx: 31, cy: 46, r: 6.5 })), s("circle", ink({ cx: 49, cy: 46, r: 6.5 })),
    s("path", ink({ d: "M37.5 46 h5" }))),
  magnifier: () => s("g", { class: "tool" },
    s("path", ink({ d: "M70 66 l7 9", "stroke-width": 3.4 })),
    s("circle", sticker({ cx: 66, cy: 60, r: 7, "fill-opacity": 0.85 }))),
  pressCap: () => s("g", {},
    s("path", sticker({ d: "M20 26 Q40 6 60 26 Z" })), s("path", ink({ d: "M58 26 h12" , "stroke-width": 3 }))),
  newspaper: () => s("g", { class: "tool" },
    s("rect", sticker({ x: 58, y: 54, width: 18, height: 22, rx: 2, transform: "rotate(8 67 65)" })),
    s("path", ink({ d: "M62 60 h10 M62 65 h10 M62 70 h7", "stroke-width": 1.5, transform: "rotate(8 67 65)" }))),
  fedora: () => s("g", {},
    s("ellipse", sticker({ cx: 40, cy: 24, rx: 26, ry: 5 })),
    s("path", sticker({ d: "M27 23 Q28 8 40 8 Q52 8 53 23 Z" })),
    s("path", { d: "M28 19 Q40 22 52 19", stroke: "#8a5566", "stroke-width": 3.4, fill: "none" })),
  chart: () => s("g", { class: "tool" },
    s("rect", sticker({ x: 57, y: 50, width: 20, height: 22, rx: 3 })),
    s("path", ink({ d: "M61 67 v-4 M66 67 v-9 M71 67 v-6", "stroke-width": 2.6 }))),
  funnel: () => s("g", { class: "tool" },
    s("path", sticker({ d: "M57 52 h20 l-7 10 v8 l-6 3 v-11 Z" }))),
  antenna: () => s("g", {},
    s("path", ink({ d: "M40 14 v-8" })), s("circle", { class: "beacon", cx: 40, cy: 5, r: 3.4, fill: "#e0a43a", stroke: INK, "stroke-width": 1.6 })),
  clipboard: () => s("g", { class: "tool" },
    s("rect", sticker({ x: 57, y: 50, width: 19, height: 25, rx: 3 })),
    s("rect", { x: 62, y: 47, width: 9, height: 5, rx: 1.5, fill: INK }),
    s("path", ink({ d: "M61 58 l2 2 l4 -4 M61 66 l2 2 l4 -4", "stroke-width": 1.6 }))),
  scale: () => s("g", { class: "tool sway" },
    s("path", ink({ d: "M67 50 v22 M57 54 h20" })),
    s("path", sticker({ d: "M54 54 l3 7 h-6 Z" })), s("path", sticker({ d: "M80 54 l3 7 h-6 Z", transform: "translate(-6 0)" }))),
  helmet: () => s("g", {},
    s("path", sticker({ d: "M16 34 Q18 12 40 12 Q62 12 64 34 Z" })), s("path", ink({ d: "M40 12 v22" }))),
  shield: () => s("g", { class: "tool" },
    s("path", sticker({ d: "M58 50 h18 v10 q0 10 -9 15 q-9 -5 -9 -15 Z" })),
    s("path", ink({ d: "M62 61 l3 3 l6 -6", "stroke-width": 2 }))),
  visor: () => s("g", {},
    s("path", { d: "M18 34 Q40 22 62 34 L60 38 Q40 28 20 38 Z", fill: "#3f8a5a", "fill-opacity": 0.85, stroke: INK, "stroke-width": 2 })),
  calculator: () => s("g", { class: "tool" },
    s("rect", sticker({ x: 57, y: 50, width: 18, height: 24, rx: 3 })),
    s("rect", { x: 60, y: 53, width: 12, height: 5, rx: 1, fill: "#9cc4a8", stroke: INK, "stroke-width": 1.2 }),
    s("path", ink({ d: "M61 63 h2 M66 63 h2 M71 63 h1 M61 68 h2 M66 68 h2 M71 68 h1", "stroke-width": 2 }))),
  headset: () => s("g", {},
    s("path", ink({ d: "M17 46 Q17 16 40 16 Q63 16 63 46", "stroke-width": 3 })),
    s("rect", sticker({ x: 11, y: 40, width: 8, height: 13, rx: 3 })), s("rect", sticker({ x: 61, y: 40, width: 8, height: 13, rx: 3 })),
    s("path", ink({ d: "M15 53 Q18 64 30 62" })), s("circle", { cx: 31, cy: 62, r: 2.6, fill: INK })),
  bell: () => s("g", { class: "tool ring" },
    s("path", sticker({ d: "M59 68 q0 -15 8 -15 q8 0 8 15 Z" })), s("circle", { cx: 67, cy: 71, r: 2.4, fill: INK })),
};

export const ROLES = {
  copycat: { color: "#c96f4a", gear: ["glasses", "magnifier"] },
  news: { color: "#5b7a99", gear: ["pressCap", "newspaper"] },
  pelosi: { color: "#a0606f", gear: ["fedora", "magnifier"] },
  analyst: { color: "#7d8a4e", gear: ["glasses", "chart"] },
  screener: { color: "#3f8a86", gear: ["antenna", "funnel"] },
  budget: { color: "#c08a3e", gear: ["clipboard"] },
  rebalance: { color: "#6b9a7c", gear: ["scale"] },
  risk: { color: "#5d6878", gear: ["helmet", "shield"] },
  tax: { color: "#8b6b4a", gear: ["visor", "calculator"] },
  broker: { color: "#1f8a64", gear: ["headset"] },
  alerts: { color: "#c4564f", gear: ["antenna", "bell"] },
};

export function character(role, size = 64) {
  const r = ROLES[role] ?? { color: "#8a8a90", gear: [] };
  return s("svg", { class: "char", viewBox: "0 0 84 88", width: size, height: size * (88 / 84), "aria-hidden": "true" },
    s("ellipse", { class: "shadow", cx: 40, cy: 84, rx: 20, ry: 3, fill: INK, "fill-opacity": 0.14 }),
    s("g", { class: "bod" },
      s("path", { class: "arm arm-l", d: "M15 54 Q5 60 9 69", ...ink({ "stroke-width": 4.2, stroke: INK }) }),
      s("path", { class: "arm arm-r", d: "M65 54 Q73 58 70 64", ...ink({ "stroke-width": 4.2, stroke: INK }) }),
      s("ellipse", { cx: 31, cy: 80, rx: 6, ry: 3.4, fill: INK }),
      s("ellipse", { cx: 49, cy: 80, rx: 6, ry: 3.4, fill: INK }),
      s("path", { d: "M40 16 C60 16 67 32 67 50 C67 70 58 80 40 80 C22 80 13 70 13 50 C13 32 20 16 40 16 Z", fill: r.color, ...line }),
      s("ellipse", { cx: 40, cy: 64, rx: 15, ry: 11, fill: "#ffffff", "fill-opacity": 0.2 }),
      s("g", { class: "eyes" },
        s("ellipse", { cx: 31, cy: 46, rx: 3, ry: 4, fill: INK }), s("ellipse", { cx: 49, cy: 46, rx: 3, ry: 4, fill: INK }),
        s("circle", { cx: 32, cy: 44.5, r: 1.1, fill: "#fff" }), s("circle", { cx: 50, cy: 44.5, r: 1.1, fill: "#fff" })),
      s("ellipse", { cx: 25, cy: 54, rx: 3.6, ry: 2.2, fill: "#ff9a8a", "fill-opacity": 0.45 }),
      s("ellipse", { cx: 55, cy: 54, rx: 3.6, ry: 2.2, fill: "#ff9a8a", "fill-opacity": 0.45 }),
      s("path", { class: "mouth", d: "M35 56 Q40 61 45 56", ...ink({ "stroke-width": 2 }) }),
      ...r.gear.map((g) => GEAR[g]())));
}
