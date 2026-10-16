// Strength training log, stored as training-log.json in the private data repo:
//   plans:    [{ id, name, items: [{ exercise, sets: [{ reps, kg }] }] }]   workout templates, one target per set
//   workouts: [{ id, start, end, planId?, name? }]   timed workouts ("YYYY-MM-DDTHH:MM" local time; end null while running)
//   sessions: [{ id, date, exercise, sets: [{ reps, kg, i? }], workoutId?, time? }]   one per exercise
//             (i = index of the planned set it ticks off)
import { lineChart } from "./charts.js";

const DAY = 86400000;

// ---------- data

const num = (v) => (Number.isFinite(+v) && +v >= 0 ? +v : 0);

const LOCAL_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function normalizeSession(s) {
  if (!s || typeof s.exercise !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.date ?? "")) return null;
  const sets = (Array.isArray(s.sets) ? s.sets : [])
    .map((x) => ({ reps: Math.round(num(x?.reps)), kg: num(x?.kg), ...(Number.isInteger(x?.i) && x.i >= 0 ? { i: x.i } : {}) }))
    .filter((x) => x.reps > 0);
  if (!sets.length) return null;
  const out = { id: String(s.id ?? `${s.date}-${Math.random().toString(36).slice(2)}`), date: s.date, exercise: s.exercise, sets };
  if (typeof s.workoutId === "string") out.workoutId = s.workoutId;
  if (/^\d{2}:\d{2}$/.test(s.time ?? "")) out.time = s.time;
  return out;
}

function normalizeWorkout(w) {
  if (!w || typeof w.id !== "string" || !LOCAL_TIME_RE.test(w.start ?? "")) return null;
  const out = { id: w.id, start: w.start, end: LOCAL_TIME_RE.test(w.end ?? "") && w.end >= w.start ? w.end : null };
  if (typeof w.planId === "string") out.planId = w.planId;
  if (typeof w.name === "string" && w.name.trim()) out.name = w.name.trim().slice(0, 60);
  return out;
}

function normalizePlan(p) {
  if (!p || typeof p.id !== "string") return null;
  const set = (x) => ({ reps: Math.max(1, Math.round(num(x?.reps)) || 1), kg: num(x?.kg) });
  const items = (Array.isArray(p.items) ? p.items : [])
    .filter((x) => typeof x?.exercise === "string")
    .map((x) => ({
      exercise: x.exercise,
      // older plans stored "sets × reps @ kg"; expand them to identical sets
      sets: (Array.isArray(x.sets)
        ? x.sets.map(set)
        : Array.from({ length: Math.max(1, Math.round(num(x.sets)) || 1) }, () => set(x))).slice(0, 20),
    }))
    .filter((x) => x.sets.length);
  const name = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 60) : "Workout";
  return { id: p.id, name, items };
}

export function normalizeLog(raw) {
  const sessions = (Array.isArray(raw?.sessions) ? raw.sessions : []).map(normalizeSession).filter(Boolean);
  sessions.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.id.localeCompare(b.id));
  const workouts = (Array.isArray(raw?.workouts) ? raw.workouts : []).map(normalizeWorkout).filter(Boolean);
  workouts.sort((a, b) => a.start.localeCompare(b.start));
  const plans = (Array.isArray(raw?.plans) ? raw.plans : []).map(normalizePlan).filter(Boolean);
  return { version: 2, plans, workouts, sessions };
}

/** Union by id (plans, workouts, sessions); the local copy wins for the same id. */
export function mergeLogs(remote, local) {
  const union = (a, b) => {
    const byId = new Map(a.map((x) => [x.id, x]));
    for (const x of b) byId.set(x.id, x);
    return [...byId.values()];
  };
  return normalizeLog({
    plans: union(remote.plans, local.plans),
    workouts: union(remote.workouts, local.workouts),
    sessions: union(remote.sessions, local.sessions),
  });
}

/** Local wall-clock time as "YYYY-MM-DDTHH:MM". */
export function localNow() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const activeWorkout = (log) => log.workouts.find((w) => !w.end) ?? null;

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---------- progress metric

/** Estimated one-rep max (Epley); only meaningful with weight. */
const e1rm = (kg, reps) => kg * (1 + reps / 30);

/**
 * Progress metric for an exercise's sessions: estimated 1RM of the extra weight when any set
 * used weight, otherwise the best set's reps (bodyweight exercises).
 */
export function progressMetric(sessions) {
  const weighted = sessions.some((s) => s.sets.some((x) => x.kg > 0));
  return weighted
    ? { label: "Estimated 1-rep max", unit: "kg", value: (s) => Math.max(...s.sets.map((x) => e1rm(x.kg, x.reps))), format: (v) => v.toFixed(1) }
    : { label: "Best set", unit: "reps", value: (s) => Math.max(...s.sets.map((x) => x.reps)), format: (v) => `${Math.round(v)}` };
}

export function describeSets(sets) {
  const allSame = sets.every((x) => x.reps === sets[0].reps && x.kg === sets[0].kg);
  const one = (x) => `${x.reps}${x.kg ? ` × ${x.kg} kg` : ""}`;
  if (allSame && sets.length > 1) return `${sets.length} × ${sets[0].reps}${sets[0].kg ? ` @ ${sets[0].kg} kg` : ""}`;
  return sets.map(one).join(", ");
}

const fmtDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// ---------- dialog

export class LogDialog {
  /** getLog() -> current log doc; saveLog(doc) persists it. */
  constructor(dialog, { getLog, saveLog }) {
    this.dialog = dialog;
    this.getLog = getLog;
    this.workout = null; // running workout while the dialog is open
    this.saveLog = saveLog;
    this.exercise = null;

    dialog.querySelector("#log-add-set").addEventListener("click", () => {
      const rows = this.setRows();
      const last = rows.at(-1);
      this.addSetRow(last ? { reps: last.reps.value, kg: last.kg.value } : {});
    });
    dialog.querySelector("#log-sets").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-set]");
      if (!btn) return;
      btn.closest(".set-row").remove();
      this.renumber();
    });
    dialog.querySelector("#log-history").addEventListener("click", (e) => {
      const id = e.target.closest("[data-delete-session]")?.dataset.deleteSession;
      if (!id || !confirm("Delete this session?")) return;
      const log = this.getLog();
      this.saveLog({ ...log, sessions: log.sessions.filter((s) => s.id !== id) });
      this.renderHistory();
    });
    dialog.querySelector("#log-cancel").addEventListener("click", () => dialog.close());
    dialog.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const sets = this.setRows()
        .map((r) => ({ reps: Math.round(num(r.reps.value)), kg: num(r.kg.value) }))
        .filter((x) => x.reps > 0);
      const error = dialog.querySelector("#log-error");
      if (!sets.length) {
        error.textContent = "Enter the reps of at least one set.";
        return;
      }
      const log = this.getLog();
      const session = { id: newId(), date: dialog.querySelector("[name=date]").value || today(), exercise: this.exercise.id, sets };
      if (this.workout) {
        session.date = this.workout.start.slice(0, 10);
        session.workoutId = this.workout.id;
        session.time = localNow().slice(11);
      }
      this.saveLog(normalizeLog({ ...log, sessions: [...log.sessions, session] }));
      dialog.close();
    });
  }

  open(exercise) {
    this.exercise = exercise;
    const d = this.dialog;
    d.querySelector("#log-title").textContent = exercise.name;
    this.workout = activeWorkout(this.getLog());
    const date = d.querySelector("[name=date]");
    date.value = this.workout ? this.workout.start.slice(0, 10) : today();
    date.disabled = !!this.workout;
    d.querySelector("#log-workout-note").hidden = !this.workout;
    d.querySelector("#log-workout-note").textContent = this.workout
      ? `Adds to the workout started at ${this.workout.start.slice(11)}.`
      : "";
    d.querySelector("#log-error").textContent = "";
    d.querySelector("#log-sets").replaceChildren();
    // prefill with the last session's sets: the usual starting point
    const last = this.sessions().at(-1);
    (last ? last.sets : [{}]).forEach((s) => this.addSetRow(s));
    d.showModal();
    this.renderHistory();
  }

  sessions() {
    return this.getLog().sessions.filter((s) => s.exercise === this.exercise.id);
  }

  setRows() {
    return [...this.dialog.querySelectorAll(".set-row")].map((row) => ({ row, reps: row.querySelector("[name=reps]"), kg: row.querySelector("[name=kg]") }));
  }

  addSetRow({ reps = "", kg = "" } = {}) {
    const row = document.createElement("div");
    row.className = "set-row";
    row.innerHTML = `<span class="set-no"></span>
      <label>Reps<input name="reps" type="number" inputmode="numeric" min="1" step="1"></label>
      <label>Weight kg<input name="kg" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0"></label>
      <button type="button" class="icon-btn" data-remove-set aria-label="Remove set">×</button>`;
    row.querySelector("[name=reps]").value = reps;
    row.querySelector("[name=kg]").value = kg || "";
    this.dialog.querySelector("#log-sets").appendChild(row);
    this.renumber();
  }

  renumber() {
    this.setRows().forEach((r, i) => (r.row.querySelector(".set-no").textContent = `Set ${i + 1}`));
  }

  renderHistory() {
    const sessions = this.sessions();
    const chartEl = this.dialog.querySelector("#log-chart");
    const summary = this.dialog.querySelector("#log-summary");
    const list = this.dialog.querySelector("#log-history");

    if (!sessions.length) {
      summary.textContent = "No sessions yet. Your progress chart appears after two sessions.";
      chartEl.replaceChildren();
      list.replaceChildren();
      return;
    }
    const metric = progressMetric(sessions);
    const values = sessions.map((s) => ({ t: Date.parse(`${s.date}T00:00:00Z`), v: metric.value(s) }));
    const first = values[0].v, best = Math.max(...values.map((p) => p.v)), latest = values.at(-1).v;
    summary.textContent = `${metric.label}: latest ${metric.format(latest)} ${metric.unit} · best ${metric.format(best)} · first ${metric.format(first)} · ${sessions.length} session${sessions.length === 1 ? "" : "s"}`;

    if (sessions.length >= 2) {
      // one point per day (the best session that day)
      const byDay = new Map();
      for (const p of values) byDay.set(p.t, Math.max(byDay.get(p.t) ?? -Infinity, p.v));
      const points = [...byDay].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
      if (points.length === 1) points.unshift({ t: points[0].t - DAY, v: null });
      chartEl.hidden = false;
      lineChart(chartEl, points, {
        color: getComputedStyle(document.documentElement).getPropertyValue("--series-1").trim(),
        height: 140, unit: metric.unit, format: metric.format,
        describe: (t) => fmtDate(new Date(t).toISOString().slice(0, 10)),
      });
    } else {
      chartEl.hidden = true;
    }

    list.replaceChildren(
      ...sessions.slice(-8).reverse().map((s) => {
        const li = document.createElement("li");
        const text = document.createElement("span");
        text.textContent = `${fmtDate(s.date)} · ${describeSets(s.sets)}`;
        const del = document.createElement("button");
        del.type = "button";
        del.className = "icon-btn";
        del.dataset.deleteSession = s.id;
        del.setAttribute("aria-label", "Delete session");
        del.textContent = "×";
        li.append(text, del);
        return li;
      }),
    );
  }
}

/** Short "last session" line for the exercise list, or "". */
export function lastSessionText(log, exerciseId) {
  const s = log.sessions.filter((x) => x.exercise === exerciseId).at(-1);
  return s ? `Last: ${describeSets(s.sets)} · ${fmtDate(s.date)}` : "";
}
