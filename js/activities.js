// Activities (data/sports.js), shown in two places: sports under Exercise > Training > Other activities, resting
// sessions (TENS, meditation) on the Recover page; one ActivityView each. Combined from these places:
//   - logged by hand or recorded with Start/Stop (training-log activities), joined with the tracker workout that
//     overlaps them in time;
//   - tracker workouts that already name the sport (WHOOP "Skateboarding", Polar "Running", ...);
//   (tracker workouts without a sport, e.g. old Loop detections "Other indoor", are not listed: automatic
//   detection is off and the activity is never inferred)
// joinLog() is shared with the Health view, which lists manual workouts and activities with their tracker data.
import { normalizeLog, newId, localNow, activeActivities } from "./training-log.js";
import { trackerEnd } from "./workouts.js";
import { SPORTS, sportById, sportOfTracker } from "./data/sports.js";

const MIN = 60000;
const DAY = 86400000;
const TOLERANCE = 15 * MIN;
const SUMMARY_DAYS = 30;
const LIST_LENGTH = 20;
const STARTED_KEY = "fa.activityStartedAt"; // { id: ms } exact start of a recording (the log keeps minutes)
const AUTO_KEY = "fa.activityAutoStop"; // { sport: minutes } last auto-stop chosen per activity on this device (0 = off)
const AUTO_CHOICES = [0, 10, 15, 20, 30, 45, 60, 90, 120];

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
 * All activities, newest first: [{ id?, sport, start, end, tracker?, auto? }] (auto = from a tracker workout
 * that names the sport, not in the log).
 */
export function combineActivities(log, trackerWorkouts) {
  const { activities: logged, free } = joinLog(log, trackerWorkouts);
  const auto = [];
  for (const t of free) {
    const sport = sportOfTracker(t.activity);
    if (sport) auto.push({ sport: sport.id, start: t.start, end: trackerEnd(t), tracker: t, auto: true });
  }
  return { activities: [...logged, ...auto].sort((a, b) => b.start.localeCompare(a.start)) };
}

const readStarted = () => { try { return JSON.parse(localStorage.getItem(STARTED_KEY)) ?? {}; } catch { return {}; } };
const writeStarted = (v) => { try { localStorage.setItem(STARTED_KEY, JSON.stringify(v)); } catch {} };
const forgetStarted = (ids) => {
  const v = readStarted();
  for (const id of ids) delete v[id];
  writeStarted(v);
};
const readAuto = () => { try { return JSON.parse(localStorage.getItem(AUTO_KEY)) ?? {}; } catch { return {}; } };
const rememberAuto = (sport, min) => { try { localStorage.setItem(AUTO_KEY, JSON.stringify({ ...readAuto(), [sport]: min })); } catch {} };
/** Auto-stop for a new recording: the last one chosen for this activity, else the activity's default. */
const autoStopFor = (sport) => readAuto()[sport] ?? sportById.get(sport)?.autoStopMin ?? 0;
/** Exact start of a running recording: this device's if it recorded it, else the log's minute. */
const startMsOf = (a, started = readStarted()) => started[a.id] ?? new Date(a.start).getTime(); // no offset: parsed as local time
/** Planned end (ms) of a recording with auto-stop, or null. */
const autoStopMs = (a, started) => (a.autoStopMin ? startMsOf(a, started) + a.autoStopMin * MIN : null);
const fmtClock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtElapsed = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Stop the recordings whose auto-stop time has passed, at exactly that time (also when the app was closed then).
 * Returns the new log, or null when nothing is due.
 */
export function applyAutoStops(log, now = Date.now()) {
  const started = readStarted();
  const done = new Map();
  for (const a of activeActivities(log)) {
    const due = autoStopMs(a, started);
    if (due != null && now >= due) done.set(a.id, { ...a, end: toLocal(toMs(a.start) + a.autoStopMin * MIN) });
  }
  if (!done.size) return null;
  forgetStarted([...done.keys()]);
  return normalizeLog({ ...log, activities: log.activities.map((x) => done.get(x.id) ?? x) });
}

export class ActivityView {
  /**
   * root: the #activities section; dialog: the "log activity" <dialog>. getLog/saveLog: the training log doc.
   * getTracker(): { source, workouts } or null. onShowSport({ id, sport, title } | null): show a sport's muscles.
   * describeSession(activity): optional one-line heart-rate summary of a resting session (or null).
   * sessionSpark(activity): optional small heart-rate curve (svg) for a resting session's row, or null;
   * sessionDetail(el, activity): draws its large chart into el when the row is tapped.
   * rest: true = only resting sessions (Recover page), false = only sports (Exercise).
   * banner: optional app-wide bar listing all running recordings, of both views (give it to one view only);
   * onOpen(sport): go to the view that lists that activity. The log dialog is shared by both views.
   */
  constructor(root, dialog, { rest = false, getLog, saveLog, getTracker, onShowSport, describeSession, sessionSpark, sessionDetail, banner, onOpen }) {
    Object.assign(this, { root, dialog, getLog, saveLog, getTracker, onShowSport, describeSession, sessionSpark, sessionDetail, banner, onOpen });
    this.expanded = null; // id of the resting session whose large heart-rate chart is open
    this.sports = SPORTS.filter((s) => !!s.rest === rest);
    this.selected = null; // id of the row whose muscles are shown
    this.timer = null;
    root.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("change", (e) => this.onChange(e));
    banner?.addEventListener("click", (e) => {
      const open = e.target.closest("[data-open-activities]");
      if (open) return this.onOpen?.(open.dataset.openActivities);
      this.onClick(e);
    });
    this.setupDialog();
  }

  /** An element of this view's section by its role (class "activity-<name>"). */
  part(name) { return this.root.querySelector(`.activity-${name}`); }

  /** Whether this view lists the activity. */
  owns(sport) { return this.sports.some((s) => s.id === sport); }

  onClick(e) {
    const t = e.target.closest("[data-log-activity],[data-start-pick],[data-start-sport],[data-stop-activity],[data-stop-all],[data-cancel-activity],[data-edit-activity],[data-delete-activity],[data-show-activity]");
    if (!t) return;
    const log = this.getLog();
    if (t.dataset.logActivity !== undefined) return this.openDialog();
    if (t.dataset.startPick !== undefined) {
      const pick = this.part("start-pick");
      pick.hidden = !pick.hidden;
      return;
    }
    if (t.dataset.startSport) {
      // several can run at once (TENS + meditation), but not the same activity twice
      if (activeActivities(log).some((x) => x.sport === t.dataset.startSport)) return;
      const auto = autoStopFor(t.dataset.startSport);
      const a = { id: newId(), sport: t.dataset.startSport, start: localNow(), end: null, ...(auto ? { autoStopMin: auto } : {}) };
      writeStarted({ ...readStarted(), [a.id]: Date.now() });
      this.part("start-pick").hidden = true;
      return this.saveLog(normalizeLog({ ...log, activities: [...log.activities, a] }));
    }
    if (t.dataset.stopActivity) return this.stop(log, [t.dataset.stopActivity]);
    if (t.dataset.stopAll !== undefined) return this.stop(log, activeActivities(log).map((x) => x.id));
    if (t.dataset.cancelActivity) {
      if (!confirm("Discard this recording?")) return;
      forgetStarted([t.dataset.cancelActivity]);
      return this.saveLog(normalizeLog({ ...log, activities: log.activities.filter((x) => x.id !== t.dataset.cancelActivity) }));
    }
    if (t.dataset.editActivity) {
      const a = log.activities.find((x) => x.id === t.dataset.editActivity);
      return a && this.openDialog(a);
    }
    if (t.dataset.deleteActivity) {
      const a = log.activities.find((x) => x.id === t.dataset.deleteActivity);
      if (!a || !confirm(`Delete ${nameOf(a.sport)} on ${fmtDay(a.start)}?`)) return;
      if (this.selected === a.id) this.select(null);
      return this.saveLog(normalizeLog({ ...log, activities: log.activities.filter((x) => x.id !== a.id) }));
    }
    if (t.dataset.showActivity) {
      const row = this.rows.get(t.dataset.showActivity);
      if (sportById.get(row?.sport)?.rest) {
        // no muscles to show: a session with heart rate opens its large chart instead
        if (!t.classList.contains("has-hr")) return;
        this.expanded = this.expanded === t.dataset.showActivity ? null : t.dataset.showActivity;
        return this.render();
      }
      this.select(this.selected === t.dataset.showActivity ? null : t.dataset.showActivity, row);
    }
  }

  /** Auto-stop picker of a running recording: store it on the recording and remember it for this activity. */
  onChange(e) {
    const t = e.target.closest("[data-auto-stop]");
    if (!t) return;
    const log = this.getLog();
    const a = log.activities.find((x) => x.id === t.dataset.autoStop && !x.end);
    if (!a) return;
    const min = Number(t.value);
    rememberAuto(a.sport, min);
    const { autoStopMin, ...rest } = a;
    const next = min ? { ...rest, autoStopMin: min } : rest;
    const doc = normalizeLog({ ...log, activities: log.activities.map((x) => (x.id === a.id ? next : x)) });
    // a time already passed (e.g. 15 min chosen after 20): stops right away, at the chosen time
    this.saveLog(applyAutoStops(doc) ?? doc);
  }

  /** Save the recordings that are due to stop by themselves; true when something stopped. */
  checkAutoStops() {
    const doc = applyAutoStops(this.getLog());
    if (!doc) return false;
    try { navigator.vibrate?.(300); } catch {}
    this.saveLog(doc);
    return true;
  }

  /** Stop the given recordings (one, or all at once) in a single save. */
  stop(log, ids) {
    const started = readStarted();
    const done = new Map();
    for (const id of ids) {
      const a = log.activities.find((x) => x.id === id && !x.end);
      if (!a) continue;
      // at least one minute (the log keeps minutes); exact start from this device if it recorded it
      const startMs = started[id] ?? new Date(a.start).getTime(); // no offset: parsed as local time (toMs is wall-clock "UTC")
      const minutes = Math.max(1, Math.round((Date.now() - startMs) / MIN));
      done.set(id, { ...a, end: toLocal(toMs(a.start) + minutes * MIN) });
    }
    if (!done.size) return;
    forgetStarted([...done.keys()]);
    this.saveLog(normalizeLog({ ...log, activities: log.activities.map((x) => done.get(x.id) ?? x) }));
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

  /** Start and end from the dialog's fields; an end before the start means the next day (overnight). */
  dialogTimes() {
    const v = (name) => this.dialog.querySelector(`[name=${name}]`).value;
    if (!v("date") || !v("time")) return null;
    const start = `${v("date")}T${v("time")}`;
    if (this.editing && !this.editing.end) return { start, end: null }; // still recording: only the start
    if (!v("endTime")) return null;
    let endMs = toMs(`${v("date")}T${v("endTime")}`);
    if (endMs <= toMs(start)) endMs += DAY;
    return { start, end: toLocal(endMs) };
  }

  /** Once per dialog (both views share it); its handlers act for the view that opened it (dialog.owner). */
  setupDialog() {
    const d = this.dialog;
    if (d.dataset.ready) return;
    d.dataset.ready = "1";
    d.querySelector("#activity-cancel").addEventListener("click", () => d.close());
    const showDuration = () => {
      const t = d.owner.dialogTimes();
      d.querySelector("#activity-duration").textContent = t?.end ? `Duration: ${fmtDuration((toMs(t.end) - toMs(t.start)) / MIN)}` : "";
    };
    d.querySelector("form").addEventListener("input", showDuration);
    d.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const self = d.owner;
      const times = self.dialogTimes();
      if (!times) {
        d.querySelector("#activity-error").textContent = "Enter date, start and end time.";
        return;
      }
      const log = self.getLog();
      const sport = d.querySelector("[name=sport]").value;
      const old = self.editing;
      if (old) {
        if (!old.end && toMs(times.start) > toMs(localNow())) {
          d.querySelector("#activity-error").textContent = "The start can't be in the future.";
          return;
        }
        forgetStarted([old.id]); // the edited start replaces this device's exact start
        const a = { ...old, sport, ...times };
        self.saveLog(normalizeLog({ ...log, activities: log.activities.map((x) => (x.id === old.id ? a : x)) }));
      } else {
        self.saveLog(normalizeLog({ ...log, activities: [...log.activities, { id: newId(), sport, ...times }] }));
      }
      d.close();
    });
    d.showDuration = showDuration;
  }

  /** New entry (an hour, just finished) or, with an activity, edit its sport and times. */
  openDialog(activity = null) {
    const d = this.dialog;
    d.owner = this;
    this.editing = activity;
    const running = activity && !activity.end;
    // only this view's activities (an entry being edited keeps its own, even from the other kind)
    const choices = activity && !this.owns(activity.sport) ? [...this.sports, sportById.get(activity.sport)].filter(Boolean) : this.sports;
    d.querySelector("[name=sport]").replaceChildren(...choices.map((s) => el("option", { value: s.id, textContent: s.name })));
    const start = activity?.start ?? toLocal(toMs(localNow()) - 60 * MIN);
    const end = activity?.end ?? localNow();
    const noun = this.sports.every((s) => s.rest) ? "session" : "activity";
    d.querySelector("#activity-dialog-title").textContent = activity ? (running ? "Edit start" : `Edit ${noun}`) : `Log ${noun}`;
    d.querySelector("[name=sport]").value = activity?.sport ?? this.sports[0].id;
    d.querySelector("[name=date]").value = start.slice(0, 10);
    d.querySelector("[name=time]").value = start.slice(11);
    const endField = d.querySelector("[name=endTime]");
    endField.value = end.slice(11);
    endField.required = !running;
    endField.closest("label").hidden = running;
    d.querySelector("#activity-error").textContent = "";
    d.showDuration();
    d.showModal();
  }

  // ---------- rendering

  /**
   * One block per running recording of this view (several can run together); "Stop all" when more than one runs.
   * The app banner (if this view has it) lists every running recording, sports and resting sessions.
   */
  renderRunning(all) {
    const running = all.filter((a) => this.owns(a.sport));
    const bar = this.part("running");
    clearInterval(this.timer);
    bar.hidden = !running.length;
    if (this.banner) {
      this.banner.hidden = !all.length;
      if (!all.length) this.banner.replaceChildren();
    }
    if (!running.length) bar.replaceChildren();
    if (!running.length && !(this.banner && all.length)) return;
    const started = readStarted();
    const clocks = new Map(all.map((a) => [a.id, { els: [], startMs: startMsOf(a, started) }]));
    const clock = (a, className) => {
      const e = el("strong", { className });
      clocks.get(a.id).els.push(e);
      return e;
    };
    const stopsAt = (a) => (a.autoStopMin ? ` · stops ${fmtClock(autoStopMs(a, started))}` : "");
    const picker = (a) => {
      const now = a.autoStopMin ?? 0;
      const choices = AUTO_CHOICES.includes(now) ? AUTO_CHOICES : [...AUTO_CHOICES, now].sort((x, y) => x - y);
      return el("label", { className: "auto-stop" }, "Stop after ",
        el("select", { dataset: { autoStop: a.id }, ariaLabel: "Stop automatically after" },
          ...choices.map((m) => el("option", { value: String(m), textContent: m ? fmtDuration(m) : "off", selected: m === now }))));
    };
    if (running.length) bar.replaceChildren(
      ...running.map((a) => el("div", { className: "activity-run" },
        el("div", { className: "workout-head" },
          el("span", { className: "workout-live", textContent: `${nameOf(a.sport)} · since ${a.start.slice(11)}${stopsAt(a)}` }),
          clock(a, "activity-elapsed")),
        el("div", { className: "workout-actions" },
          picker(a),
          el("button", { type: "button", className: "primary-btn", dataset: { stopActivity: a.id }, textContent: "■ Stop" }),
          el("button", { type: "button", className: "ghost small", dataset: { editActivity: a.id }, textContent: "Edit start" }),
          el("button", { type: "button", className: "ghost small", dataset: { cancelActivity: a.id }, textContent: "Discard" })))),
      ...(running.length > 1 ? [el("div", { className: "workout-actions" },
        el("button", { type: "button", className: "primary-btn", dataset: { stopAll: "" }, textContent: "■ Stop all" }))] : []));
    if (this.banner && all.length) this.banner.replaceChildren(
      ...all.map((a) => el("div", { className: "running-item" },
        el("button", { type: "button", className: "running-open", dataset: { openActivities: a.sport },
          title: sportById.get(a.sport)?.rest ? "Open Recover" : "Open Other activities" },
          el("span", { className: "workout-live", textContent: `${sportById.get(a.sport)?.short ?? nameOf(a.sport)}${stopsAt(a)}` }),
          clock(a, "running-elapsed")),
        el("button", { type: "button", className: "ghost small", dataset: { stopActivity: a.id }, textContent: "■ Stop" }))));
    const tick = () => {
      if (this.checkAutoStops()) return; // saving re-renders
      for (const c of clocks.values()) {
        const text = fmtElapsed(Math.max(0, Math.floor((Date.now() - c.startMs) / 1000)));
        for (const e of c.els) e.textContent = text;
      }
    };
    tick();
    this.timer = setInterval(tick, 1000);
  }

  render() {
    if (this.checkAutoStops()) return; // stopped while the app was closed: the save renders again
    const log = this.getLog();
    const tracker = this.getTracker();
    const activities = combineActivities(log, tracker?.workouts).activities.filter((a) => this.owns(a.sport));
    this.rows = new Map();

    const running = activeActivities(log);
    this.renderRunning(running);
    // the pick stays open for a second activity; one already running can't start again
    this.part("start-pick").replaceChildren(...this.sports.map((s) =>
      el("button", { type: "button", className: "ghost small", dataset: { startSport: s.id }, textContent: s.name,
        disabled: running.some((a) => a.sport === s.id) })));

    // last 30 days per activity
    const since = toMs(localNow()) - SUMMARY_DAYS * DAY;
    const totals = new Map();
    for (const a of activities.filter((x) => toMs(x.start) >= since)) {
      const t = totals.get(a.sport) ?? { n: 0, min: 0 };
      t.n++;
      t.min += (toMs(a.end) - toMs(a.start)) / MIN;
      totals.set(a.sport, t);
    }
    this.part("summary").textContent = totals.size
      ? `Last 30 days: ${[...totals].map(([s, t]) => `${sportById.get(s)?.short ?? nameOf(s)} ${t.n}× · ${fmtDuration(t.min)}`).join(" · ")}`
      : activities.length ? "Nothing in the last 30 days." : this.sports.every((s) => s.rest) ? "Start or log a session." : "Start or log an activity.";

    const trackerLine = (t) => {
      const parts = [t.durationMin != null && `${t.durationMin} min`, t.avgHr && `HR ${t.avgHr} / ${t.maxHr}`,
        t.kcal != null && `${Math.round(t.kcal)} kcal`, t.cardioLoad != null && `load ${t.cardioLoad}`, t.strain != null && `strain ${t.strain.toFixed(1)}`].filter(Boolean);
      return el("small", { className: "tracker-match", textContent: `${t.source ?? tracker?.source ?? "Tracker"}: ${parts.join(" · ")}` });
    };

    const list = this.part("list");
    let detail = null; // the open session's chart, drawn once the list is in the page
    list.replaceChildren(...activities.slice(0, LIST_LENGTH).flatMap((a) => {
      const id = a.id ?? `auto:${trackerKey(a.tracker)}`;
      this.rows.set(id, a);
      const rest = sportById.get(a.sport)?.rest;
      const minutes = (toMs(a.end) - toMs(a.start)) / MIN;
      const hr = rest ? this.describeSession?.(a) : null;
      const spark = rest ? this.sessionSpark?.(a) : null;
      const open = spark && id === this.expanded;
      const text = el("div", { className: "li-text" },
        el("span", { textContent: nameOf(a.sport) }),
        el("small", { className: "when", textContent: `${fmtDay(a.start)} · ${a.start.slice(11)}–${a.end.slice(11)} · ${fmtDuration(minutes)}` }),
        hr ? el("small", { className: "tracker-match", textContent: hr })
          : a.tracker ? trackerLine(a.tracker) : el("small", { textContent: rest ? "No heart rate yet" : "No tracker data" }));
      const li = el("li", { className: [id === this.selected || open ? "active" : "", rest ? "rest" : "", spark ? "has-hr" : ""].join(" ").trim(),
        dataset: { showActivity: id }, title: rest ? (spark ? "Show the heart rate" : "") : "Show the muscles this trains" },
        text,
        ...(spark ? [spark] : []),
        ...(a.auto ? [] : [
          el("button", { type: "button", className: "icon-btn", dataset: { editActivity: a.id }, ariaLabel: "Edit activity", title: "Edit times", textContent: "✎" }),
          el("button", { type: "button", className: "icon-btn", dataset: { deleteActivity: a.id }, ariaLabel: "Delete activity", textContent: "×" })]));
      if (!open) return [li];
      detail = { el: el("div", { className: "session-chart" }), a };
      return [li, el("li", { className: "session-detail" }, detail.el)];
    }));
    if (detail) this.sessionDetail?.(detail.el, detail.a);
    else this.expanded = null;
    const history = this.part("history");
    history.hidden = !activities.length;
    history.querySelector("summary h3").textContent = `History (${activities.length})`;
    if (this.selected && !this.rows.has(this.selected)) this.select(null);
  }
}
