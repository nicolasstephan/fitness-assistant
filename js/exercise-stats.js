// Exercise > Volume: how much you exercised recently and whether it is going up or down.
// Tiles compare the last 4 weeks with the 4 before (per week: minutes, sessions, strength sessions, minutes at
// 60%+ of max HR, cardio load); a chart shows the minutes per week by category with a linear trend.
// Workouts come from the Health view (logged + tracker, joined; resting sessions are not exercise).
import { stackedColumns, linearTrend } from "./charts.js";
import { chartCard } from "./health.js";
import { infoButton } from "./info.js";

const DAY = 86400000;
const PERIOD = 28; // days per compared period
const WEEKS = 12; // weeks in the chart
const SAME = 0.1; // within ±10% counts as steady
const CATS = ["Strength", "Cardio", "Walking", "Sports & other"];

const dayT = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00Z`);
const monday = (t) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
const fmtWeek = (t) => `Week of ${new Date(t).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" })}`;
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
};

/** Minutes at 60%+ of max HR (zones 2-5) of a workout with heart-rate zones, else null. */
/** A day with tracker data (sleep, heart rate, steps) or a logged workout counts as tracked. */
const tracked = (d) => d.hrv != null || d.rhr != null || d.steps != null || d.sleep?.asleepMin != null;
const GAP = 14; // this many untracked days in a row: the time before is a different period (e.g. WHOOP before Polar)

/**
 * First day of the current tracked stretch: the day after the last run of 14+ days with neither tracker data nor a
 * workout. Weeks before it would count as "no exercise" when nothing was recorded.
 */
function trackedSince(days, workouts, end) {
  const on = new Set([...days.filter(tracked).map((d) => d.t), ...workouts.map((w) => w.t)]);
  let run = 0;
  let t = end;
  for (; t >= end - 3 * 365 * DAY; t -= DAY) {
    if (on.has(t)) run = 0;
    else if (++run >= GAP) return t + GAP * DAY;
  }
  return t;
}

const zone2Plus = (w) => (w.zones?.length ? ((w.zoneMin ?? w.durationMin ?? 0) * w.zones.slice(1).reduce((a, b) => a + b, 0)) / 100 : null);

export class ExerciseStats {
  /** root: container. getContext(): { days, workouts } from the Health view, or null. today(): "YYYY-MM-DD". */
  constructor(root, { getContext, today }) {
    Object.assign(this, { root, getContext, today });
    this.pendingDraws = [];
    this.width = 0;
    new ResizeObserver(() => {
      const w = this.root.clientWidth;
      if (w && Math.abs(w - this.width) > 1) {
        this.width = w;
        this.pendingDraws.forEach((d) => d());
      }
    }).observe(root);
  }

  render() {
    this.root.replaceChildren();
    this.pendingDraws = [];
    const ctx = this.getContext();
    if (!ctx) return;
    const end = dayT(this.today());
    const workouts = ctx.workouts.filter((w) => w.start && dayT(w.start) <= end).map((w) => ({ ...w, t: dayT(w.start) }));
    if (!workouts.length) return;
    const since = trackedSince(ctx.days, workouts, end);
    const first = Math.max(since, Math.min(...workouts.map((w) => w.t)));
    const curStart = end - (PERIOD - 1) * DAY, prevStart = curStart - PERIOD * DAY;
    const inP = (a, b) => (w) => w.t >= a && w.t < b;
    const cur = workouts.filter(inP(curStart, end + DAY)), prev = workouts.filter(inP(prevStart, curStart));
    const prevCovered = since <= prevStart + 3 * DAY; // the period before must have been tracked
    const perWeek = (ws, get) => (ws.reduce((a, w) => a + (get(w) ?? 0), 0) * 7) / PERIOD;
    const loadOf = (a, b) => {
      const ds = ctx.days.filter((d) => d.t >= a && d.t < b && d.cardioLoad != null && !d.partialDay);
      return ds.length >= PERIOD / 2 ? (ds.reduce((s, d) => s + d.cardioLoad, 0) * 7) / ds.length : null;
    };
    const withZones = (ws) => ws.filter((w) => zone2Plus(w) != null);

    const tiles = [
      { label: "Exercise / week", cur: perWeek(cur, (w) => w.durationMin), prev: perWeek(prev, (w) => w.durationMin), fmt: (v) => `${Math.round(v)} min` },
      { label: "Sessions / week", cur: perWeek(cur, () => 1), prev: perWeek(prev, () => 1), fmt: (v) => v.toFixed(1) },
      { label: "Strength / week", cur: perWeek(cur, (w) => (w.cat === "Strength" ? 1 : 0)), prev: perWeek(prev, (w) => (w.cat === "Strength" ? 1 : 0)), fmt: (v) => v.toFixed(1) },
      withZones(cur).length && { label: "60%+ max HR / week", cur: perWeek(cur, zone2Plus), prev: withZones(prev).length ? perWeek(prev, zone2Plus) : null, fmt: (v) => `${Math.round(v)} min` },
      loadOf(curStart, end + DAY) != null && { label: "Cardio load / week", cur: loadOf(curStart, end + DAY), prev: loadOf(prevStart, curStart), fmt: (v) => `${Math.round(v)}` },
    ].filter(Boolean);

    this.root.append(
      el("h3", { className: "vol-h", textContent: "Activity" }),
      el("p", { className: "hint", textContent: "Per week, last 4 weeks; the arrow compares with the 4 weeks before." }),
      el("div", { className: "tiles ex-tiles" }, ...tiles.map((t) => this.tile(t, prevCovered))),
    );

    // minutes per week by category, last 12 weeks (or since the first workout)
    const lastWeek = monday(end);
    const firstWeek = Math.max(monday(first), lastWeek - (WEEKS - 1) * 7 * DAY);
    const sinceNote = since > end - 365 * DAY ? ` since ${new Date(since).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" })} (tracked without a break)` : "";
    const rows = [];
    for (let t = firstWeek; t <= lastWeek; t += 7 * DAY) rows.push({ t, values: CATS.map(() => 0), n: 0 });
    for (const w of workouts.filter((x) => x.t >= since)) {
      const r = rows.find((x) => x.t === monday(w.t));
      if (!r) continue;
      r.values[Math.max(0, CATS.indexOf(w.cat))] += w.durationMin ?? 0;
      r.n++;
    }
    const series = CATS.map((name, i) => ({ name, color: css(`--series-${i + 1}`) }));
    // the running week is incomplete: left out of the trend
    const done = rows.filter((r) => r.t < lastWeek);
    const trend = linearTrend(done.map((r) => ({ t: r.t, v: r.values.reduce((a, b) => a + b, 0) })));
    const verdict = !trend ? null
      : Math.abs(trend.tStat) < 2 ? { text: "→ no clear trend", cls: "" }
        : trend.delta > 0 ? { text: "↑ going up", cls: "good" } : { text: "↓ going down", cls: "bad" };
    const card = chartCard(this, this.root, "Exercise minutes per week",
      `By category, ${rows.length} week${rows.length === 1 ? "" : "s"}${sinceNote}; the running week is not in the trend. WHO: 150+ min of moderate activity and 2 strength sessions a week`,
      (box) => stackedColumns(box, rows, series, {
        unit: "min", format: (v) => `${Math.round(v)}`, describe: fmtWeek, trend,
        // narrow panel: day numbers, with the month on the first week and the first week of each month
        labels: (t) => new Date(t).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric",
          ...(t === rows[0].t || new Date(t).getUTCDate() <= 7 ? { month: "short" } : {}) }),
      }),
      [
        { label: "Week of", get: (r) => new Date(r.t).toISOString().slice(0, 10) },
        ...CATS.map((c, k) => ({ label: `${c} (min)`, get: (r) => Math.round(r.values[k]), num: true })),
        { label: "Sessions", get: (r) => r.n, num: true },
      ],
      [...rows].reverse(),
      series,
      verdict);
    card.classList.add("ex-card");
    this.width = this.root.clientWidth;
    this.pendingDraws.forEach((d) => d());
  }

  tile(t, prevCovered) {
    const label = el("div", { className: "tile-label" }, t.label);
    const info = infoButton(t.label);
    if (info) label.append(info);
    let delta = "no earlier weeks to compare", cls = "";
    if (prevCovered && t.prev != null) {
      if (!t.prev) delta = t.cur ? "↑ none in the 4 weeks before" : "→ none before either";
      else {
        const r = t.cur / t.prev - 1;
        delta = `${Math.abs(r) < SAME ? "→" : r > 0 ? "↑" : "↓"} ${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(Math.round(r * 100))}% (${t.fmt(t.prev)})`;
        cls = Math.abs(r) < SAME ? "" : r > 0 ? "good" : "bad";
      }
    }
    return el("div", { className: "tile" }, label,
      el("div", { className: "tile-value", textContent: t.fmt(t.cur) }),
      el("div", { className: `tile-delta ${cls}`.trim(), textContent: delta }));
  }
}
