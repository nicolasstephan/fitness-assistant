// Other activities (sports from data/sports.js) on the Training tab, combined from three places:
//   - logged by hand (training-log activities), joined with the tracker workout that overlaps them in time;
//   - tracker workouts that already name the sport (WHOOP "Skateboarding", Polar "Running", ...);
//   - tracker workouts without a sport (the Loop detects "Other indoor/outdoor"): listed to label with one tap,
//     with a guess from the most similar labeled sessions (average HR, duration, time of day).
import { normalizeLog, newId, localNow } from "./training-log.js";
import { trackerEnd, matchTrackerWorkout } from "./workouts.js";
import { SPORTS, sportById, sportOfTracker } from "./data/sports.js";

const MIN = 60000;
const DAY = 86400000;
const TOLERANCE = 15 * MIN;
const ASK_DAYS = 30; // unlabeled detections older than this are no longer asked about
const MIN_DETECTION_MIN = 10;
// tracker labels that say "some activity" without a sport; anything else (Walking, Strength Trainer, ...) is not asked
const GENERIC = new Set(["other indoor", "other outdoor", "other", "activity"]);
const LIST_LENGTH = 12;

const toMs = (local) => Date.parse(`${local}:00Z`); // local wall-clock times, compared consistently as "UTC"
const toLocal = (ms) => new Date(ms).toISOString().slice(0, 16);
const fmtDay = (local) => new Date(toMs(local)).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const fmtDuration = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min` : `${Math.round(min)} min`);
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
 * All activities, newest first: [{ id?, sport, start, end, tracker?, auto? }] (auto = from a tracker label,
 * not in the log), plus the unlabeled tracker workouts to ask about: [{ t, key, guess }].
 */
export function combineActivities(log, trackerWorkouts, now = localNow()) {
  const tracker = (trackerWorkouts ?? []).filter((t) => t.start && trackerEnd(t));
  const used = new Set();
  const take = (t) => (t && !used.has(trackerKey(t)) ? (used.add(trackerKey(t)), t) : null);

  // logged ones first: the labeled detection, else the tracker workout with the largest overlap
  const logged = log.activities.map((a) => {
    let t = a.tracker ? tracker.find((x) => trackerKey(x) === a.tracker) : null;
    if (!t) {
      let best = 0;
      for (const x of tracker) {
        if (used.has(trackerKey(x))) continue;
        const o = overlap(toMs(a.start), toMs(a.end), toMs(x.start), toMs(trackerEnd(x)));
        if (o > best) [t, best] = [x, o];
      }
    }
    return { ...a, tracker: take(t) };
  });

  // tracker workouts during a strength workout belong to that workout
  for (const w of log.workouts) take(matchTrackerWorkout(w, tracker.filter((t) => !used.has(trackerKey(t)))));

  const auto = [];
  const unlabeled = [];
  for (const t of tracker) {
    if (used.has(trackerKey(t))) continue;
    const sport = sportOfTracker(t.activity);
    if (sport) auto.push({ sport: sport.id, start: t.start, end: trackerEnd(t), tracker: t, auto: true });
    else if (GENERIC.has((t.activity ?? "").toLowerCase()) && !log.ignored.includes(trackerKey(t))
      && (t.durationMin ?? 0) >= MIN_DETECTION_MIN && toMs(now) - toMs(t.start) < ASK_DAYS * DAY) unlabeled.push(t);
  }

  const activities = [...logged, ...auto].sort((a, b) => b.start.localeCompare(a.start));
  const examples = activities.filter((a) => a.tracker?.avgHr);
  const ask = unlabeled.reverse().map((t) => ({ t, key: trackerKey(t), guess: guessSport(t, examples) }));
  return { activities, ask };
}

/**
 * Sport of the most similar labeled sessions (5 nearest by average HR, duration and time of day), or null
 * when there are too few examples or none is close.
 */
export function guessSport(t, examples) {
  if (!t.avgHr || examples.length < 3) return null;
  const hour = (local) => Number(local.slice(11, 13)) + Number(local.slice(14, 16)) / 60;
  const minutes = (a) => a.tracker.durationMin ?? (toMs(a.end) - toMs(a.start)) / MIN;
  const dist = (a) => {
    const dh = Math.abs(hour(a.start) - hour(t.start));
    return Math.abs(a.tracker.avgHr - t.avgHr) / 15
      + Math.abs(Math.log(Math.max(1, minutes(a)) / Math.max(1, t.durationMin ?? 1))) / 0.6
      + Math.min(dh, 24 - dh) / 4;
  };
  const near = examples.map((a) => ({ sport: a.sport, d: dist(a) })).sort((a, b) => a.d - b.d).slice(0, 5);
  if (near[0].d > 2.5) return null;
  const votes = new Map();
  for (const n of near) votes.set(n.sport, (votes.get(n.sport) ?? 0) + 1 / (0.3 + n.d));
  return [...votes].sort((a, b) => b[1] - a[1])[0][0];
}

export class ActivityView {
  /**
   * root: the #activities section; dialog: the "log activity" <dialog>. getLog/saveLog: the training log doc.
   * getTracker(): { source, workouts } or null. onShowSport({ id, sport, title } | null): show a sport's muscles.
   */
  constructor(root, dialog, { getLog, saveLog, getTracker, onShowSport }) {
    Object.assign(this, { root, dialog, getLog, saveLog, getTracker, onShowSport });
    this.selected = null; // id of the row whose muscles are shown
    root.addEventListener("click", (e) => this.onClick(e));
    this.setupDialog();
  }

  onClick(e) {
    const t = e.target.closest("[data-log-activity],[data-label],[data-ignore],[data-delete-activity],[data-show-activity]");
    if (!t) return;
    const log = this.getLog();
    if (t.dataset.logActivity !== undefined) return this.openDialog();
    if (t.dataset.label) {
      const item = this.combined.ask.find((x) => x.key === t.dataset.key);
      if (!item) return;
      const a = { id: newId(), sport: t.dataset.label, start: item.t.start, end: trackerEnd(item.t), tracker: item.key };
      return this.saveLog(normalizeLog({ ...log, activities: [...log.activities, a] }));
    }
    if (t.dataset.ignore) return this.saveLog(normalizeLog({ ...log, ignored: [...log.ignored, t.dataset.ignore] }));
    if (t.dataset.deleteActivity) {
      const a = log.activities.find((x) => x.id === t.dataset.deleteActivity);
      if (!a || !confirm(`Delete ${sportById.get(a.sport)?.name ?? a.sport} on ${fmtDay(a.start)}?`)) return;
      if (this.selected === a.id) this.select(null);
      return this.saveLog(normalizeLog({ ...log, activities: log.activities.filter((x) => x.id !== a.id) }));
    }
    if (t.dataset.showActivity) {
      const row = this.rows.get(t.dataset.showActivity);
      this.select(this.selected === t.dataset.showActivity ? null : t.dataset.showActivity, row);
    }
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

  render() {
    const log = this.getLog();
    const tracker = this.getTracker();
    this.combined = combineActivities(log, tracker?.workouts);
    const { activities, ask } = this.combined;
    this.rows = new Map();

    // last 30 days per sport
    const since = toMs(localNow()) - ASK_DAYS * DAY;
    const totals = new Map();
    for (const a of activities.filter((x) => toMs(x.start) >= since)) {
      const t = totals.get(a.sport) ?? { n: 0, min: 0 };
      t.n++;
      t.min += (toMs(a.end) - toMs(a.start)) / MIN;
      totals.set(a.sport, t);
    }
    this.root.querySelector("#activity-summary").textContent = totals.size
      ? `Last 30 days: ${[...totals].map(([s, t]) => `${sportById.get(s)?.name ?? s} ${t.n}× · ${fmtDuration(t.min)}`).join(" · ")}`
      : activities.length ? "Nothing in the last 30 days." : "Log boxing, skateboarding, running or surfing, or label what your tracker detected.";

    const trackerLine = (t) => {
      const parts = [t.durationMin != null && `${t.durationMin} min`, t.avgHr && `HR ${t.avgHr} / ${t.maxHr}`,
        t.kcal != null && `${Math.round(t.kcal)} kcal`, t.cardioLoad != null && `load ${t.cardioLoad}`, t.strain != null && `strain ${t.strain.toFixed(1)}`].filter(Boolean);
      return el("small", { className: "tracker-match", textContent: `${t.source ?? tracker?.source ?? "Tracker"}: ${parts.join(" · ")}` });
    };

    this.root.querySelector("#activity-ask").replaceChildren(...ask.map(({ t, key, guess }) =>
      el("li", { className: "activity-ask" },
        el("div", { className: "li-text" },
          el("span", { textContent: `${fmtDay(t.start)} · ${t.start.slice(11)} · what was it?` }),
          trackerLine(t),
          el("div", { className: "chips" },
            ...SPORTS.map((s) => el("button", {
              type: "button", className: `ghost small${s.id === guess ? " guess" : ""}`, dataset: { label: s.id, key },
              textContent: s.id === guess ? `${s.name}?` : s.name, title: s.id === guess ? "Most like your earlier sessions" : "",
            })),
            el("button", { type: "button", className: "ghost small", dataset: { ignore: key }, textContent: "None of these" }))))));

    const list = this.root.querySelector("#activity-list");
    list.replaceChildren(...activities.slice(0, LIST_LENGTH).map((a) => {
      const id = a.id ?? `auto:${trackerKey(a.tracker)}`;
      this.rows.set(id, a);
      const minutes = (toMs(a.end) - toMs(a.start)) / MIN;
      const text = el("div", { className: "li-text" },
        el("span", { textContent: sportById.get(a.sport)?.name ?? a.sport }),
        el("small", { className: "when", textContent: `${fmtDay(a.start)} · ${a.start.slice(11)}–${a.end.slice(11)} · ${fmtDuration(minutes)}` }),
        a.tracker ? trackerLine(a.tracker) : el("small", { textContent: "No tracker data" }));
      return el("li", { className: id === this.selected ? "active" : "", dataset: { showActivity: id }, title: "Show the muscles this trains" },
        text,
        ...(a.auto ? [] : [el("button", { type: "button", className: "icon-btn", dataset: { deleteActivity: a.id }, ariaLabel: "Delete activity", textContent: "×" })]));
    }));
    this.root.querySelector("#activity-ask-head").hidden = !ask.length;
    if (this.selected && !this.rows.has(this.selected)) this.select(null);
  }
}
