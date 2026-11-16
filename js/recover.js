// Recover page cards for the resting sessions (vagus nerve stimulation, meditation, cyclic sighing, resonance
// breathing): which kind helps most (tension before / after, heart rate, the night after), the drop per session over
// time and the average curve per kind from the Loop's minute heart rate (hr.js), and minutes per week. Above them a
// nudge to move: easy cardio is the best-proven way to lower anxiety (moveHint).
// The rows of the History list get their own small curve in activities.js (sessionSpark / sessionDetail below).
import { dotChart, offsetChart, stackedColumns, dataTable } from "./charts.js";
import { OUTCOMES, meanCell, MIN_N } from "./insights.js";
import { chartCard } from "./health.js";
import { localToday } from "./checkin.js";
import { BEFORE_MIN, AFTER_MIN } from "./hr.js";
import { SPORTS, sportById } from "./data/sports.js";

const DAY = 86400000;
const ROLLING = 5;
const HIGH = 4; // stress (check-in) or tension (sessions) from 4 of 5 counts as high
const MOVE_CATS = new Set(["Cardio", "Walking"]); // easy cardio: walks, runs, rides, swims ...
const MOVE_STEPS = 10000; // a day with this many steps counts as moved too // running average over the last 5 sessions of a kind
export const REST_SPORTS = SPORTS.filter((s) => s.rest);

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** Color of a kind of session: the same in every chart and in the History rows. */
export const restColor = (sport) => `--series-${REST_SPORTS.findIndex((s) => s.id === sport) + 1}`;
const toMs = (local) => Date.parse(`${local}:00Z`); // local wall-clock times as "UTC"
const dayMs = (local) => Date.parse(local.slice(0, 10));
const minutesOf = (a) => Math.round((toMs(a.end) - toMs(a.start)) / 60000);
const mean = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const signed = (v, digits = 1) => (v == null ? null : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`);
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const clock = (ms) => new Date(ms).toISOString().slice(11, 16);
const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs, parent) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

/** Absolute heart rate of a session result r (MinuteHr.session): [{ m (min from the start), v (bpm) }]. */
const bpmCurve = (r) => r.curve.map((p) => ({ m: p.m, v: p.v + r.before }));

/**
 * Small curve for a History row: 20 min before, the session shaded, 30 min after; dashed line = the level before.
 * Null without heart rate.
 */
export function sessionSpark(a, r) {
  if (!r) return null;
  const W = 84, H = 26, P = 2;
  const pts = bpmCurve(r);
  const m0 = -BEFORE_MIN, m1 = r.minutes + AFTER_MIN;
  const vs = pts.map((p) => p.v).concat(r.before);
  const lo = Math.min(...vs) - 1, hi = Math.max(...vs) + 1;
  const x = (m) => P + ((m - m0) / (m1 - m0)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const svg = svgEl("svg", { class: "session-spark", width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
  svgEl("rect", { x: x(0), y: 0, width: Math.max(1, x(r.minutes) - x(0)), height: H, class: "spark-band" }, svg);
  svgEl("line", { x1: P, x2: W - P, y1: y(r.before), y2: y(r.before), class: "spark-base" }, svg);
  let d = "", prev = null;
  for (const p of pts) {
    d += `${prev != null && p.m - prev <= 10 ? "L" : "M"}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`;
    prev = p.m;
  }
  svgEl("path", { d, class: "spark-line", style: `stroke: var(${restColor(a.sport)})` }, svg);
  return svg;
}

/** Large chart of one session (a tapped History row) into el: bpm by clock time, the level before as a dashed line. */
export function sessionDetail(el, a, r) {
  const start = toMs(a.start);
  offsetChart(el, [{ name: "Heart rate", color: css(restColor(a.sport)), points: bpmCurve(r) }], {
    band: [0, r.minutes], bandLabel: "session", unit: "bpm", height: 160,
    ref: { v: r.before, label: `${Math.round(r.before)}` },
    describe: (m) => `${clock(start + m * 60000)} · ${m < 0 ? `${-m} min before` : m <= r.minutes ? `${m} min in` : `${m - r.minutes} min after`}`,
  });
}

const shiftDay = (date, n) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);

/**
 * A line above the sessions when moving would help: stress or tension was high lately (check-in stress or a
 * session's tension before, today or yesterday) and there was no easy cardio for 2 days, or none for 3 days.
 * Hidden otherwise. Easy cardio: a walk or cardio workout, or a day with 10,000 steps.
 */
export function moveHint(el, { ctx, journal, log, today = localToday() }) {
  el.hidden = true;
  if (!ctx) return;
  const steps = new Map(ctx.days.map((d) => [d.date, d.partialDay ? null : d.steps]));
  const movedOn = (date) => ctx.workouts.some((w) => MOVE_CATS.has(w.cat) && w.start.slice(0, 10) === date) || (steps.get(date) ?? 0) >= MOVE_STEPS;
  const lastMoved = [0, 1, 2, 3].find((n) => movedOn(shiftDay(today, -n)));
  const recent = [today, shiftDay(today, -1)];
  const stress = Math.max(0, ...recent.map((d) => journal?.days?.[d]?.stress ?? 0));
  const tension = Math.max(0, ...(log?.activities ?? []).filter((a) => recent.includes(a.start.slice(0, 10))).map((a) => a.tensionBefore ?? 0));
  const high = Math.max(stress, tension) >= HIGH;
  let text = null;
  if (high && (lastMoved == null || lastMoved >= 2)) {
    text = `${stress >= HIGH ? `Stress ${stress} of 5 in the check-in` : `Tension ${tension} of 5 before a session`}, and no walk or easy cardio `
      + `for ${lastMoved == null ? "3 days or more" : "2 days"}. A 20–30 min easy walk or jog is the best-proven way to lower anxiety; `
      + "short, easy sessions did best in the studies.";
  } else if (lastMoved == null) {
    text = "No walk or easy cardio in the last 3 days. A 20–30 min easy walk or jog lowers stress and anxiety reliably; easy is enough.";
  }
  if (!text) return;
  el.textContent = text;
  el.hidden = false;
}

export class RecoverCharts {
  /**
   * root: the container for the cards. getLog(): the training log. hr: MinuteHr. onHrLoaded(): heart rate came in.
   * getContext(): { days, workouts } from the Health view (days with deviations from normal), or null.
   * getJournal(): the check-in journal. hint: the element for the nudge to move (moveHint).
   */
  constructor(root, { getLog, hr, onHrLoaded, getContext, getJournal, hint }) {
    Object.assign(this, { root, getLog, hr, onHrLoaded, getContext, getJournal, hint });
    this.pendingDraws = [];
  }

  render() {
    if (this.hint) moveHint(this.hint, { ctx: this.getContext?.(), journal: this.getJournal?.(), log: this.getLog() });
    const sessions = (this.getLog()?.activities ?? [])
      .filter((a) => a.end && sportById.get(a.sport)?.rest)
      .sort((a, b) => b.start.localeCompare(a.start));
    this.root.replaceChildren();
    this.pendingDraws = [];
    if (!sessions.length) return;
    this.hr.load(sessions, localToday()).then((changed) => {
      if (!changed) return;
      if (!this.root.closest("[hidden]")) this.render();
      this.onHrLoaded?.();
    });
    const rows = sessions.map((a) => ({ a, r: this.hr.session(a) }));
    const kinds = REST_SPORTS.map((sport) => ({ sport, color: css(restColor(sport.id)), rows: rows.filter((x) => x.a.sport === sport.id) }))
      .filter((k) => k.rows.length);
    const grid = document.createElement("div");
    grid.className = "cards";
    this.root.append(grid);
    this.compareCard(grid, rows, kinds);
    this.dropCard(grid, kinds);
    this.curveCard(grid, rows, kinds);
    this.weeksCard(grid, sessions, kinds);
    this.pendingDraws.forEach((draw) => draw());
  }

  /**
   * Which kind helps most: per kind the tension change (after minus before), the heart-rate drop, and the night after
   * the session day vs. your normal; "No session" = days without any resting session since the first one.
   */
  compareCard(grid, rows, kinds) {
    const health = new Map((this.getContext?.()?.days ?? []).map((d) => [d.date, d]));
    const nightAfter = (date) => health.get(shiftDay(date, 1));
    const sessionDays = new Set(rows.map((x) => x.a.start.slice(0, 10)));
    const first = [...sessionDays].sort()[0];
    const nights = (dates) => [...dates].map(nightAfter).filter(Boolean);
    const restDays = [];
    for (let d = first; d < localToday(); d = shiftDay(d, 1)) if (!sessionDays.has(d)) restDays.push(d);
    const table = [
      ...kinds.map((k) => {
        const rated = k.rows.filter((x) => x.a.tensionBefore && x.a.tensionAfter).map((x) => x.a.tensionAfter - x.a.tensionBefore);
        const hr = k.rows.filter((x) => x.r).map((x) => x.r.dDuring);
        return {
          name: k.sport.short ?? k.sport.name, evidence: k.sport.evidence ?? null, n: k.rows.length,
          rated, hr, nights: nights(new Set(k.rows.map((x) => x.a.start.slice(0, 10)))),
        };
      }),
      { name: "No session", evidence: null, n: null, rated: [], hr: [], nights: nights(restDays) },
    ];
    const tensionCell = (r) => {
      if (!r.rated.length) return null;
      const m = mean(r.rated);
      return { text: `${signed(m)} (${r.rated.length})`, cls: Math.abs(m) < 0.3 ? "" : m < 0 ? "good" : "bad" };
    };
    const hrCell = (r) => (r.hr.length ? `${signed(mean(r.hr))} bpm (${r.hr.length})` : null);
    const card = chartCard(this, grid, "Which session helps most",
      "Per kind: tension after minus before (1–5), heart rate during vs. the 20 min before, and the night after vs. your normal", null);
    card.classList.add("wide", "insight");
    const body = card.querySelector(".card-body");
    body.classList.add("is-table");
    dataTable(body, [
      { label: "Kind", get: (r) => r.name },
      { label: "Evidence", get: (r) => r.evidence },
      { label: "Sessions", get: (r) => r.n, num: true },
      { label: "Tension", get: tensionCell, num: true },
      { label: "HR during", get: hrCell, num: true },
      { label: "HRV night after", get: (r) => meanCell(r.nights, OUTCOMES.hrv), num: true },
      { label: "Resting HR", get: (r) => meanCell(r.nights, OUTCOMES.rhr), num: true },
      { label: "Sleep time", get: (r) => meanCell(r.nights, OUTCOMES.asleep), num: true },
    ], table);
    const note = document.createElement("p");
    note.className = "card-note";
    note.textContent = `Rate your tension before and after each session: it compares the kinds most fairly. In brackets: rated or measured sessions; `
      + `night values from ${MIN_N} nights. Evidence: how well studied for stress and anxiety ("i" at ▶ Start).`;
    card.appendChild(note);
  }

  /** Heart rate drop during each session vs. its 20 minutes before, as dots over time; running average per kind. */
  dropCard(grid, kinds) {
    const series = kinds.map((k) => {
      const measured = k.rows.filter((x) => x.r).reverse(); // oldest first
      const points = measured.map(({ a, r }) => ({
        t: dayMs(a.start), v: r.dDuring,
        title: `${fmtDay(dayMs(a.start))} ${a.start.slice(11)} · ${minutesOf(a)} min · ${Math.round(r.before)} → ${Math.round(r.during)} bpm`,
      }));
      // one line point per day (the day's last session), so two sessions on a day don't make the line jump
      const smooth = points.map((p, i) => ({ t: p.t, v: mean(points.slice(Math.max(0, i - ROLLING + 1), i + 1).map((q) => q.v)) }))
        .filter((p, i, all) => all[i + 1]?.t !== p.t);
      return { name: k.sport.short ?? k.sport.name, color: k.color, points, smooth: points.length >= 3 ? smooth : null };
    }).filter((s) => s.points.length);
    const summary = series.map((s) => `${s.name} ${signed(mean(s.points.map((p) => p.v)))} (${s.points.length}×)`).join(" · ");
    const flat = series.flatMap((s) => s.points.map((p) => ({ ...p, name: s.name }))).sort((a, b) => b.t - a.t);
    const card = chartCard(this, grid, "Heart rate drop per session",
      series.length ? `bpm during the session vs. the ${BEFORE_MIN} min before · average ${summary}` : "No heart rate for these sessions yet",
      series.length ? (el) => dotChart(el, series, {
        zero: true, unit: "bpm", smoothLabel: `average of the last ${ROLLING}`,
        format: (v) => signed(v, Math.abs(v) < 10 ? 1 : 0),
      }) : null,
      [
        { label: "Session", get: (x) => x.title },
        { label: "Activity", get: (x) => x.name },
        { label: "During", get: (x) => signed(x.v), num: true },
      ],
      flat,
      series.map((s) => ({ name: s.name, color: s.color, line: !!s.smooth })));
    card.classList.add("wide");
    this.emptyNote(card, series.length);
  }

  /** The average heart-rate change curve per kind (moved here from Health), with every session in the table. */
  curveCard(grid, rows, kinds) {
    const measured = rows.filter((x) => x.r);
    const summary = kinds.map((k) => {
      const m = k.rows.filter((x) => x.r);
      return m.length ? `${k.sport.short ?? k.sport.name} ${signed(mean(m.map((x) => x.r.dDuring)))} during, `
        + `${signed(mean(m.map((x) => x.r.dAfter))) ?? "–"} after (${m.length}×)` : null;
    }).filter(Boolean).join(" · ");
    // mean of the per-minute deltas in 5-minute bins (the Loop samples every 5 min at rest)
    const meanMin = Math.round(mean(measured.map((x) => x.r.minutes)) ?? 0);
    const series = kinds.map((k) => {
      const bins = new Map();
      for (const { r } of k.rows.filter((x) => x.r)) {
        for (const p of r.curve) {
          const b = Math.round(p.m / 5) * 5;
          if (!bins.has(b)) bins.set(b, []);
          bins.get(b).push(p.v);
        }
      }
      return { name: k.sport.name, color: k.color, points: [...bins].sort((a, b) => a[0] - b[0]).map(([m, vs]) => ({ m, v: mean(vs) })) };
    }).filter((s) => s.points.length);
    const nameOf = (id) => sportById.get(id).short ?? sportById.get(id).name;
    const card = chartCard(this, grid, "Sessions vs. heart rate",
      measured.length ? `Average change from the ${BEFORE_MIN} min before, bpm · ${summary}`
        : `Minute heart rate from the Loop, compared with the ${BEFORE_MIN} minutes before each session`,
      measured.length ? (el) => offsetChart(el, series, {
        band: [0, meanMin], bandLabel: `avg session ${meanMin} min`, unit: "bpm", zero: true,
        format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}`,
      }) : null,
      [
        { label: "Date", get: (x) => `${x.a.start.slice(0, 10)} ${x.a.start.slice(11)}` },
        { label: "Activity", get: (x) => nameOf(x.a.sport) },
        { label: "Min", get: (x) => minutesOf(x.a), num: true },
        { label: "Before", get: (x) => (x.r ? Math.round(x.r.before) : null), num: true },
        { label: "During", get: (x) => (x.r ? `${Math.round(x.r.during)} (${signed(x.r.dDuring)})` : null), num: true },
        { label: "After", get: (x) => (x.r?.after != null ? `${Math.round(x.r.after)} (${signed(x.r.dAfter)})` : null), num: true },
        { label: "Lowest", get: (x) => x.r?.min, num: true },
      ],
      rows,
      series.map((s) => ({ name: s.name, color: s.color, line: true })));
    card.classList.add("wide");
    this.emptyNote(card, measured.length);
    const note = document.createElement("p");
    note.className = "card-note";
    note.textContent = "Sitting still lowers heart rate by itself, so meditation without stimulation is the fair comparison. "
      + "At rest the Loop measures every 5 minutes; start a workout on the Loop during a session for second-by-second heart rate. "
      + "The night after is in Health > Journal vs. recovery (\"… the day before?\").";
    card.appendChild(note);
  }

  /** Minutes per week, stacked per kind, from the first session's week to this week. */
  weeksCard(grid, sessions, kinds) {
    const monday = (t) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
    const first = monday(Math.min(...sessions.map((a) => dayMs(a.start))));
    const last = monday(Date.parse(localToday()));
    const weeks = [];
    for (let t = first; t <= last; t += 7 * DAY) weeks.push({ t, values: kinds.map(() => 0), n: kinds.map(() => 0) });
    for (const a of sessions) {
      const w = weeks.find((x) => x.t === monday(dayMs(a.start)));
      const k = kinds.findIndex((x) => x.sport.id === a.sport);
      if (!w || k < 0) continue;
      w.values[k] += minutesOf(a);
      w.n[k]++;
    }
    const series = kinds.map((k) => ({ name: k.sport.short ?? k.sport.name, color: k.color }));
    const avg = Math.round(mean(weeks.map((w) => w.values.reduce((a, b) => a + b, 0))) ?? 0);
    const card = chartCard(this, grid, "Minutes per week",
      `How regularly you do them · ${avg} min a week on average over ${weeks.length} week${weeks.length === 1 ? "" : "s"}`,
      (el) => stackedColumns(el, weeks, series, {
        unit: "min", format: (v) => `${Math.round(v)}`,
        labels: (t) => new Date(t).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" }),
        describe: (t) => `Week of ${new Date(t).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" })}`,
      }),
      [
        { label: "Week of", get: (w) => new Date(w.t).toISOString().slice(0, 10) },
        ...series.map((s, k) => ({ label: s.name, get: (w) => (w.n[k] ? `${w.values[k]} min (${w.n[k]}×)` : "–"), num: true })),
      ],
      [...weeks].reverse(),
      series);
    card.classList.add("wide");
  }

  emptyNote(card, any) {
    if (any) return;
    card.querySelector(".card-body").textContent = this.hr.fetchDay
      ? "No heart rate for these sessions yet: the Loop's data arrives with the next Polar sync."
      : "Connect GitHub sync to load heart rate.";
  }
}
