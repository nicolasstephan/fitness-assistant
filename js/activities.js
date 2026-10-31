// Other activities (data/sports.js) on the Training tab, combined from three places:
//   - logged by hand or recorded with Start/Stop (training-log activities), joined with the tracker workout that
//     overlaps them in time;
//   - tracker workouts that already name the sport (WHOOP "Skateboarding", Polar "Running", ...);
//   - tracker workouts without a sport (the Loop detects "Other indoor/outdoor"): listed as unknown until
//     assigned; the activity is never inferred.
// joinLog() is shared with the Health view, which lists manual workouts and activities with their tracker data.
import { normalizeLog, newId, localNow, activeActivity } from "./training-log.js";
import { trackerEnd } from "./workouts.js";
import { SPORTS, sportById, sportOfTracker } from "./data/sports.js";

const MIN = 60000;
const DAY = 86400000;
const TOLERANCE = 15 * MIN;
const ASK_DAYS = 30; // unlabeled detections older than this are no longer asked about
const MIN_DETECTION_MIN = 10;
// tracker labels that say "some activity" without a sport; anything else (Walking, Strength Trainer, ...) is not asked
const GENERIC = new Set(["other indoor", "other outdoor", "other", "activity"]);
const LIST_LENGTH = 20;
const STARTED_KEY = "fa.activityStartedAt"; // { id: ms } exact start of a recording (the log keeps minutes)

const toMs = (local) => Date.parse(`${local}:00Z`); // local wall-clock times, compared consistently as "UTC"
const toLocal = (ms) => new Date(ms).toISOString().slice(0, 16);
const fmtDay = (local) => new Date(toMs(local)).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const fmtDuration = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min` : `${Math.round(min)} min`);
const nameOf = (id) => sportById.get(id)?.name ?? id;
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "dataset") Object.assign(e.dataset, v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
};

/** Stable key of a tracker workout (stored with labeled / ignored ones). */
export const trackerKey = (t) => `${(t.source ?? "tracker").toLowerCase()}:${t.start}`;

const overlap = (s1, e1, s2, e2) => Math.min(e1 + TOLERANCE, e2) - Math.max(s1 - TOLERANCE, s2);

/**
 * Pair the log with tracker workouts by time; each tracker workout joins at most one entry.
 * Activities first (a labeled detection by its key, else the largest overlap), then finished strength workouts.
 * Returns { activities: [{ ...a, tracker }], workouts: [{ ...w, tracker }], free: [tracker workouts left] }.
 */
export function joinLog(log, trackerWorkouts) {
  const tracker = (trackerWorkouts ?? []).filter((t) => t.start && trackerEnd(t));
  const used = new Set();
  const best = (start, end) => {
    let t = null, most = 0;
    for (const x of tracker) {
      if (used.has(trackerKey(x))) continue;
      const o = overlap(toMs(start), toMs(end), toMs(x.start), toMs(trackerEnd(x)));
      if (o > most) [t, most] = [x, o];
    }
    return t;
  };
  const take = (t) => (t && !used.has(trackerKey(t)) ? (used.add(trackerKey(t)), t) : null);
  const activities = log.activities.filter((a) => a.end).map((a) => {
    const labeled = a.tracker ? tracker.find((x) => trackerKey(x) === a.tracker) : null;
    return { ...a, tracker: take(labeled ?? best(a.start, a.end)) };
  });
  const workouts = log.workouts.filter((w) => w.end).map((w) => ({ ...w, tracker: take(best(w.start, w.end)) }));
  return { activities, workouts, free: tracker.filter((t) => !used.has(trackerKey(t))) };
}

/**
 * Workouts for the Health view, in its tracker-workout shape: manual strength workouts and activities (with the
 * tracker's heart rate, zones, kcal when one overlaps) plus the tracker workouts nobody logged. Resting sessions
 * (meditation, vagus nerve stimulation) are not workouts; the tracker workout they joined is dropped with them.
 * Each: { start, end, durationMin, activity, category?, source, manual, zones, zoneMin, avgHr, maxHr, kcal, ... }.
 */
export function combinedWorkouts(log, trackerWorkouts) {
  const { activities, workouts, free } = joinLog(log, trackerWorkouts);
  const minutes = (x) => Math.round((toMs(x.end) - toMs(x.start)) / MIN);
  const manual = (x, activity, category) => {
    const t = x.tracker;
    return {
      ...(t ?? {}), start: x.start, end: x.end, durationMin: minutes(x), activity, category, manual: true,
      source: t?.source ?? null, zones: t?.zones ?? [], zoneMin: t?.durationMin ?? null,
    };
  };
  const planName = (w) => w.name ?? log.plans.find((p) => p.id === w.planId)?.name ?? "Strength training";
  return [
    ...workouts.map((w) => manual(w, planName(w), "Strength")),
    ...activities.filter((a) => !sportById.get(a.sport)?.rest).map((a) => manual(a, nameOf(a.sport))),
    ...free.map((t) => {
      const sport = sportOfTracker(t.activity);
      return { ...t, activity: sport && !sport.rest ? sport.name : t.activity, manual: false, zoneMin: t.durationMin };
    }).filter((t) => !sportOfTracker(t.activity)?.rest),
  ].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * All activities, newest first: [{ id?, sport, start, end, tracker?, auto? }] (auto = from a tracker label,
 * not in the log), plus the unlabeled tracker workouts to ask about: [{ t, key }].
 */
export function combineActivities(log, trackerWorkouts, now = localNow()) {
  const { activities: logged, free } = joinLog(log, trackerWorkouts);
  const auto = [];
  const unlabeled = [];
  for (const t of free) {
    const sport = sportOfTracker(t.activity);
    if (sport) auto.push({ sport: sport.id, start: t.start, end: trackerEnd(t), tracker: t, auto: true });
    else if (GENERIC.has((t.activity ?? "").toLowerCase()) && !log.ignored.includes(trackerKey(t))
      && (t.durationMin ?? 0) >= MIN_DETECTION_MIN && toMs(now) - toMs(t.start) < ASK_DAYS * DAY) unlabeled.push(t);
  }
  const activities = [...logged, ...auto].sort((a, b) => b.start.localeCompare(a.start));
  const ask = unlabeled.reverse().map((t) => ({ t, key: trackerKey(t) }));
  return { activities, ask };
}

const readStarted = () => { try { return JSON.parse(localStorage.getItem(STARTED_KEY)) ?? {}; } catch { return {}; } };
const writeStarted = (v) => { try { localStorage.setItem(STARTED_KEY, JSON.stringify(v)); } catch {} };

export class ActivityView {
  /**
   * root: the #activities section; dialog: the "log activity" <dialog>. getLog/saveLog: the training log doc.
   * getTracker(): { source, workouts } or null. onShowSport({ id, sport, title } | null): show a sport's muscles.
   * describeSession(activity): optional one-line heart-rate summary of a resting session (or null).
   */
  constructor(root, dialog, { getLog, saveLog, getTracker, onShowSport, describeSession }) {
    Object.assign(this, { root, dialog, getLog, saveLog, getTracker, onShowSport, describeSession });
    this.selected = null; // id of the row whose muscles are shown
    this.timer = null;
    root.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("change", (e) => this.onAssign(e));
    this.setupDialog();
  }

  onClick(e) {
    const t = e.target.closest("[data-log-activity],[data-start-pick],[data-start-sport],[data-stop-activity],[data-cancel-activity],[data-delete-activity],[data-show-activity]");
    if (!t) return;
    const log = this.getLog();
    if (t.dataset.logActivity !== undefined) return this.openDialog();
    if (t.dataset.startPick !== undefined) {
      const pick = this.root.querySelector("#activity-start-pick");
      pick.hidden = !pick.hidden;
      return;
    }
    if (t.dataset.startSport) {
      if (activeActivity(log)) return;
      const a = { id: newId(), sport: t.dataset.startSport, start: localNow(), end: null };
      writeStarted({ [a.id]: Date.now() });
      this.root.querySelector("#activity-start-pick").hidden = true;
      return this.saveLog(normalizeLog({ ...log, activities: [...log.activities, a] }));
    }
    if (t.dataset.stopActivity) return this.stop(log, t.dataset.stopActivity);
    if (t.dataset.cancelActivity) {
      if (!confirm("Discard this recording?")) return;
      writeStarted({});
      return this.saveLog(normalizeLog({ ...log, activities: log.activities.filter((x) => x.id !== t.dataset.cancelActivity) }));
    }
    if (t.dataset.deleteActivity) {
      const a = log.activities.find((x) => x.id === t.dataset.deleteActivity);
      if (!a || !confirm(`Delete ${nameOf(a.sport)} on ${fmtDay(a.start)}?`)) return;
      if (this.selected === a.id) this.select(null);
      return this.saveLog(normalizeLog({ ...log, activities: log.activities.filter((x) => x.id !== a.id) }));
    }
    if (t.dataset.showActivity) {
      const row = this.rows.get(t.dataset.showActivity);
      if (sportById.get(row?.sport)?.rest) return; // no muscles to show
      this.select(this.selected === t.dataset.showActivity ? null : t.dataset.showActivity, row);
    }
  }

  /** "Assign activity" picker of a tracker detection: label it, or mark it as none of these. */
  onAssign(e) {
    const sel = e.target.closest("[data-assign]");
    if (!sel || !sel.value) return;
    const log = this.getLog();
    const item = this.combined.ask.find((x) => x.key === sel.dataset.assign);
    if (!item) return;
    if (sel.value === "none") return this.saveLog(normalizeLog({ ...log, ignored: [...log.ignored, item.key] }));
    const a = { id: newId(), sport: sel.value, start: item.t.start, end: trackerEnd(item.t), tracker: item.key };
    this.saveLog(normalizeLog({ ...log, activities: [...log.activities, a] }));
  }

  stop(log, id) {
    const a = log.activities.find((x) => x.id === id);
    if (!a) return;
    // at least one minute (the log keeps minutes); exact start from this device if it recorded it
    const startMs = readStarted()[id] ?? toMs(a.start);
    const minutes = Math.max(1, Math.round((Date.now() - startMs) / MIN));
    writeStarted({});
    const done = { ...a, end: toLocal(toMs(a.start) + minutes * MIN) };
    this.saveLog(normalizeLog({ ...log, activities: log.activities.map((x) => (x.id === id ? done : x)) }));
  }

  /** Highlight a row's sport on the model (null clears; also called by the app when another selection takes over). */
  select(id, row = null) {
    this.selected = id;
    this.root.querySelectorAll("[data-show-activity]").forEach((li) => li.classList.toggle("active", li.dataset.showActivity === id));
    if (id === null) return this.onShowSport?.(null);
    const sport = sportById.get(row.sport);
    const minutes = (toMs(row.end) - toMs(row.start)) / MIN;
    this.onShowSport?.({ id, sport, title: `${sport.name} · ${fmtDay(row.start)} · ${fmtDuration(minutes)}` });
  }

  // ---------- log dialog

  setupDialog() {
    const d = this.dialog;
    d.querySelector("[name=sport]").replaceChildren(...SPORTS.map((s) => el("option", { value: s.id, textContent: s.name })));
    d.querySelector("#activity-cancel").addEventListener("click", () => d.close());
    d.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = (name) => d.querySelector(`[name=${name}]`).value;
      const minutes = Math.round(Number(v("minutes")));
      if (!v("date") || !v("time") || !(minutes > 0)) {
        d.querySelector("#activity-error").textContent = "Enter date, start time and duration.";
        return;
      }
      const start = `${v("date")}T${v("time")}`;
      const log = this.getLog();
      const a = { id: newId(), sport: v("sport"), start, end: toLocal(toMs(start) + minutes * MIN) };
      this.saveLog(normalizeLog({ ...log, activities: [...log.activities, a] }));
      d.close();
    });
  }

  openDialog() {
    const d = this.dialog;
    const now = localNow();
    const start = toLocal(toMs(now) - 60 * MIN); // default: an hour, just finished
    d.querySelector("[name=date]").value = start.slice(0, 10);
    d.querySelector("[name=time]").value = start.slice(11);
    d.querySelector("[name=minutes]").value = 60;
    d.querySelector("#activity-error").textContent = "";
    d.showModal();
  }

  // ---------- rendering

  renderRunning(running) {
    const bar = this.root.querySelector("#activity-running");
    clearInterval(this.timer);
    bar.hidden = !running;
    this.root.querySelector("[data-start-pick]").disabled = !!running;
    if (!running) return bar.replaceChildren();
    const elapsed = el("strong", { className: "activity-elapsed" });
    bar.replaceChildren(
      el("div", { className: "workout-head" },
        el("span", { className: "workout-live", textContent: `${nameOf(running.sport)} · since ${running.start.slice(11)}` }),
        elapsed),
      el("div", { className: "workout-actions" },
        el("button", { type: "button", className: "primary-btn", dataset: { stopActivity: running.id }, textContent: "■ Stop" }),
        el("button", { type: "button", className: "ghost small", dataset: { cancelActivity: running.id }, textContent: "Discard" })));
    const startMs = readStarted()[running.id] ?? new Date(running.start).getTime(); // no offset: parsed as local time
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      elapsed.textContent = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    tick();
    this.timer = setInterval(tick, 1000);
  }

  render() {
    const log = this.getLog();
    const tracker = this.getTracker();
    this.combined = combineActivities(log, tracker?.workouts);
    const { activities, ask } = this.combined;
    this.rows = new Map();

    this.renderRunning(activeActivity(log));
    this.root.querySelector("#activity-start-pick").replaceChildren(...SPORTS.map((s) =>
      el("button", { type: "button", className: "ghost small", dataset: { startSport: s.id }, textContent: s.name })));

    // last 30 days per activity
    const since = toMs(localNow()) - ASK_DAYS * DAY;
    const totals = new Map();
    for (const a of activities.filter((x) => toMs(x.start) >= since)) {
      const t = totals.get(a.sport) ?? { n: 0, min: 0 };
      t.n++;
      t.min += (toMs(a.end) - toMs(a.start)) / MIN;
      totals.set(a.sport, t);
    }
    this.root.querySelector("#activity-summary").textContent = totals.size
      ? `Last 30 days: ${[...totals].map(([s, t]) => `${sportById.get(s)?.short ?? nameOf(s)} ${t.n}× · ${fmtDuration(t.min)}`).join(" · ")}`
      : activities.length ? "Nothing in the last 30 days." : "Start or log an activity, or assign what your tracker detected.";

    const trackerLine = (t) => {
      const parts = [t.durationMin != null && `${t.durationMin} min`, t.avgHr && `HR ${t.avgHr} / ${t.maxHr}`,
        t.kcal != null && `${Math.round(t.kcal)} kcal`, t.cardioLoad != null && `load ${t.cardioLoad}`, t.strain != null && `strain ${t.strain.toFixed(1)}`].filter(Boolean);
      return el("small", { className: "tracker-match", textContent: `${t.source ?? tracker?.source ?? "Tracker"}: ${parts.join(" · ")}` });
    };

    this.root.querySelector("#activity-ask").replaceChildren(...ask.map(({ t, key }) =>
      el("li", { className: "activity-ask" },
        el("div", { className: "li-text" },
          el("span", { textContent: `${fmtDay(t.start)} · ${t.start.slice(11)} · unknown activity` }),
          trackerLine(t)),
        el("select", { className: "assign", dataset: { assign: key }, ariaLabel: "Assign activity" },
          el("option", { value: "", textContent: "Assign activity…" }),
          ...SPORTS.map((s) => el("option", { value: s.id, textContent: s.name })),
          el("option", { value: "none", textContent: "None of these" })))));
    this.root.querySelector("#activity-ask-head").hidden = !ask.length;

    const list = this.root.querySelector("#activity-list");
    list.replaceChildren(...activities.slice(0, LIST_LENGTH).map((a) => {
      const id = a.id ?? `auto:${trackerKey(a.tracker)}`;
      this.rows.set(id, a);
      const rest = sportById.get(a.sport)?.rest;
      const minutes = (toMs(a.end) - toMs(a.start)) / MIN;
      const hr = rest ? this.describeSession?.(a) : null;
      const text = el("div", { className: "li-text" },
        el("span", { textContent: nameOf(a.sport) }),
        el("small", { className: "when", textContent: `${fmtDay(a.start)} · ${a.start.slice(11)}–${a.end.slice(11)} · ${fmtDuration(minutes)}` }),
        hr ? el("small", { className: "tracker-match", textContent: hr })
          : a.tracker ? trackerLine(a.tracker) : el("small", { textContent: rest ? "No heart rate yet" : "No tracker data" }));
      return el("li", { className: [id === this.selected ? "active" : "", rest ? "rest" : ""].join(" ").trim(), dataset: { showActivity: id },
        title: rest ? "" : "Show the muscles this trains" },
        text,
        ...(a.auto ? [] : [el("button", { type: "button", className: "icon-btn", dataset: { deleteActivity: a.id }, ariaLabel: "Delete activity", textContent: "×" })]));
    }));
    const history = this.root.querySelector("#activity-history");
    history.hidden = !activities.length;
    history.querySelector("summary h3").textContent = `History (${activities.length})`;
    if (this.selected && !this.rows.has(this.selected)) this.select(null);
  }
}
