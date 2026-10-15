// Health dashboard: WHOOP history (health/whoop.json in the private data repo).
import { lineChart, stackedColumns, hBars, dataTable } from "./charts.js";

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

  setMessage(text) {
    const el = this.root.querySelector("#health-empty");
    el.textContent = text;
    el.hidden = !text;
  }

  /** Days in the selected range, plus the equally long period before it (for deltas). */
  slice() {
    const days = this.doc.days.map((d) => ({ ...d, t: tUTC(d.date) }));
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
    return { cur, prev, workouts, prevWorkouts, start, end };
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

  renderCards({ cur, workouts }) {
    const cards = this.root.querySelector("#health-cards");
    cards.replaceChildren();
    // charts are sized from their container, so draw only once every card is in the grid
    this.pendingDraws = [];
    const blue = css("--series-1");

    const lineCard = (title, sub, get, opts, unitLabel) => {
      const b = this.bucket(cur, get);
      this.card(cards, title, `${sub}${b.weekly ? " · weekly average" : ""}`,
        (el) => lineChart(el, b.points, { color: blue, describe: b.describe, ...opts }),
        [
          { label: b.weekly ? "Week of" : "Date", get: (p) => new Date(p.t).toISOString().slice(0, 10) },
          { label: unitLabel, get: (p) => (p.v == null ? null : opts.format(p.v)), num: true },
        ],
        b.points);
    };

    lineCard("Recovery", "Morning recovery score, %", (d) => d.recovery, { ticks: [0, 25, 50, 75, 100], unit: "%", format: (v) => `${Math.round(v)}` }, "Recovery %");
    lineCard("Heart rate variability", "During sleep, ms", (d) => d.hrv, { unit: "ms", format: (v) => `${Math.round(v)}` }, "HRV (ms)");
    lineCard("Resting heart rate", "bpm", (d) => d.rhr, { unit: "bpm", format: (v) => `${Math.round(v)}` }, "RHR (bpm)");

    // sleep stages, hours
    const stages = [
      { name: "Deep", key: "deepMin", color: css("--series-1") },
      { name: "REM", key: "remMin", color: css("--series-2") },
      { name: "Light", key: "lightMin", color: css("--series-3") },
    ];
    const sb = this.bucket(cur, (d) => d.sleep.asleepMin);
    const sleepRows = sb.points.map((p) => {
      const ds = p.days ?? [p.day];
      return { t: p.t, values: stages.map((st) => { const m = mean(ds.map((d) => d.sleep[st.key])); return m == null ? 0 : m / 60; }) };
    });
    this.card(cards, "Sleep stages", `Hours asleep per night${sb.weekly ? " · weekly average" : ""}`,
      (el) => stackedColumns(el, sleepRows, stages, { unit: "h", describe: sb.describe, format: (v) => hm(v * 60) }),
      [
        { label: sb.weekly ? "Week of" : "Date", get: (r) => new Date(r.t).toISOString().slice(0, 10) },
        ...stages.map((st, k) => ({ label: `${st.name} (h)`, get: (r) => hm(r.values[k] * 60), num: true })),
      ],
      sleepRows,
      stages);

    lineCard("Day strain", "WHOOP strain, 0–21", (d) => d.strain, { ticks: [0, 7, 14, 21], tickFormat: (v) => `${v}`, format: (v) => v.toFixed(1) }, "Strain");

    // workouts by activity (hours), top 6 + Other
    const byActivity = new Map();
    for (const w of workouts) byActivity.set(w.activity, (byActivity.get(w.activity) ?? 0) + (w.durationMin ?? 0) / 60);
    let rows = [...byActivity].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    if (rows.length > 7) rows = [...rows.slice(0, 6), { label: "Other", value: rows.slice(6).reduce((a, r) => a + r.value, 0) }];
    this.card(cards, "Workouts by activity", `Hours · ${workouts.length} workouts`,
      (el) => (rows.length ? hBars(el, rows, { color: blue, format: (v) => `${v.toFixed(1)} h` }) : (el.textContent = "No workouts in this period.")),
      [{ label: "Activity", get: (r) => r.label }, { label: "Hours", get: (r) => r.value.toFixed(1), num: true }],
      rows);

    this.journalCard(cards, cur);
    this.workoutsCard(cards, workouts);
    this.pendingDraws.forEach((draw) => draw());
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
      { label: "Difference", get: (r) => `${r.diff >= 0 ? "▲ +" : "▼ −"}${Math.abs(Math.round(r.diff))} pts`, num: true },
    ], rows);
    body.querySelectorAll("tbody tr").forEach((tr, i) => tr.lastElementChild.classList.add(rows[i].diff >= 0 ? "good" : "bad"));
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
  card(parent, title, subtitle, drawChart, tableColumns, tableRows, legend) {
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
        item.append(sw, document.createTextNode(s.name));
        lg.appendChild(item);
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
