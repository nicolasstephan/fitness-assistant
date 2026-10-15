// Health dashboard: WHOOP history (health/whoop.json in the private data repo).
import { lineChart, stackedColumns, hBars, dataTable, linearTrend } from "./charts.js";
import { checkinQuestions } from "./checkin.js";

const DAY = 86400000;
const RANGES = { 30: 30, 90: 90, 365: 365, all: Infinity };

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const tUTC = (date) => Date.parse(`${date}T00:00:00Z`);
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtWeek = (t) => `Week of ${new Date(t).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })}`;
const hm = (min) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const mean = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export class HealthView {
  constructor(root) {
    this.root = root;
    this.doc = null;
    this.range = "90";
    root.querySelectorAll("[data-range]").forEach((b) =>
      b.addEventListener("click", () => {
        this.range = b.dataset.range;
        this.render();
      }),
    );
    let w = 0;
    new ResizeObserver(() => {
      if (root.hidden || root.clientWidth === w) return;
      w = root.clientWidth;
      this.render();
    }).observe(root);
  }

  setData(doc) {
    this.doc = doc;
    this.render();
  }

  /** Daily check-ins (journal.json days); their answers join the journal-vs-recovery analysis. */
  setCheckins(days) {
    this.checkins = days ?? {};
    this.render();
  }

  setMessage(text) {
    const el = this.root.querySelector("#health-empty");
    el.textContent = text;
    el.hidden = !text;
  }

  /** Days in the selected range, plus the equally long period before it (for deltas). */
  slice() {
    const days = this.doc.days.map((d) => ({
      ...d,
      t: tUTC(d.date),
      journal: { ...d.journal, ...checkinQuestions(this.checkins?.[d.date]) },
    }));
    const end = days.at(-1).t;
    const n = RANGES[this.range];
    const start = n === Infinity ? days[0].t : end - (n - 1) * DAY;
    const cur = days.filter((d) => d.t >= start);
    const prevStart = start - (end - start + DAY);
    // compare only against a previous period that is mostly covered by data
    const prevDays = n === Infinity ? [] : days.filter((d) => d.t >= prevStart && d.t < start);
    const prev = prevDays.length >= cur.length / 2 ? prevDays : [];
    const workouts = this.doc.workouts
      .map((w) => ({ ...w, t: tUTC(w.start.slice(0, 10)) }))
      .filter((w) => w.t >= start);
    const prevWorkouts = !prev.length ? null : this.doc.workouts.filter((w) => {
      const t = tUTC(w.start.slice(0, 10));
      return t >= prevStart && t < start;
    });
    return { days, cur, prev, workouts, prevWorkouts, start, end };
  }

  /** Daily points up to ~3 months, weekly means (Monday-based) beyond. */
  bucket(days, get) {
    const span = (days.at(-1).t - days[0].t) / DAY;
    if (span <= 92) return { points: days.map((d) => ({ t: d.t, v: get(d), day: d })), describe: fmtDay, weekly: false };
    const weeks = new Map();
    for (const d of days) {
      const dow = (new Date(d.t).getUTCDay() + 6) % 7;
      const wk = d.t - dow * DAY;
      if (!weeks.has(wk)) weeks.set(wk, []);
      weeks.get(wk).push(d);
    }
    const points = [...weeks].map(([t, ds]) => ({ t, v: mean(ds.map(get)), days: ds }));
    return { points, describe: fmtWeek, weekly: true };
  }

  render() {
    if (!this.doc || this.root.hidden) return;
    this.root.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-checked", b.dataset.range === this.range));
    const { from, to } = this.doc.range;
    this.root.querySelector("#health-source").textContent =
      `WHOOP · ${fmtDay(tUTC(from))} – ${fmtDay(tUTC(to))} · imported ${new Date(this.doc.importedAt).toLocaleDateString()}`;

    const s = this.slice();
    this.renderTiles(s);
    this.renderCards(s);
  }

  renderTiles({ cur, prev, workouts, prevWorkouts }) {
    // deltaFmt formats the absolute change; higherIsGood null = neutral (no good/bad color)
    const tile = (label, value, prevValue, fmt, deltaFmt, higherIsGood) => ({ label, value, prevValue, fmt, deltaFmt, higherIsGood });
    const avg = (get) => [mean(cur.map(get)), mean(prev.map(get))];
    const tiles = [
      tile("Avg recovery", ...avg((d) => d.recovery), (v) => `${Math.round(v)}%`, (d) => `${Math.round(d)} pts`, true),
      tile("Avg HRV", ...avg((d) => d.hrv), (v) => `${Math.round(v)} ms`, (d) => `${Math.round(d)} ms`, true),
      tile("Avg resting heart rate", ...avg((d) => d.rhr), (v) => `${Math.round(v)} bpm`, (d) => `${Math.round(d)} bpm`, false),
      tile("Avg sleep per night", ...avg((d) => d.sleep.asleepMin), (v) => `${hm(v)} h`, (d) => `${Math.round(d)} min`, true),
      tile("Avg sleep score", ...avg((d) => d.sleep.performance), (v) => `${Math.round(v)}%`, (d) => `${Math.round(d)} pts`, true),
      tile("Workouts", workouts.length, prevWorkouts?.length ?? null, (v) => `${v}`, (d) => `${Math.round(d)}`, null),
    ];
    const el = this.root.querySelector("#health-tiles");
    el.replaceChildren(
      ...tiles.map((t) => {
        const div = document.createElement("div");
        div.className = "tile";
        const label = document.createElement("div");
        label.className = "tile-label";
        label.textContent = t.label;
        const value = document.createElement("div");
        value.className = "tile-value";
        value.textContent = t.value == null ? "–" : t.fmt(t.value);
        div.append(label, value);
        if (t.value != null && t.prevValue != null) {
          const diff = t.value - t.prevValue;
          const delta = document.createElement("div");
          const rounded = t.deltaFmt(Math.abs(diff));
          const up = diff > 0;
          const good = t.higherIsGood == null || Math.round(diff) === 0 ? null : up === t.higherIsGood;
          delta.className = `tile-delta ${good == null ? "" : good ? "good" : "bad"}`;
          delta.textContent = `${Math.round(diff) === 0 ? "±" : up ? "▲" : "▼"} ${rounded} vs previous period`;
          div.appendChild(delta);
        }
        return div;
      }),
    );
  }

  /**
   * Trailing rolling mean over `window` calendar days, for each day in `cur`.
   * Uses all days (also before the range) and needs at least half the window filled.
   */
  rolling(days, cur, get, window) {
    const byT = new Map(days.map((d) => [d.t, get(d)]));
    return cur.map((d) => {
      const vals = [];
      for (let k = 0; k < window; k++) {
        const v = byT.get(d.t - k * DAY);
        if (v != null) vals.push(v);
      }
      return { t: d.t, v: vals.length >= window / 2 ? mean(vals) : null };
    });
  }

  renderCards({ days, cur, workouts }) {
    const cards = this.root.querySelector("#health-cards");
    cards.replaceChildren();
    // charts are sized from their container, so draw only once every card is in the grid
    this.pendingDraws = [];
    const blue = css("--series-1");
    const trendColor = css("--trend");
    const long = this.range === "365" || this.range === "all";
    const window = this.range === "30" ? 7 : 30;
    const smoothLabel = `${window}-day average`;
    const period = { 30: "30 days", 90: "90 days", 365: "1 year", all: "the whole period" }[this.range];

    // Straight-line verdict, only for long ranges. It is fitted on weekly means, which are far less
    // autocorrelated than days, e.g. "▼ 1.8 bpm over 1 year · improved". A slope that does not clear
    // the noise (|t| < 2) reads as "no clear trend".
    const verdict = (trend, fmtDelta, higherIsGood) => {
      if (!trend) return null;
      const shown = fmtDelta(Math.abs(trend.delta));
      const up = trend.delta > 0;
      if (Math.abs(trend.tStat) < 2) return { text: `${up ? "▲" : "▼"} ${shown} over ${period} · no clear trend`, cls: "" };
      const good = higherIsGood == null ? null : up === higherIsGood;
      return {
        text: `${up ? "▲" : "▼"} ${shown} over ${period}${good == null ? "" : good ? " · improved" : " · worsened"}`,
        cls: good == null ? "" : good ? "good" : "bad",
      };
    };
    const keys = (weekly, color, trend) => [
      { name: smoothLabel, color, line: true },
      { name: weekly ? "Weekly average" : "Daily", color, line: true, faint: true },
      ...(trend ? [{ name: "Trend", color: trendColor, line: true }] : []),
    ];

    const lineCard = (title, sub, get, opts, unitLabel, fmtDelta, higherIsGood) => {
      const b = this.bucket(cur, get);
      const smooth = this.rolling(days, cur, get, window);
      const trend = long ? linearTrend(b.points) : null;
      const byT = new Map(smooth.map((p) => [p.t, p.v]));
      this.card(cards, title, sub,
        (el) => lineChart(el, b.points, {
          color: blue, describe: b.describe, trend,
          smooth: { points: smooth, label: smoothLabel }, baseLabel: b.weekly ? "weekly average" : "that day",
          ...opts,
        }),
        [
          { label: b.weekly ? "Week of" : "Date", get: (p) => new Date(p.t).toISOString().slice(0, 10) },
          { label: unitLabel, get: (p) => (p.v == null ? null : opts.format(p.v)), num: true },
          ...(b.weekly ? [] : [{ label: smoothLabel, get: (p) => (byT.get(p.t) == null ? null : opts.format(byT.get(p.t))), num: true }]),
          ...(trend ? [{ label: "Trend", get: (p) => opts.format(trend.at(p.t)), num: true }] : []),
        ],
        b.points,
        keys(b.weekly, blue, trend),
        long ? verdict(trend, fmtDelta, higherIsGood) : null);
    };

    const round = (unit) => (d) => `${Math.round(d)} ${unit === "pts" && Math.round(d) === 1 ? "pt" : unit}`;
    const oneDecimal = (unit) => (d) => `${d.toFixed(1)}${unit ? ` ${unit}` : ""}`;
    const pct = { ticks: [0, 25, 50, 75, 100], unit: "%", format: (v) => `${Math.round(v)}` };
    lineCard("Recovery", "Morning recovery score, %", (d) => d.recovery, pct, "Recovery %", round("pts"), true);
    lineCard("Heart rate variability", "During sleep, ms", (d) => d.hrv, { unit: "ms", format: (v) => `${Math.round(v)}` }, "HRV (ms)", round("ms"), true);
    lineCard("Resting heart rate", "bpm", (d) => d.rhr, { unit: "bpm", format: (v) => `${Math.round(v)}` }, "RHR (bpm)", oneDecimal("bpm"), false);
    lineCard("Sleep score", "WHOOP sleep performance: sleep you got vs. sleep you needed, %", (d) => d.sleep.performance, pct, "Sleep score %", round("pts"), true);

    // sleep stages, hours; rolling average and trend of the total
    const stages = [
      { name: "Deep", key: "deepMin", color: css("--series-1") },
      { name: "REM", key: "remMin", color: css("--series-2") },
      { name: "Light", key: "lightMin", color: css("--series-3") },
    ];
    const asleepH = (d) => (d.sleep.asleepMin == null ? null : d.sleep.asleepMin / 60);
    const sb = this.bucket(cur, asleepH);
    const sleepRows = sb.points.map((p) => {
      const ds = p.days ?? [p.day];
      return { t: p.t, values: stages.map((st) => { const m = mean(ds.map((d) => d.sleep[st.key])); return m == null ? 0 : m / 60; }) };
    });
    const sleepSmooth = this.rolling(days, cur, asleepH, window);
    const sleepTrend = long ? linearTrend(sb.points) : null;
    this.card(cards, "Sleep stages", `Hours asleep per night${sb.weekly ? " · weekly average" : ""}`,
      (el) => stackedColumns(el, sleepRows, stages, { unit: "h", describe: sb.describe, format: (v) => hm(v * 60), trend: sleepTrend, smooth: sleepSmooth }),
      [
        { label: sb.weekly ? "Week of" : "Date", get: (r) => new Date(r.t).toISOString().slice(0, 10) },
        ...stages.map((st, k) => ({ label: `${st.name} (h)`, get: (r) => hm(r.values[k] * 60), num: true })),
        ...(sleepTrend ? [{ label: "Trend total (h)", get: (r) => hm(sleepTrend.at(r.t) * 60), num: true }] : []),
      ],
      sleepRows,
      [...stages, { name: `${smoothLabel} (total)`, color: css("--text"), line: true },
        ...(sleepTrend ? [{ name: "Trend (total)", color: trendColor, line: true }] : [])],
      long ? verdict(sleepTrend, (d) => `${Math.round(d * 60)} min`, true) : null);

    lineCard("Day strain", "WHOOP strain, 0–21", (d) => d.strain, { ticks: [0, 7, 14, 21], tickFormat: (v) => `${v}`, format: (v) => v.toFixed(1) }, "Strain", oneDecimal(""), null);

    // workouts by activity (hours), top 6 + Other
    const byActivity = new Map();
    for (const w of workouts) byActivity.set(w.activity, (byActivity.get(w.activity) ?? 0) + (w.durationMin ?? 0) / 60);
    let rows = [...byActivity].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    if (rows.length > 7) rows = [...rows.slice(0, 6), { label: "Other", value: rows.slice(6).reduce((a, r) => a + r.value, 0) }];
    this.card(cards, "Workouts by activity", `Hours · ${workouts.length} workouts`,
      (el) => (rows.length ? hBars(el, rows, { color: blue, format: (v) => `${v.toFixed(1)} h` }) : (el.textContent = "No workouts in this period.")),
      [{ label: "Activity", get: (r) => r.label }, { label: "Hours", get: (r) => r.value.toFixed(1), num: true }],
      rows);

    this.periodCard(cards, cur, workouts);
    this.journalCard(cards, cur);
    this.workoutsCard(cards, workouts);
    this.pendingDraws.forEach((draw) => draw());
  }

  /** Averages per week (30 days), month (90 days) or quarter (longer), oldest first. */
  periodCard(cards, cur, workouts) {
    const unit = this.range === "30" ? "week" : this.range === "90" ? "month" : "quarter";
    const keyOf = (t) => {
      const d = new Date(t);
      if (unit === "week") return t - ((d.getUTCDay() + 6) % 7) * DAY;
      if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
    };
    const label = (k) => {
      const d = new Date(k);
      if (unit === "week") return `Week of ${d.toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" })}`;
      if (unit === "month") return d.toLocaleDateString(undefined, { timeZone: "UTC", month: "long", year: "numeric" });
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    };
    const groups = new Map();
    for (const d of cur) {
      const k = keyOf(d.t);
      if (!groups.has(k)) groups.set(k, { k, days: [], workouts: 0 });
      groups.get(k).days.push(d);
    }
    for (const w of workouts) {
      const g = groups.get(keyOf(w.t));
      if (g) g.workouts++;
    }
    const rows = [...groups.values()].sort((a, b) => a.k - b.k);
    const avg = (g, get) => mean(g.days.map(get));
    const fixed = (v, digits) => (v == null ? null : v.toFixed(digits));

    const card = this.card(cards, `By ${unit}`, `Averages per ${unit}; the Days column shows partial ${unit}s at the edges`, null, null, null);
    dataTable(card.querySelector(".card-body"), [
      { label: unit[0].toUpperCase() + unit.slice(1), get: (g) => label(g.k) },
      { label: "Days", get: (g) => g.days.length, num: true },
      { label: "Recovery %", get: (g) => fixed(avg(g, (d) => d.recovery), 0), num: true },
      { label: "HRV", get: (g) => fixed(avg(g, (d) => d.hrv), 0), num: true },
      { label: "RHR", get: (g) => fixed(avg(g, (d) => d.rhr), 1), num: true },
      { label: "Sleep", get: (g) => { const v = avg(g, (d) => d.sleep.asleepMin); return v == null ? null : hm(v); }, num: true },
      { label: "Sleep score", get: (g) => fixed(avg(g, (d) => d.sleep.performance), 0), num: true },
      { label: "Strain", get: (g) => fixed(avg(g, (d) => d.strain), 1), num: true },
      { label: "Workouts", get: (g) => g.workouts, num: true },
    ], rows);
  }

  journalCard(cards, cur) {
    const questions = new Map();
    for (const d of cur) {
      if (d.recovery == null) continue;
      for (const [q, yes] of Object.entries(d.journal)) {
        if (!questions.has(q)) questions.set(q, { yes: [], no: [] });
        questions.get(q)[yes ? "yes" : "no"].push(d.recovery);
      }
    }
    const rows = [...questions]
      .filter(([, v]) => v.yes.length >= 5 && v.no.length >= 5)
      .map(([q, v]) => ({ q, nYes: v.yes.length, nNo: v.no.length, yes: mean(v.yes), no: mean(v.no), diff: mean(v.yes) - mean(v.no) }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const card = this.card(cards, "Journal vs. recovery", "Average recovery on mornings after answering yes vs. no (at least 5 of each)", null, null, null);
    const body = card.querySelector(".card-body");
    if (!rows.length) {
      body.textContent = "Not enough journal answers in this period.";
      return;
    }
    dataTable(body, [
      { label: "Question", get: (r) => r.q },
      { label: "Yes", get: (r) => `${Math.round(r.yes)}% (${r.nYes})`, num: true },
      { label: "No", get: (r) => `${Math.round(r.no)}% (${r.nNo})`, num: true },
      {
        label: "Difference",
        get: (r) => {
          const n = Math.round(r.diff);
          return n === 0 ? "± 0 pts" : `${n > 0 ? "▲ +" : "▼ −"}${Math.abs(n)} ${Math.abs(n) === 1 ? "pt" : "pts"}`;
        },
        num: true,
      },
    ], rows);
    body.querySelectorAll("tbody tr").forEach((tr, i) => {
      const n = Math.round(rows[i].diff);
      if (n !== 0) tr.lastElementChild.classList.add(n > 0 ? "good" : "bad");
    });
    const note = document.createElement("p");
    note.className = "card-note";
    note.textContent = "Associations, not causes: e.g. caffeine days may also be short-sleep days.";
    body.appendChild(note);
  }

  workoutsCard(cards, workouts) {
    const recent = workouts.slice(-10).reverse();
    const card = this.card(cards, "Recent workouts", `Last ${recent.length} in this period`, null, null, null);
    const body = card.querySelector(".card-body");
    if (!recent.length) {
      body.textContent = "No workouts in this period.";
      return;
    }
    dataTable(body, [
      { label: "Date", get: (w) => w.start.slice(0, 10) },
      { label: "Activity", get: (w) => w.activity },
      { label: "Duration", get: (w) => `${w.durationMin} min`, num: true },
      { label: "Strain", get: (w) => w.strain?.toFixed(1), num: true },
      { label: "Avg HR", get: (w) => w.avgHr, num: true },
    ], recent);
  }

  /** A chart card with a Chart/Table toggle. Returns the card element. */
  card(parent, title, subtitle, drawChart, tableColumns, tableRows, legend, summary) {
    const card = document.createElement("article");
    card.className = "card";
    const head = document.createElement("header");
    const h = document.createElement("h2");
    h.textContent = title;
    const sub = document.createElement("p");
    sub.className = "card-sub";
    sub.textContent = subtitle;
    const titles = document.createElement("div");
    titles.append(h, sub);
    head.appendChild(titles);
    const body = document.createElement("div");
    body.className = "card-body";
    card.append(head);

    if (legend) {
      const lg = document.createElement("div");
      lg.className = "legend-row";
      for (const s of legend) {
        const item = document.createElement("span");
        const sw = document.createElement("i");
        sw.style.background = s.color;
        if (s.line) sw.className = s.faint ? "line-key faint" : "line-key"; // legends mirror the mark: short stroke for lines
        item.append(sw, document.createTextNode(s.name));
        lg.appendChild(item);
      }
      if (summary) {
        const v = document.createElement("strong");
        v.className = `trend-verdict ${summary.cls}`;
        v.textContent = summary.text;
        lg.appendChild(v);
      }
      card.appendChild(lg);
    }
    card.appendChild(body);
    parent.appendChild(card);

    if (drawChart) {
      const toggle = document.createElement("button");
      toggle.className = "ghost small";
      toggle.textContent = "Table";
      let table = false;
      const draw = () => {
        toggle.textContent = table ? "Chart" : "Table";
        if (table) dataTable(body, tableColumns, tableRows);
        else drawChart(body);
      };
      toggle.addEventListener("click", () => {
        table = !table;
        body.classList.toggle("is-table", table);
        draw();
      });
      head.appendChild(toggle);
      this.pendingDraws.push(draw);
    }
    return card;
  }
}
