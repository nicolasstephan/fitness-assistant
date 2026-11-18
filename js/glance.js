// Health > top: the five numbers that matter most, as a quick look at this week (not the selected range).
// Each tile: the value, how it stands against a target or your normal, and a 14-day mini graph.
//   1 Active minutes: minutes at 60%+ of max HR, last 7 days, vs. 150 (WHO: 150 min moderate a week)
//   2 Strength: sessions in the last 7 days, vs. 2 (WHO: 2+ days a week)
//   3 HRV: last night vs. your normal range (60 nights before, ±0.5 SD, as in the HRV card), resting HR below
//   4 Cardio load: last 7 days vs. your weekly average of the last 28 days (acute:chronic)
//   5 Steps: average of the last 7 full days vs. 7,000 a day
import { infoButton } from "./info.js";

const DAY = 86400000;
const SPAN = 14; // days in the mini graphs
const ACTIVE_GOAL = 150, STRENGTH_GOAL = 2, STEPS_FLOOR = 7000;
const HRV_SWC = 0.5;

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
};
const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
};
const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? sum(v) / v.length : null; };
/** Minutes at 60%+ of max HR (zones 2-5) of a workout with zones, else 0. */
const activeMin = (w) => (w.zones?.length ? ((w.zoneMin ?? w.durationMin ?? 0) * sum(w.zones.slice(1))) / 100 : 0);

/**
 * Mini graph, 100 × 32 units stretched to the tile width. values: one per day (null = no data).
 * kind "cols" (columns) or "line"; ref: a dashed target line; band: [lo, hi] shaded (normal range).
 */
function spark(values, { kind = "cols", ref = null, band = null } = {}) {
  const W = 100, H = 32, PAD = 2;
  const box = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "spark", "aria-hidden": "true" });
  const vs = values.filter((v) => v != null);
  if (!vs.length) return box;
  let lo = kind === "cols" ? 0 : Math.min(...vs, band?.[0] ?? Infinity);
  let hi = Math.max(...vs, ref ?? -Infinity, band?.[1] ?? -Infinity);
  if (kind === "line") { const m = (hi - lo) * 0.15 || 1; lo -= m; hi += m; }
  if (hi <= lo) hi = lo + 1;
  const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);
  const step = W / values.length;
  if (band) svg("rect", { x: 0, y: y(band[1]), width: W, height: Math.max(0, y(band[0]) - y(band[1])), class: "spark-band" }, box);
  if (kind === "cols") {
    values.forEach((v, i) => {
      if (!v) return;
      svg("rect", { x: i * step + step * 0.15, y: y(v), width: step * 0.7, height: Math.max(0.8, y(0) - y(v)), class: "spark-col" }, box);
    });
  } else {
    let d = "", pen = false;
    values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${(i + 0.5) * step},${y(v)}`;
      pen = true;
    });
    svg("path", { d, class: "spark-line" }, box);
  }
  if (ref != null) svg("line", { x1: 0, x2: W, y1: y(ref), y2: y(ref), class: "spark-ref" }, box);
  return box;
}

/**
 * root: the section. days: the Health view's calendar days (t, hrv, hrvBase, rhr, steps, cardioLoad, partialDay),
 * workouts: all workouts (logged + tracker, with cat and zones). today: "YYYY-MM-DD".
 */
export function renderGlance(root, { days, workouts, today }) {
  const end = Date.parse(`${today}T00:00Z`);
  const byT = new Map(days.map((d) => [d.t, d]));
  const span = (n, get) => Array.from({ length: n }, (_, i) => get(end - (n - 1 - i) * DAY, byT.get(end - (n - 1 - i) * DAY)));
  const dayOf = (w) => Date.parse(`${w.start.slice(0, 10)}T00:00Z`);
  const perDay = (get) => {
    const m = new Map();
    for (const w of workouts) if (w.start) m.set(dayOf(w), (m.get(dayOf(w)) ?? 0) + get(w));
    return m;
  };
  const tiles = [];

  // 1 active minutes
  const active = perDay(activeMin);
  const act = span(SPAN, (t) => Math.round(active.get(t) ?? 0));
  const act7 = sum(act.slice(-7));
  tiles.push({
    label: "Active min", value: `${act7}`, unit: "min",
    status: act7 >= ACTIVE_GOAL ? ["✓ 150 reached", "good"] : [`${ACTIVE_GOAL - act7} to go for 150`, ""],
    graph: spark(act),
  });

  // 2 strength sessions
  const strength = perDay((w) => (w.cat === "Strength" ? 1 : 0));
  const str = span(SPAN, (t) => strength.get(t) ?? 0);
  const str7 = sum(str.slice(-7));
  tiles.push({
    label: "Strength", value: `${str7}`, unit: "×",
    status: str7 >= STRENGTH_GOAL ? ["✓ 2 or more", "good"] : [`${STRENGTH_GOAL - str7} more for 2`, ""],
    graph: spark(str),
  });

  // 3 HRV last night, against the normal range
  const lastHrv = [...days].reverse().find((d) => d.t <= end && d.hrv != null);
  if (lastHrv) {
    const base = lastHrv.hrvBase;
    const range = base ? [Math.exp(base.mean - HRV_SWC * base.sd), Math.exp(base.mean + HRV_SWC * base.sd)] : null;
    const status = !range ? ["normal after 14 nights", ""]
      : lastHrv.hrv < range[0] ? [`below normal ${Math.round(range[0])}–${Math.round(range[1])}`, "bad"]
        : lastHrv.hrv > range[1] ? [`above normal ${Math.round(range[0])}–${Math.round(range[1])}`, "good"]
          : [`normal (${Math.round(range[0])}–${Math.round(range[1])})`, "good"];
    const night = lastHrv.t === end ? "last night" : `${new Date(lastHrv.t).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short" })} ${new Date(lastHrv.t).getUTCDate()}`;
    tiles.push({
      label: night === "last night" ? "HRV" : `HRV · ${night}`, value: `${Math.round(lastHrv.hrv)}`, unit: "ms", status,
      extra: lastHrv.rhr != null ? `rest HR ${Math.round(lastHrv.rhr)} bpm` : null,
      graph: spark(span(SPAN, (t, d) => d?.hrv ?? null), { kind: "line", band: range }),
    });
  }

  // 4 cardio load: this week vs. the weekly average of the last 28 days
  const loads = span(28, (t, d) => d?.cardioLoad ?? null);
  if (loads.some((v) => v != null)) {
    const week = sum(loads.slice(-7));
    const known = loads.filter((v) => v != null).length;
    const usual = known >= 21 ? (sum(loads) / known) * 7 : null;
    const r = usual ? week / usual : null;
    const status = r == null ? ["usual after 3 weeks", ""]
      : r > 1.3 ? [`+${Math.round((r - 1) * 100)}% vs usual: big jump`, "bad"]
        : r < 0.8 ? [`−${Math.round((1 - r) * 100)}% vs usual ${Math.round(usual)}`, ""]
          : [`steady (usual ${Math.round(usual)})`, "good"];
    tiles.push({ label: "Cardio load", value: `${Math.round(week)}`, unit: "", status, graph: spark(loads.slice(-SPAN)) });
  }

  // 5 steps: average of the full days
  const steps = span(SPAN, (t, d) => (d && !d.partialDay ? d.steps ?? null : null));
  const steps7 = mean(steps.slice(-8)); // today is never a full day: the last 7 full ones
  if (steps7 != null) {
    tiles.push({
      label: "Steps", value: Math.round(steps7).toLocaleString(), unit: "/d",
      status: steps7 >= STEPS_FLOOR ? ["✓ above 7,000", "good"] : ["below 7,000", "bad"],
      graph: spark(steps, { ref: STEPS_FLOOR }),
    });
  }

  root.hidden = !tiles.length;
  root.replaceChildren(el("p", { className: "glance-head", textContent: "Last 7 days · HRV: latest night · steps: daily average" }), ...tiles.map((t) => {
    const label = el("div", { className: "tile-label" }, t.label);
    const info = infoButton(`${t.label === "Active min" ? "Active minutes" : t.label.startsWith("HRV") ? "HRV" : t.label} (this week)`);
    if (info) label.append(info);
    return el("div", { className: "tile glance-tile" },
      label,
      el("div", { className: "tile-value" }, t.value, t.unit && el("small", { textContent: ` ${t.unit}` })),
      el("div", { className: `tile-delta ${t.status[1]}`.trim(), textContent: t.status[0] }),
      t.extra && el("div", { className: "tile-delta", textContent: t.extra }),
      t.graph);
  }));
}
