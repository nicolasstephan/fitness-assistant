// Cross-references for the Health view: what goes with better or worse recovery, sleep and training.
// Every card uses all data (not the selected range): the comparisons need many nights. A value is shown only
// when it rests on at least MIN_N days; fewer show as "–" with the counts, so the table fills in over time.
//
// Outcomes are taken relative to your own normal (60 days before, same device, like the HRV band), so the
// WHOOP-to-Polar switch and slow drifts don't pass for an effect. The health day d is the night that ends on
// the morning of d plus the day d itself (check-in "felt", SleepWise alertness).
import { dataTable } from "./charts.js";
import { progressMetric } from "./training-log.js";
import { describeItem } from "./supplements.js";

const DAY = 86400000;
const MIN = 60000;
export const MIN_N = 5;
const BASE_DAYS = 60;
const BASE_MIN = 14;

const msOf = (local) => Date.parse(`${local}:00Z`); // local wall-clock times compared as "UTC", like the rest
const tUTC = (date) => Date.parse(`${date}T00:00:00Z`);
const shift = (date, n) => new Date(tUTC(date) + n * DAY).toISOString().slice(0, 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pctLog = (x) => (Math.exp(x) - 1) * 100;
const signed = (v, digits = 0, unit = "") => {
  const r = Number(v.toFixed(digits));
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(digits)}${unit}`;
};

/**
 * Per-device deviation from the 60 days before (at least 14 values), in place: d.dev = { hrv, rhr, sleep, asleep }.
 * hrv is the log difference from annotateHrv; sleep is Polar's sleep score or WHOOP's sleep performance.
 */
export function annotateDeviations(days) {
  const src = (d) => d.source ?? "whoop";
  const metrics = {
    rhr: (d) => d.rhr,
    sleep: (d) => (src(d) === "polar" ? d.sleep?.score : d.sleep?.performance) ?? null,
    asleep: (d) => d.sleep?.asleepMin ?? null,
  };
  for (const d of days) d.dev = { hrv: d.hrvDev ?? null };
  for (const [key, get] of Object.entries(metrics)) {
    const vals = days.map(get);
    days.forEach((d, i) => {
      d.dev[key] = null;
      if (vals[i] == null) return;
      const base = [];
      for (let k = Math.max(0, i - BASE_DAYS); k < i; k++) if (vals[k] != null && src(days[k]) === src(d)) base.push(vals[k]);
      if (base.length >= BASE_MIN) d.dev[key] = vals[i] - mean(base);
    });
  }
}

// what can be compared; relative ones are deviations from your normal, absolute ones plain values
const OUTCOMES = {
  hrv: { label: "HRV", get: (d) => d.dev?.hrv, show: (v) => signed(pctLog(v), 0, "%"), size: pctLog, noise: 3, higher: true },
  rhr: { label: "Resting HR", get: (d) => d.dev?.rhr, show: (v) => signed(v, 1, " bpm"), noise: 1, higher: false },
  sleep: { label: "Sleep score", get: (d) => d.dev?.sleep, show: (v) => signed(v, 0, " pts"), noise: 3, higher: true },
  asleep: { label: "Sleep time", get: (d) => d.dev?.asleep, show: (v) => signed(v, 0, " min"), noise: 10, higher: true },
  ans: { label: "ANS charge", get: (d) => d.ansCharge, show: (v) => signed(v, 1), noise: 1, higher: true, own: true },
  recharge: { label: "Recharge 1–6", get: (d) => d.recharge, show: (v) => v.toFixed(1), diff: (v) => signed(v, 1), noise: 0.5, higher: true, absolute: true },
  alert: { label: "Alertness", get: (d) => d.alertness?.grade, show: (v) => v.toFixed(1), diff: (v) => signed(v, 1), noise: 0.5, higher: true, absolute: true },
  felt: { label: "Felt 1–5", get: (d) => d.felt, show: (v) => v.toFixed(1), diff: (v) => signed(v, 1), noise: 0.3, higher: true, absolute: true },
};
const valuesOf = (ds, o) => ds.map((d) => (d ? o.get(d) : null)).filter((v) => v != null);
const tone = (o, v) => {
  const s = (o.size ?? ((x) => x))(v);
  return Math.abs(s) < o.noise ? "" : (s > 0) === o.higher ? "good" : "bad";
};
/** Mean of a group: relative outcomes signed and colored, absolute ones plain. */
const meanCell = (ds, o) => {
  const v = valuesOf(ds, o);
  if (v.length < MIN_N) return null;
  const m = mean(v);
  return { text: o.show(m), cls: o.absolute ? "" : tone(o, m) };
};
/** Difference of two groups' means (yes minus no). */
const diffCell = (yes, no, o) => {
  const a = valuesOf(yes, o), b = valuesOf(no, o);
  if (a.length < MIN_N || b.length < MIN_N) return null;
  const d = mean(a) - mean(b);
  return { text: (o.diff ?? o.show)(d), cls: tone(o, d) };
};
/** Pearson correlation of pairs [[x, y]], or null under 10 pairs. */
const pearson = (pairs) => {
  if (pairs.length < 10) return null;
  const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
};
const strength = (r) => (Math.abs(r) < 0.2 ? "no link" : Math.abs(r) < 0.4 ? "weak" : Math.abs(r) < 0.6 ? "moderate" : "strong");

const workoutEnd = (w) => (w.end ? msOf(w.end) : msOf(w.start) + (w.durationMin ?? 0) * MIN);
const hardMinutes = (w) => (w.zones?.length ? (((w.zones[3] ?? 0) + (w.zones[4] ?? 0)) / 100) * (w.zoneMin ?? w.durationMin ?? 0) : 0);
// minutes of the sleep onset from midnight before the wake-up day (23:15 = -45), like SleepWise's bedtimes
const onsetMin = (d) => {
  let m = (msOf(d.sleep.onset) - tUTC(d.date)) / MIN;
  while (m > 720) m -= 1440;
  while (m < -720) m += 1440;
  return m;
};

/** A table card: rows with a label column, a count column and outcome columns; message when nothing to show. */
function tableCard(view, parent, { title, sub, columns, rows, empty, notes = [], wide = true }) {
  const card = view.card(parent, title, sub, null, null, null);
  card.classList.add("insight");
  if (wide) card.classList.add("wide");
  const body = card.querySelector(".card-body");
  if (!rows.length) body.textContent = empty;
  else {
    body.classList.add("is-table");
    dataTable(body, columns, rows);
  }
  for (const text of notes.filter(Boolean)) {
    const p = document.createElement("p");
    p.className = "card-note";
    p.textContent = text;
    card.appendChild(p);
  }
  return card;
}
const outcomeColumns = (keys, cell, label = (o) => o.label) =>
  keys.map((k) => ({ label: label(OUTCOMES[k]), get: (r) => cell(r, OUTCOMES[k], k), num: true }));
const NOISE_NOTE = "Associations, not causes. Values need at least 5 days per group; small differences are noise.";

// ---------- 1. journal answers vs. the night after

/**
 * Check-in answers, supplements taken and resting sessions (d.journal, already moved to the night after them)
 * against that night's HRV, resting HR, sleep score, ANS charge and how you felt the next day.
 */
export function journalCard(view, parent, { days }) {
  const keys = ["hrv", "rhr", "sleep", "ans", "felt"];
  const questions = new Map();
  for (const d of days) {
    if (!keys.some((k) => OUTCOMES[k].get(d) != null)) continue;
    for (const [q, yes] of Object.entries(d.journal ?? {})) {
      if (!questions.has(q)) questions.set(q, { q, yes: [], no: [] });
      questions.get(q)[yes ? "yes" : "no"].push(d);
    }
  }
  // biggest HRV difference first (the most studied measure); questions without one at the end
  const hrvGap = (r) => {
    const a = valuesOf(r.yes, OUTCOMES.hrv), b = valuesOf(r.no, OUTCOMES.hrv);
    return a.length >= MIN_N && b.length >= MIN_N ? Math.abs(mean(a) - mean(b)) : -1;
  };
  const rows = [...questions.values()]
    .map((r) => ({ ...r, cells: Object.fromEntries(keys.map((k) => [k, diffCell(r.yes, r.no, OUTCOMES[k])])) }))
    .filter((r) => keys.some((k) => r.cells[k]))
    .sort((a, b) => hrvGap(b) - hrvGap(a));
  tableCard(view, parent, {
    title: "Journal vs. recovery",
    sub: "The night after answering yes vs. no: difference in HRV, resting HR and sleep score (each vs. your normal), Polar ANS charge, and how you felt the next day",
    columns: [
      { label: "Question", get: (r) => r.q },
      { label: "Yes / no", get: (r) => `${r.yes.length} / ${r.no.length}`, num: true },
      ...outcomeColumns(keys, (r, o, k) => r.cells[k]),
    ],
    rows,
    empty: "Not enough answers yet: a question needs at least 5 yes and 5 no days.",
    notes: [NOISE_NOTE + " Caffeine days may also be short-sleep days, and so on."],
  });
}

// ---------- 2. late workouts vs. sleep

const LATE_H = 3;
export function lateWorkoutCard(view, parent, { days, workouts }) {
  const ends = workouts.filter((w) => w.cat !== "Walking").map(workoutEnd);
  const groups = [
    { label: `Workout < ${LATE_H} h before sleep`, ds: [] },
    { label: "Workout earlier", ds: [] },
    { label: "No workout", ds: [] },
  ];
  for (const d of days) {
    if (!d.sleep?.onset) continue;
    const on = msOf(d.sleep.onset);
    const before = ends.filter((e) => e <= on && e > on - 18 * 60 * MIN);
    const late = before.some((e) => on - e <= LATE_H * 60 * MIN);
    groups[late ? 0 : before.length ? 1 : 2].ds.push(d);
  }
  const keys = ["sleep", "asleep", "hrv", "rhr", "ans"];
  const [late, earlier] = groups;
  const gap = ["sleep", "hrv"].map((k) => [OUTCOMES[k].label, diffCell(late.ds, earlier.ds, OUTCOMES[k])]).filter(([, c]) => c);
  tableCard(view, parent, {
    title: "Late workouts vs. sleep",
    sub: `Nights after a workout that ended within ${LATE_H} h of falling asleep, after an earlier one, and without one; vs. your normal (walks not counted)`,
    columns: [
      { label: "Evening", get: (g) => g.label },
      { label: "Nights", get: (g) => g.ds.length, num: true },
      ...outcomeColumns(keys, (g, o) => meanCell(g.ds, o)),
    ],
    rows: groups.some((g) => g.ds.length) ? groups : [],
    empty: "No nights with a sleep time yet.",
    notes: [gap.length ? `Late vs. earlier: ${gap.map(([l, c]) => `${l} ${c.text}`).join(", ")}.` : null, NOISE_NOTE],
  });
}

// ---------- 3. training day vs. the next two nights

const HARD_MIN = 15;
export function trainingAfterCard(view, parent, { days, workouts }) {
  const byDay = new Map();
  for (const w of workouts) {
    const date = w.start.slice(0, 10);
    const e = byDay.get(date) ?? { cats: new Set(), hard: 0 };
    e.cats.add(w.cat);
    e.hard += hardMinutes(w);
    byDay.set(date, e);
  }
  const health = new Map(days.map((d) => [d.date, d]));
  const types = [
    { label: "Rest day", test: (e) => !e },
    ...["Strength", "Cardio", "Sports & other", "Walking"].map((c) => ({ label: c, test: (e) => e?.cats.has(c) })),
    { label: `Hard: ≥ ${HARD_MIN} min in zones 4–5`, test: (e) => e?.hard >= HARD_MIN },
  ].map((t) => ({ ...t, n1: [], n2: [] }));
  for (const d of days) {
    const n1 = health.get(shift(d.date, 1));
    if (!n1 || n1.hrv == null) continue; // the next night was measured
    const e = byDay.get(d.date);
    for (const t of types) {
      if (!t.test(e)) continue;
      t.n1.push(n1);
      t.n2.push(health.get(shift(d.date, 2)) ?? null);
    }
  }
  const rows = types.filter((t) => t.n1.length);
  const col = (label, key, night) => ({ label, get: (t) => meanCell(t[night], OUTCOMES[key]), num: true });
  tableCard(view, parent, {
    title: "Training vs. the next nights",
    sub: "After each kind of day: the next two nights vs. your normal, and how you felt the next day (a day can count in several rows)",
    columns: [
      { label: "Day", get: (t) => t.label },
      { label: "Days", get: (t) => t.n1.length, num: true },
      col("HRV night 1", "hrv", "n1"),
      col("HRV night 2", "hrv", "n2"),
      col("Resting HR night 1", "rhr", "n1"),
      col("ANS charge night 1", "ans", "n1"),
      col("Felt next day", "felt", "n1"),
    ],
    rows,
    empty: "No measured nights yet.",
    notes: ["Zone minutes come from the tracker; workouts logged without it count by category only. " + NOISE_NOTE],
  });
}

// ---------- 4. bedtime vs. the body clock's sleep gate

export function sleepGateCard(view, parent, { days }) {
  const groups = [
    { label: "> 30 min early", ds: [] },
    { label: "On time (± 30 min)", ds: [] },
    { label: "30–90 min late", ds: [] },
    { label: "> 90 min late", ds: [] },
  ];
  for (const d of days) {
    if (!d.sleep?.onset || !d.bedtime) continue;
    const m = onsetMin(d);
    const { gateStart, gateEnd } = d.bedtime;
    const i = m < gateStart - 30 ? 0 : m <= gateEnd + 30 ? 1 : m <= gateEnd + 90 ? 2 : 3;
    groups[i].ds.push(d);
  }
  const keys = ["sleep", "asleep", "hrv", "alert", "felt"];
  tableCard(view, parent, {
    title: "Bedtime vs. sleep",
    sub: "Nights by when you fell asleep, relative to the sleep gate of your body clock (Polar SleepWise): sleep and HRV vs. your normal, the day's alertness and how you felt",
    columns: [
      { label: "Fell asleep", get: (g) => g.label },
      { label: "Nights", get: (g) => g.ds.length, num: true },
      ...outcomeColumns(keys, (g, o) => meanCell(g.ds, o)),
    ],
    rows: groups.some((g) => g.ds.length) ? groups : [],
    empty: "No nights with a body-clock bedtime yet (Polar SleepWise, from Oct 2026).",
    notes: [NOISE_NOTE],
  });
}

// ---------- 5. how you feel vs. the measurements

export function feelingCard(view, parent, { days }) {
  const felt = days.filter((d) => d.felt != null);
  const groups = [
    { label: "Unfit (1–2)", ds: felt.filter((d) => d.felt <= 2) },
    { label: "Normal (3)", ds: felt.filter((d) => d.felt === 3) },
    { label: "Good (4–5)", ds: felt.filter((d) => d.felt >= 4) },
  ];
  const keys = ["recharge", "ans", "hrv", "alert", "sleep"];
  const links = keys.map((k) => {
    const o = OUTCOMES[k];
    const pairs = felt.map((d) => [d.felt, o.get(d)]).filter(([, y]) => y != null);
    const r = pearson(pairs);
    return r == null ? null : `${o.label} ${strength(r)} (r ${r.toFixed(2)}, ${pairs.length} days)`;
  }).filter(Boolean);
  const goodButLow = felt.filter((d) => d.felt >= 4 && d.recharge != null && d.recharge <= 3).length;
  const badButGood = felt.filter((d) => d.felt <= 2 && d.recharge != null && d.recharge >= 5).length;
  const withRecharge = felt.filter((d) => d.recharge != null).length;
  tableCard(view, parent, {
    title: "How you feel vs. the numbers",
    sub: "Perceived fitness from the check-in against the same morning's measurements",
    columns: [
      { label: "You felt", get: (g) => g.label },
      { label: "Days", get: (g) => g.ds.length, num: true },
      ...outcomeColumns(keys, (g, o) => meanCell(g.ds, o)),
    ],
    rows: felt.length ? groups : [],
    wide: false, // beside "By week" in Summary
    empty: "No perceived-fitness answers yet (Today page).",
    notes: [
      links.length ? `How closely your feeling follows: ${links.join(" · ")}.` : "Links appear from 10 days with both values.",
      withRecharge ? `Mismatches: ${goodButLow} of ${withRecharge} days you felt good after a compromised or worse Nightly Recharge; ${badButGood} days you felt unfit after a good one.` : null,
      "If your feeling and the numbers agree, either one is enough on a given morning. If they often disagree, the mismatch is worth noticing (e.g. feeling fine while recovery is low).",
    ],
  });
}

// ---------- 6. morning readiness vs. strength progress

const READINESS = [
  { label: "Good", id: "good" },
  { label: "OK", id: "ok" },
  { label: "Low", id: "low" },
  { label: "Not measured", id: null },
];
const readinessOf = (d) => {
  if (d?.recharge != null) return d.recharge >= 5 ? "good" : d.recharge === 4 ? "ok" : "low";
  if (d?.recovery != null) return d.recovery >= 67 ? "good" : d.recovery >= 34 ? "ok" : "low";
  return null;
};
export function readinessStrengthCard(view, parent, { days, log }) {
  const health = new Map(days.map((d) => [d.date, d]));
  const byExercise = new Map();
  for (const s of log?.sessions ?? []) byExercise.set(s.exercise, [...(byExercise.get(s.exercise) ?? []), s]);
  const groups = READINESS.map((r) => ({ ...r, changes: [] }));
  for (const sessions of byExercise.values()) {
    const metric = progressMetric(sessions);
    for (let i = 1; i < sessions.length; i++) {
      const prev = metric.value(sessions[i - 1]), cur = metric.value(sessions[i]);
      if (!(prev > 0)) continue;
      const id = readinessOf(health.get(sessions[i].date));
      groups.find((g) => g.id === id).changes.push(((cur - prev) / prev) * 100);
    }
  }
  const rows = groups.filter((g) => g.changes.length);
  const share = (g, test) => `${Math.round((g.changes.filter(test).length / g.changes.length) * 100)}%`;
  tableCard(view, parent, {
    title: "Readiness vs. strength",
    sub: "Each logged exercise against its previous session, by that morning's Nightly Recharge (or WHOOP recovery)",
    columns: [
      { label: "Readiness", get: (g) => g.label },
      { label: "Sessions", get: (g) => g.changes.length, num: true },
      {
        label: "Avg change", num: true,
        get: (g) => {
          if (g.changes.length < MIN_N) return null;
          const m = mean(g.changes);
          return { text: signed(m, 1, "%"), cls: Math.abs(m) < 1 ? "" : m > 0 ? "good" : "bad" };
        },
      },
      { label: "Better", get: (g) => (g.changes.length < MIN_N ? null : share(g, (c) => c > 0.5)), num: true },
      { label: "Same", get: (g) => (g.changes.length < MIN_N ? null : share(g, (c) => Math.abs(c) <= 0.5)), num: true },
      { label: "Worse", get: (g) => (g.changes.length < MIN_N ? null : share(g, (c) => c < -0.5)), num: true },
    ],
    rows,
    empty: "Needs exercises logged at least twice.",
    notes: [
      "Good = Nightly Recharge good or very good (WHOOP: recovery ≥ 67%); OK = OK (34–66%); Low = compromised or worse (< 34%).",
      "Change: estimated 1-rep max for exercises with weight, best set's reps for bodyweight ones. Progress over time also raises the numbers, so compare the rows with each other. " + NOISE_NOTE,
    ],
  });
}

// ---------- 7. supplement protocol periods

export function supplementCard(view, parent, { days, journal, today }) {
  const versions = [...(journal?.supplements?.versions ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  if (!versions.length) return;
  const keys = ["hrv", "rhr", "sleep", "ans", "felt"];
  const raw = {
    hrv: { label: "HRV ms", get: (d) => d.hrv, show: (v) => `${Math.round(v)}` },
    rhr: { label: "RHR bpm", get: (d) => d.rhr, show: (v) => v.toFixed(1) },
    sleep: { label: "Sleep score", get: (d) => ((d.source ?? "whoop") === "polar" ? d.sleep?.score : d.sleep?.performance) ?? null, show: (v) => `${Math.round(v)}` },
    ans: { ...OUTCOMES.ans, absolute: true },
    felt: OUTCOMES.felt,
  };
  const rows = [];
  versions.forEach((v, i) => {
    const to = versions[i + 1] ? shift(versions[i + 1].from, -1) : today;
    const ds = days.filter((d) => d.date >= v.from && d.date <= to);
    for (const source of ["whoop", "polar"]) {
      const mine = ds.filter((d) => (d.source ?? "whoop") === source && (d.hrv != null || d.felt != null));
      if (mine.length) rows.push({ v, to, source, ds: mine });
    }
    if (!rows.some((r) => r.v === v)) rows.push({ v, to, source: null, ds: [] });
  });
  // the first protocol in full, later ones as what changed (e.g. "Lasea 1 → 2 capsule(s)")
  const items = (v) => {
    const i = versions.indexOf(v);
    if (!i) return v.items.length ? v.items.map(describeItem).join(", ") : "none";
    const before = new Map(versions[i - 1].items.map((x) => [x.name, x]));
    const now = new Map(v.items.map((x) => [x.name, x]));
    const changes = [
      ...v.items.filter((x) => !before.has(x.name)).map((x) => `+ ${describeItem(x)}`),
      ...versions[i - 1].items.filter((x) => !now.has(x.name)).map((x) => `− ${x.name}`),
      ...v.items.filter((x) => before.has(x.name) && describeItem(x) !== describeItem(before.get(x.name)))
        .map((x) => `${x.name} ${before.get(x.name).dose ?? ""} → ${describeItem(x).slice(x.name.length + 1)}`),
    ];
    return changes.length ? changes.join(", ") : "no change";
  };
  const cell = (r, o) => {
    const vals = valuesOf(r.ds, o);
    return vals.length < MIN_N ? null : o.show(mean(vals));
  };
  tableCard(view, parent, {
    title: "Supplement protocols",
    sub: "Averages per protocol period (raw values, per device). Skipped doses are in Journal vs. recovery (\"Took …?\")",
    columns: [
      { label: "Protocol", get: (r) => `${r.v.from} – ${r.to === today ? "today" : r.to}: ${items(r.v)}` },
      { label: "Device", get: (r) => (r.source === "polar" ? "Polar" : r.source === "whoop" ? "WHOOP" : null) },
      { label: "Days", get: (r) => r.ds.length, num: true },
      ...keys.map((k) => ({ label: raw[k].label, get: (r) => cell(r, raw[k]), num: true })),
    ],
    rows,
    empty: "",
    notes: [
      versions.length < 2 ? "One protocol so far: this row is the baseline to compare the next change with." : null,
      "Other things change between periods too (season, training, sleep), so read differences as hints. Change one supplement at a time to learn the most.",
    ],
  });
}
