// Timed workouts: start/finish in the app, exercises logged while running belong to the workout.
// Finished workouts are matched with tracker workouts (WHOOP now, Polar later) by overlapping time.
import { activeWorkout, describeSets, localNow, newId, normalizeLog } from "./training-log.js";

const MIN = 60000;
const toMs = (local) => Date.parse(`${local}:00Z`); // local wall-clock times, compared consistently as "UTC"
const fmtDuration = (ms) => {
  const m = Math.max(0, Math.round(ms / MIN));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};
const fmtDay = (local) => new Date(toMs(local)).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/**
 * Tracker workout with the largest time overlap (15 min tolerance on both ends), or null.
 * trackerWorkouts: [{ start, end, activity, strain, avgHr, maxHr, kcal, durationMin }] in local time.
 */
export function matchTrackerWorkout(workout, trackerWorkouts) {
  if (!workout.end) return null;
  const s = toMs(workout.start) - 15 * MIN, e = toMs(workout.end) + 15 * MIN;
  let best = null, bestOverlap = 0;
  for (const t of trackerWorkouts ?? []) {
    if (!t.start || !t.end) continue;
    const overlap = Math.min(e, toMs(t.end)) - Math.max(s, toMs(t.start));
    if (overlap > bestOverlap) [best, bestOverlap] = [t, overlap];
  }
  return best;
}

export class WorkoutView {
  /**
   * root: container with #workout-bar and #workout-history.
   * getLog/saveLog: the training log doc. exerciseById: catalog. getTracker(): { source, workouts } or null.
   */
  constructor(root, { getLog, saveLog, exerciseById, getTracker }) {
    Object.assign(this, { root, getLog, saveLog, exerciseById, getTracker });
    this.timer = null;

    root.addEventListener("click", (e) => {
      const action = e.target.closest("[data-workout]")?.dataset.workout;
      if (!action) return;
      const log = this.getLog();
      const running = activeWorkout(log);
      if (action === "start" && !running) {
        this.saveLog(normalizeLog({ ...log, workouts: [...log.workouts, { id: newId(), start: localNow(), end: null }] }));
      } else if (action === "finish" && running) {
        this.finish(log, running, localNow());
      } else if (action === "finish-last" && running) {
        // forgot to stop: end at the last logged exercise (or 1 h after the start)
        const times = log.sessions.filter((s) => s.workoutId === running.id && s.time).map((s) => `${s.date}T${s.time}`);
        const end = times.length ? times.sort().at(-1) : new Date(toMs(running.start) + 60 * MIN).toISOString().slice(0, 16);
        this.finish(log, running, end);
      } else if (action === "cancel" && running) {
        const n = log.sessions.filter((s) => s.workoutId === running.id).length;
        if (!confirm(n ? `Discard this workout? Its ${n} logged exercise${n === 1 ? "" : "s"} stay in your log.` : "Discard this workout?")) return;
        this.saveLog(normalizeLog({
          ...log,
          workouts: log.workouts.filter((w) => w.id !== running.id),
          sessions: log.sessions.map(({ workoutId, ...s }) => (workoutId === running.id ? s : { ...s, ...(workoutId ? { workoutId } : {}) })),
        }));
      }
    });
    root.querySelector("#workout-history").addEventListener("click", (e) => {
      const id = e.target.closest("[data-delete-workout]")?.dataset.deleteWorkout;
      if (!id || !confirm("Delete this workout? Its exercises stay in your log.")) return;
      const log = this.getLog();
      this.saveLog(normalizeLog({
        ...log,
        workouts: log.workouts.filter((w) => w.id !== id),
        sessions: log.sessions.map(({ workoutId, ...s }) => (workoutId === id ? s : { ...s, ...(workoutId ? { workoutId } : {}) })),
      }));
    });
  }

  finish(log, workout, end) {
    this.saveLog(normalizeLog({ ...log, workouts: log.workouts.map((w) => (w.id === workout.id ? { ...w, end } : w)) }));
  }

  exercisesOf(log, workout) {
    return log.sessions
      .filter((s) => s.workoutId === workout.id)
      .map((s) => `${this.exerciseById.get(s.exercise)?.name ?? s.exercise} ${describeSets(s.sets)}`);
  }

  render() {
    const log = this.getLog();
    const running = activeWorkout(log);
    this.renderBar(log, running);
    this.renderHistory(log);
    clearInterval(this.timer);
    if (running) this.timer = setInterval(() => this.tick(running), 1000);
  }

  tick(running) {
    const el = this.root.querySelector("#workout-elapsed");
    if (!el) return;
    // "YYYY-MM-DDTHH:MM" without an offset parses as local time
    const s = Math.max(0, Math.floor((Date.now() - new Date(running.start).getTime()) / 1000));
    el.textContent = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  renderBar(log, running) {
    const bar = this.root.querySelector("#workout-bar");
    bar.replaceChildren();
    bar.classList.toggle("running", !!running);
    const button = (action, text, cls = "ghost small") => {
      const b = document.createElement("button");
      b.className = cls;
      b.dataset.workout = action;
      b.textContent = text;
      return b;
    };
    if (!running) {
      bar.appendChild(button("start", "▶ Start workout", "primary-btn small"));
      return;
    }
    const head = document.createElement("div");
    head.className = "workout-head";
    const label = document.createElement("span");
    label.className = "workout-live";
    label.textContent = `Workout since ${running.start.slice(11)}`;
    const elapsed = document.createElement("strong");
    elapsed.id = "workout-elapsed";
    head.append(label, elapsed);
    const actions = document.createElement("div");
    actions.className = "workout-actions";
    actions.append(button("cancel", "Discard"), button("finish", "■ Finish", "primary-btn small"));
    bar.append(head, actions);

    const hours = (Date.now() - new Date(running.start).getTime()) / 3600000;
    if (hours > 3) {
      const warn = document.createElement("p");
      warn.className = "hint";
      warn.textContent = `Running for ${Math.floor(hours)} h. Forgot to finish?`;
      warn.appendChild(button("finish-last", "Finish at last exercise"));
      bar.appendChild(warn);
    }
    const done = this.exercisesOf(log, running);
    const list = document.createElement("p");
    list.className = "hint";
    list.textContent = done.length ? `Done: ${done.join(" · ")}` : "Tap Log on an exercise to add it to this workout.";
    bar.appendChild(list);
    this.tick(running);
  }

  renderHistory(log) {
    const section = this.root.querySelector("#workout-history");
    const finished = log.workouts.filter((w) => w.end).slice(-10).reverse();
    section.hidden = !finished.length;
    const list = section.querySelector("ul");
    const tracker = this.getTracker();
    list.replaceChildren(
      ...finished.map((w) => {
        const li = document.createElement("li");
        const text = document.createElement("div");
        text.className = "li-text";
        const title = document.createElement("span");
        title.textContent = `${fmtDay(w.start)} · ${w.start.slice(11)}–${w.end.slice(11)} · ${fmtDuration(toMs(w.end) - toMs(w.start))}`;
        const exercises = document.createElement("small");
        const done = this.exercisesOf(log, w);
        exercises.textContent = done.length ? done.join(" · ") : "No exercises logged";
        text.append(title, exercises);
        const match = tracker && matchTrackerWorkout(w, tracker.workouts);
        if (match) {
          const m = document.createElement("small");
          m.className = "tracker-match";
          const parts = [match.activity, match.durationMin != null && `${match.durationMin} min`, match.strain != null && `strain ${match.strain.toFixed(1)}`,
            match.avgHr && `HR ${match.avgHr} / ${match.maxHr}`, match.kcal != null && `${Math.round(match.kcal)} kcal`].filter(Boolean);
          m.textContent = `${tracker.source}: ${parts.join(" · ")}`;
          text.appendChild(m);
        }
        const del = document.createElement("button");
        del.className = "icon-btn";
        del.dataset.deleteWorkout = w.id;
        del.setAttribute("aria-label", "Delete workout");
        del.textContent = "×";
        li.append(text, del);
        return li;
      }),
    );
  }
}
