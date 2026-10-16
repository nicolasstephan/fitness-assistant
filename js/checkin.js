// Daily check-in: alcohol, late caffeine, stress, perceived fitness, body weight.
// Stored as journal.json in the private data repo:
//   { version, days: { "YYYY-MM-DD": entry }, supplements: { versions } }   (see supplements.js)
import { lineChart } from "./charts.js";
import { normalizeSupplements, mergeSupplements, versionOn, describeItem } from "./supplements.js";

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const shift = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const fmtDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

// Perceived fitness: how well and active you feel (brain fog and tiredness low, active and motivated high)
const FITNESS_ANCHORS = { 1: "1 · Brain fog, exhausted", 2: "2 · Tired, sluggish", 3: "3 · Normal", 4: "4 · Good, active", 5: "5 · Sharp, motivated" };

// ---------- data

function normalizeEntry(e) {
  if (!e || typeof e !== "object") return null;
  const out = {};
  for (const k of ["alcohol", "lateCaffeine"]) if (typeof e[k] === "boolean") out[k] = e[k];
  for (const k of ["stress", "fitness"]) if (Number.isInteger(e[k]) && e[k] >= 1 && e[k] <= 5) out[k] = e[k];
  if (Number.isFinite(e.weightKg) && e.weightKg > 20 && e.weightKg < 400) out.weightKg = Math.round(e.weightKg * 10) / 10;
  if (Array.isArray(e.skipped)) {
    const skipped = [...new Set(e.skipped.filter((n) => typeof n === "string" && n.trim()))];
    if (skipped.length) out.skipped = skipped;
  }
  return Object.keys(out).length ? out : null;
}

export function normalizeJournal(raw) {
  const days = {};
  for (const [date, e] of Object.entries(raw?.days ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const n = DATE_RE.test(date) && normalizeEntry(e);
    if (n) days[date] = n;
  }
  return { version: 1, days, supplements: normalizeSupplements(raw?.supplements) };
}

/** Field-level merge per day; local values win. */
export function mergeJournals(remote, local) {
  const days = { ...remote.days };
  for (const [date, e] of Object.entries(local.days)) days[date] = { ...days[date], ...e };
  return normalizeJournal({ days, supplements: mergeSupplements(remote.supplements, local.supplements) });
}

/**
 * Supplements as yes/no questions ("Took creatine?", same wording as the WHOOP journal), for the
 * journal-vs-recovery analysis. `protocol` is that day's version: each item counts as taken unless skipped.
 * These are assumptions, so real answers (WHOOP journal) should override them.
 */
export function supplementQuestions(e, protocol) {
  const q = {};
  for (const item of protocol?.items ?? []) q[`Took ${item.name.toLowerCase()}?`] = !(e?.skipped ?? []).includes(item.name);
  return q;
}

/** Check-in answers phrased as yes/no journal questions, for the "journal vs. recovery" analysis. */
export function checkinQuestions(e) {
  const q = {};
  if (!e) return q;
  if (e.alcohol != null) q["Have any alcoholic drinks?"] = e.alcohol; // same wording as the WHOOP journal
  if (e.lateCaffeine != null) q["Caffeine after 2 pm?"] = e.lateCaffeine;
  if (e.stress != null) q["High stress (4–5)?"] = e.stress >= 4;
  if (e.fitness != null) q["Felt unfit: tired or foggy (1–2)?"] = e.fitness <= 2;
  return q;
}

// ---------- view

export class CheckinView {
  constructor(root, { getJournal, saveJournal, editProtocol }) {
    this.root = root;
    this.getJournal = getJournal;
    this.saveJournal = saveJournal;
    root.querySelector("#supp-edit").addEventListener("click", editProtocol);
    root.querySelector("#supp-today").addEventListener("click", (e) => {
      const name = e.target.closest("[data-supp]")?.dataset.supp;
      if (!name) return;
      const skipped = new Set(this.entry().skipped ?? []);
      skipped.has(name) ? skipped.delete(name) : skipped.add(name);
      this.set("skipped", skipped.size ? [...skipped] : undefined);
    });
    this.date = localToday();

    root.querySelector("#checkin-prev").addEventListener("click", () => this.go(-1));
    root.querySelector("#checkin-next").addEventListener("click", () => this.go(1));
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-field]");
      if (!btn) return;
      const { field, value } = btn.dataset;
      const v = value === "true" ? true : value === "false" ? false : Number(value);
      // tapping the selected answer again clears it
      this.set(field, this.entry()[field] === v ? undefined : v);
    });
    const weight = root.querySelector("#checkin-weight");
    weight.addEventListener("change", () => {
      const v = parseFloat(weight.value.replace(",", "."));
      this.set("weightKg", Number.isFinite(v) ? v : undefined);
    });
    let w = 0;
    new ResizeObserver(() => {
      if (root.hidden || root.clientWidth === w) return;
      w = root.clientWidth;
      this.renderCharts();
    }).observe(root);
  }

  entry() {
    return this.getJournal().days[this.date] ?? {};
  }

  go(n) {
    const next = shift(this.date, n);
    if (next > localToday()) return;
    this.date = next;
    this.render();
  }

  set(field, value) {
    const journal = this.getJournal();
    const entry = { ...this.entry(), [field]: value };
    if (value === undefined) delete entry[field];
    this.saveJournal(normalizeJournal({ ...journal, days: { ...journal.days, [this.date]: entry } }));
  }

  render() {
    const r = this.root;
    const today = localToday();
    r.querySelector("#checkin-date").textContent = this.date === today ? "Today" : this.date === shift(today, -1) ? "Yesterday" : fmtDate(this.date);
    r.querySelector("#checkin-next").disabled = this.date >= today;
    const e = this.entry();
    r.querySelectorAll("[data-field]").forEach((b) => {
      const v = b.dataset.value === "true" ? true : b.dataset.value === "false" ? false : Number(b.dataset.value);
      b.setAttribute("aria-pressed", e[b.dataset.field] === v);
    });
    r.querySelector("#fitness-anchor").textContent = FITNESS_ANCHORS[e.fitness] ?? "How well and active do you feel?";
    const weight = r.querySelector("#checkin-weight");
    if (document.activeElement !== weight) weight.value = e.weightKg ?? "";
    this.renderSupplements(e);
    this.renderCharts();
  }

  /** The protocol for the selected day: everything counts as taken unless tapped as skipped. */
  renderSupplements(e) {
    const version = versionOn(this.getJournal().supplements, this.date);
    const list = this.root.querySelector("#supp-today");
    const items = version?.items ?? [];
    this.root.querySelector("#supp-hint").textContent = !version
      ? "No protocol yet. Set it up once; it then applies every day until you change it."
      : items.length
        ? `Protocol since ${fmtDate(version.from)}. Taken unless you tap one as skipped.`
        : `No supplements since ${fmtDate(version.from)}.`;
    const skipped = new Set(e.skipped ?? []);
    list.replaceChildren(
      ...items.map((item) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "supp-chip";
        b.dataset.supp = item.name;
        b.setAttribute("aria-pressed", !skipped.has(item.name));
        const label = document.createElement("span");
        label.textContent = `${skipped.has(item.name) ? "✕" : "✓"} ${describeItem(item)}`;
        const when = document.createElement("small");
        when.textContent = skipped.has(item.name) ? "skipped" : item.timing.toLowerCase();
        b.append(label, when);
        return b;
      }),
    );
  }

  /** Last 30 days: weight (with 7-day average), stress and perceived fitness. */
  renderCharts() {
    if (this.root.hidden) return;
    const days = this.getJournal().days;
    const end = localToday();
    const dates = Array.from({ length: 30 }, (_, i) => shift(end, i - 29));
    const series = (get) => dates.map((d) => ({ t: Date.parse(`${d}T00:00:00Z`), v: get(days[d]) ?? null }));
    const color = getComputedStyle(document.documentElement).getPropertyValue("--series-1").trim();
    const describe = (t) => fmtDate(new Date(t).toISOString().slice(0, 10));

    const weight = series((e) => e?.weightKg);
    const weightAvg = weight.map((p, i) => {
      const vals = weight.slice(Math.max(0, i - 6), i + 1).map((x) => x.v).filter((v) => v != null);
      return { t: p.t, v: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
    });
    this.chart("#checkin-weight-chart", weight, { color, describe, unit: "kg", format: (v) => v.toFixed(1), smooth: { points: weightAvg, label: "7-day average" }, baseLabel: "that day" });
    this.chart("#checkin-stress-chart", series((e) => e?.stress), { color, describe, ticks: [1, 2, 3, 4, 5], format: (v) => `${Math.round(v)}` });
    this.chart("#checkin-fitness-chart", series((e) => e?.fitness), { color, describe, ticks: [1, 2, 3, 4, 5], format: (v) => `${Math.round(v)}` });

    const answered = dates.filter((d) => days[d]?.alcohol != null);
    this.root.querySelector("#checkin-alcohol-summary").textContent = answered.length
      ? `Alcohol on ${answered.filter((d) => days[d].alcohol).length} of ${answered.length} answered days`
      : "";
  }

  chart(sel, points, opts) {
    const el = this.root.querySelector(sel);
    const has = points.filter((p) => p.v != null).length;
    el.closest(".checkin-chart").hidden = has < 2;
    if (has >= 2) lineChart(el, points, { height: 110, ...opts });
  }
}
