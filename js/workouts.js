// Workouts: plans (templates of exercises with sets), timed workouts started from a plan or free,
// a set checklist while running, and the muscles a workout trained.
// Finished workouts are matched with tracker workouts (WHOOP, Polar) by overlapping time.
import { activeWorkout, dailyProgress, describeSets, localNow, newId, normalizeLog } from "./training-log.js";
import { lineChart } from "./charts.js";
import { suggestNextPlan, VOLUME_TARGET } from "./volume.js";
import { groupById } from "./data/muscle-groups.js";

const MIN = 60000;
const toMs = (local) => Date.parse(`${local}:00Z`); // local wall-clock times, compared consistently as "UTC"
const fmtDuration = (ms) => {
  const m = Math.max(0, Math.round(ms / MIN));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};
const fmtDay = (local) => new Date(toMs(local)).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
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
const describePlanItem = (it) => describeSets(it.sets);

/** End of a tracker workout; Polar gives only start and duration. */
export const trackerEnd = (t) =>
  t.end ?? (t.start && t.durationMin != null ? new Date(toMs(t.start) + t.durationMin * MIN).toISOString().slice(0, 16) : null);

/**
 * Tracker workout with the largest time overlap (15 min tolerance on both ends), or null.
 * trackerWorkouts: [{ start, end, activity, strain, avgHr, maxHr, kcal, durationMin }] in local time.
 */
export function matchTrackerWorkout(workout, trackerWorkouts) {
  if (!workout.end) return null;
  const s = toMs(workout.start) - 15 * MIN, e = toMs(workout.end) + 15 * MIN;
  let best = null, bestOverlap = 0;
  for (const t of trackerWorkouts ?? []) {
    const end = trackerEnd(t);
    if (!t.start || !end) continue;
    const overlap = Math.min(e, toMs(end)) - Math.max(s, toMs(t.start));
    if (overlap > bestOverlap) [best, bestOverlap] = [t, overlap];
  }
  return best;
}

/** Session id for the sets of a planned exercise in a workout (one session per exercise). */
const planSessionId = (workoutId, exercise) => `${workoutId}:${exercise}`;

/** Remove a workout and detach its sessions (the logged exercises stay in the log). */
function withoutWorkout(log, id) {
  return normalizeLog({
    ...log,
    workouts: log.workouts.filter((w) => w.id !== id),
    sessions: log.sessions.map(({ workoutId, ...s }) => (workoutId === id ? s : { ...s, ...(workoutId ? { workoutId } : {}) })),
  });
}

export class WorkoutView {
  /**
   * root: the exercises tab (contains #workout-bar, #workout-plans, #workout-history).
   * planDialog: the plan editor <dialog>. getLog/saveLog: the training log doc. exerciseById: catalog.
   * getMine(): ids of "my exercises" (listed first in the plan editor).
   * getTracker(): { source, workouts } or null. onShowMuscles(workoutId): highlight a workout on the model.
   * onSelectPlan(planId | null): a plan was tapped (or tapped again to clear): show the muscles it will train.
   */
  constructor(root, planDialog, { getLog, saveLog, exerciseById, getMine, getTracker, onShowMuscles, onSelectPlan }) {
    Object.assign(this, { root, planDialog, getLog, saveLog, exerciseById, getMine, getTracker, onShowMuscles, onSelectPlan });
    this.timer = null;
    this.editingPlan = null;
    this.selectedPlan = null; // plan whose muscles are shown on the model

    root.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("change", (e) => {
      // editing reps/kg of a ticked set updates the logged set
      const row = e.target.closest(".plan-set");
      if (row?.querySelector("[data-tick]")?.getAttribute("aria-pressed") === "true") this.saveSet(row, true);
    });
    this.setupPlanDialog();
  }

  /** Select a plan (null clears); the app colors the muscles it will train. */
  selectPlan(id) {
    this.selectedPlan = id;
    this.root.querySelectorAll("[data-select-plan]").forEach((li) => li.classList.toggle("plan-active", li.dataset.selectPlan === id));
    this.renderProgress(this.getLog());
    this.onSelectPlan?.(id);
  }

  // ---------- actions

  onClick(e) {
    // buttons inside a plan row match before the row itself (closest = nearest)
    const t = e.target.closest("[data-workout],[data-tick],[data-start-plan],[data-edit-plan],[data-show-workout],[data-delete-workout],[data-select-plan]");
    if (!t) return;
    const log = this.getLog();
    const running = activeWorkout(log);
    const action = t.dataset.workout;

    if (t.dataset.selectPlan) return this.selectPlan(this.selectedPlan === t.dataset.selectPlan ? null : t.dataset.selectPlan);

    if (t.dataset.startPlan !== undefined && !running) return this.start(log, t.dataset.startPlan || null);
    if (t.dataset.editPlan !== undefined) return this.openPlan(t.dataset.editPlan || null);
    if (t.dataset.showWorkout) return this.onShowMuscles(t.dataset.showWorkout);
    if (t.dataset.deleteWorkout) {
      if (confirm("Delete this workout? Its exercises stay in your log.")) this.saveLog(withoutWorkout(log, t.dataset.deleteWorkout));
      return;
    }
    if (t.dataset.tick !== undefined && running) return this.saveSet(t.closest(".plan-set"), t.getAttribute("aria-pressed") !== "true");

    if (!running) return;
    if (action === "finish") this.finish(log, running, localNow());
    else if (action === "finish-last") {
      // forgot to stop: end at the last logged exercise (or 1 h after the start)
      const times = log.sessions.filter((s) => s.workoutId === running.id && s.time).map((s) => `${s.date}T${s.time}`);
      this.finish(log, running, times.length ? times.sort().at(-1) : new Date(toMs(running.start) + 60 * MIN).toISOString().slice(0, 16));
    } else if (action === "cancel") {
      const n = log.sessions.filter((s) => s.workoutId === running.id).length;
      if (confirm(n ? `Discard this workout? Its ${n} logged exercise${n === 1 ? "" : "s"} stay in your log.` : "Discard this workout?")) {
        this.saveLog(withoutWorkout(log, running.id));
      }
    }
  }

  start(log, planId) {
    const plan = planId && log.plans.find((p) => p.id === planId);
    const workout = { id: newId(), start: localNow(), end: null, ...(plan ? { planId: plan.id, name: plan.name } : {}) };
    this.saveLog(normalizeLog({ ...log, workouts: [...log.workouts, workout] }));
  }

  finish(log, workout, end) {
    this.saveLog(normalizeLog({ ...log, workouts: log.workouts.map((w) => (w.id === workout.id ? { ...w, end } : w)) }));
    this.onShowMuscles(workout.id); // show what this workout trained
  }

  /** Tick or untick a planned set; the exercise's ticked sets are stored as one session. */
  saveSet(row, done) {
    const log = this.getLog();
    const running = activeWorkout(log);
    if (!running || !row) return;
    const { exercise } = row.dataset;
    const i = Number(row.dataset.i);
    const reps = Math.round(Number(row.querySelector("[name=reps]").value));
    const kg = Number(row.querySelector("[name=kg]").value) || 0;
    if (done && !(reps > 0)) return;
    const id = planSessionId(running.id, exercise);
    const existing = log.sessions.find((s) => s.id === id);
    const sets = (existing?.sets ?? []).filter((x) => x.i !== i);
    if (done) sets.push({ reps, kg, i });
    sets.sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
    const others = log.sessions.filter((s) => s.id !== id);
    const session = { id, date: running.start.slice(0, 10), exercise, sets, workoutId: running.id, time: existing?.time ?? localNow().slice(11) };
    this.saveLog(normalizeLog({ ...log, sessions: sets.length ? [...others, session] : others }));
  }

  // ---------- plan editor

  setupPlanDialog() {
    const d = this.planDialog;
    const rows = d.querySelector("#plan-rows");
    d.querySelector("#plan-add").addEventListener("click", () => this.addPlanRow({}));
    rows.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest("[data-remove-item]")) t.closest(".plan-row").remove();
      else if (t.closest("[data-add-set]")) {
        const list = t.closest(".plan-row").querySelector(".plan-set-rows");
        const last = [...list.children].at(-1);
        // a new set copies the previous one: only change what differs (e.g. less weight for a drop set)
        this.addSetRow(list, last ? { reps: last.querySelector("[name=reps]").value, kg: last.querySelector("[name=kg]").value } : {});
      } else if (t.closest("[data-remove-set]")) {
        const list = t.closest(".plan-set-rows");
        if (list.children.length > 1) t.closest(".plan-set-row").remove();
        this.renumberSets(list);
      }
    });
    d.querySelector("#plan-cancel").addEventListener("click", () => d.close());
    d.querySelector("#plan-delete").addEventListener("click", () => {
      if (!this.editingPlan || !confirm(`Delete the plan "${this.editingPlan.name}"? Past workouts stay.`)) return;
      const log = this.getLog();
      this.saveLog(normalizeLog({ ...log, plans: log.plans.filter((p) => p.id !== this.editingPlan.id) }));
      d.close();
    });
    d.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const items = [...rows.querySelectorAll(".plan-row")].map((r) => ({
        exercise: r.querySelector("[name=exercise]").value,
        sets: [...r.querySelectorAll(".plan-set-row")].map((s) => ({ reps: s.querySelector("[name=reps]").value, kg: s.querySelector("[name=kg]").value })),
      })).filter((x) => this.exerciseById.has(x.exercise));
      const error = d.querySelector("#plan-error");
      if (!items.length) {
        error.textContent = "Add at least one exercise.";
        return;
      }
      const log = this.getLog();
      const plan = { id: this.editingPlan?.id ?? newId(), name: d.querySelector("[name=plan-name]").value, items };
      this.saveLog(normalizeLog({ ...log, plans: [...log.plans.filter((p) => p.id !== plan.id), plan] }));
      d.close();
    });
  }

  openPlan(planId) {
    const d = this.planDialog;
    this.editingPlan = planId ? this.getLog().plans.find((p) => p.id === planId) : null;
    d.querySelector("#plan-title").textContent = this.editingPlan ? "Edit workout plan" : "New workout plan";
    d.querySelector("[name=plan-name]").value = this.editingPlan?.name ?? "";
    d.querySelector("#plan-delete").hidden = !this.editingPlan;
    d.querySelector("#plan-error").textContent = "";
    d.querySelector("#plan-rows").replaceChildren();
    const three = () => [0, 1, 2].map(() => ({ reps: 10, kg: 0 }));
    const items = this.editingPlan?.items ?? this.getMine().slice(0, 3).map((exercise) => ({ exercise, sets: three() }));
    (items.length ? items : [{}]).forEach((it) => this.addPlanRow(it));
    d.showModal();
  }

  addPlanRow({ exercise = this.getMine()[0] ?? "push_up", sets = [0, 1, 2].map(() => ({ reps: 10, kg: 0 })) }) {
    const mine = this.getMine();
    const all = [...this.exerciseById.values()];
    const option = (ex) => el("option", { value: ex.id, selected: ex.id === exercise, textContent: ex.name });
    const select = el("select", { name: "exercise" },
      ...(mine.length ? [el("optgroup", { label: "My exercises" }, ...mine.map((id) => option(this.exerciseById.get(id))))] : []),
      el("optgroup", { label: "All exercises" }, ...all.filter((ex) => !mine.includes(ex.id)).map(option)));
    const list = el("div", { className: "plan-set-rows" });
    const row = el("div", { className: "plan-row" },
      el("div", { className: "plan-row-head" },
        el("label", {}, "Exercise", select),
        el("button", { type: "button", className: "icon-btn", dataset: { removeItem: "" }, ariaLabel: "Remove exercise", textContent: "×" })),
      list,
      el("button", { type: "button", className: "ghost small", dataset: { addSet: "" }, textContent: "+ Set" }));
    sets.forEach((s) => this.addSetRow(list, s));
    this.planDialog.querySelector("#plan-rows").appendChild(row);
  }

  addSetRow(list, { reps = 10, kg = 0 }) {
    // maxlength: ignored by browsers for number inputs, but keeps password managers (KeePassXC) from taking groups of them for one-time-code boxes
    const num = (name, value, attrs) => el("input", { name, type: "number", maxLength: 6, value: value || "", ...attrs });
    list.appendChild(el("div", { className: "plan-set-row" },
      el("span", { className: "set-no" }),
      el("label", {}, num("reps", reps, { min: 1, step: 1, inputMode: "numeric", required: true, ariaLabel: "Reps" }), " reps"),
      el("label", {}, num("kg", kg, { min: 0, step: 0.5, inputMode: "decimal", placeholder: "–", ariaLabel: "kg" }), " kg"),
      el("button", { type: "button", className: "icon-btn", dataset: { removeSet: "" }, ariaLabel: "Remove set", textContent: "×" })));
    this.renumberSets(list);
  }

  renumberSets(list) {
    [...list.children].forEach((r, i) => (r.querySelector(".set-no").textContent = `Set ${i + 1}`));
  }

  // ---------- rendering

  render() {
    const log = this.getLog();
    const running = activeWorkout(log);
    this.renderBar(log, running);
    this.renderPlans(log, running);
    this.renderHistory(log);
    clearInterval(this.timer);
    if (running) this.timer = setInterval(() => this.tick(running), 1000);
  }

  tick(running) {
    const out = this.root.querySelector("#workout-elapsed");
    if (!out) return;
    // "YYYY-MM-DDTHH:MM" without an offset parses as local time
    const s = Math.max(0, Math.floor((Date.now() - new Date(running.start).getTime()) / 1000));
    out.textContent = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  exercisesOf(log, workout) {
    return log.sessions
      .filter((s) => s.workoutId === workout.id)
      .map((s) => `${this.exerciseById.get(s.exercise)?.name ?? s.exercise} ${describeSets(s.sets)}`);
  }

  renderBar(log, running) {
    const bar = this.root.querySelector("#workout-bar");
    bar.hidden = !running;
    bar.replaceChildren();
    if (!running) return;
    const button = (action, text, cls = "ghost small") => el("button", { type: "button", className: cls, dataset: { workout: action }, textContent: text });

    bar.append(
      el("div", { className: "workout-head" },
        el("span", { className: "workout-live", textContent: `${running.name ?? "Workout"} · since ${running.start.slice(11)}` }),
        el("strong", { id: "workout-elapsed" })),
      el("div", { className: "workout-actions" },
        el("button", { type: "button", className: "ghost small", dataset: { showWorkout: running.id }, textContent: "Muscles" }),
        button("cancel", "Discard"),
        button("finish", "■ Finish", "primary-btn small")),
    );

    const hours = (Date.now() - new Date(running.start).getTime()) / 3600000;
    if (hours > 3) {
      const warn = el("p", { className: "hint", textContent: `Running for ${Math.floor(hours)} h. Forgot to finish?` });
      warn.appendChild(button("finish-last", "Finish at last exercise"));
      bar.appendChild(warn);
    }

    // set checklist for a planned workout
    const plan = running.planId && log.plans.find((p) => p.id === running.planId);
    if (plan) {
      const checklist = el("div", { className: "plan-checklist" });
      for (const item of plan.items) {
        const ex = this.exerciseById.get(item.exercise);
        if (!ex) continue;
        const session = log.sessions.find((s) => s.id === planSessionId(running.id, item.exercise));
        const doneByIndex = new Map((session?.sets ?? []).map((x) => [x.i, x]));
        const block = el("div", { className: "plan-exercise" },
          el("div", { className: "plan-exercise-head" },
            el("strong", { textContent: ex.name }),
            el("small", { textContent: `${doneByIndex.size}/${item.sets.length} sets · plan ${describePlanItem(item)}` })));
        for (let i = 0; i < item.sets.length; i++) {
          const target = item.sets[i];
          const done = doneByIndex.get(i);
          block.appendChild(el("div", { className: `plan-set${done ? " done" : ""}`, dataset: { exercise: item.exercise, i: String(i) } },
            el("span", { className: "set-no", textContent: `Set ${i + 1}` }),
            el("label", {}, el("input", { name: "reps", type: "number", maxLength: 4, min: 1, step: 1, inputMode: "numeric", value: String(done?.reps ?? target.reps) }), " reps"),
            el("label", {}, el("input", { name: "kg", type: "number", maxLength: 6, min: 0, step: 0.5, inputMode: "decimal", placeholder: "–", value: done?.kg || target.kg || "" }), " kg"),
            el("button", { type: "button", className: "tick-btn", dataset: { tick: "" }, ariaPressed: String(!!done), ariaLabel: `Set ${i + 1} done`, textContent: "✓" })));
        }
        checklist.appendChild(block);
      }
      bar.appendChild(checklist);
    }

    // exercises added with "Log" (free workout, or extras on top of the plan)
    const planned = new Set(plan ? plan.items.map((it) => planSessionId(running.id, it.exercise)) : []);
    const extras = log.sessions.filter((s) => s.workoutId === running.id && !planned.has(s.id))
      .map((s) => `${this.exerciseById.get(s.exercise)?.name ?? s.exercise} ${describeSets(s.sets)}`);
    bar.appendChild(el("p", {
      className: "hint",
      textContent: extras.length ? `${plan ? "Also done" : "Done"}: ${extras.join(" · ")}` : plan ? "Tick sets as you go. Tap Log on an exercise to add extras." : "Tap Log on an exercise to add it to this workout.",
    }));
    this.tick(running);
  }

  renderPlans(log, running) {
    const box = this.root.querySelector("#workout-plans");
    box.hidden = !!running;
    if (running) return;
    const next = this.suggestion(log);
    const list = box.querySelector("ul");
    list.replaceChildren(
      ...log.plans.map((p) => el("li", { className: p.id === this.selectedPlan ? "plan-active" : "", dataset: { selectPlan: p.id }, title: "Show the muscles this workout trains" },
        el("div", { className: "li-text" },
          el("span", {},
            p.name,
            ...(p.id === next?.plan.id ? [" ", el("small", { className: "suggested", textContent: "suggested", title: next.why })] : [])),
          // exercise names only, one per line; sets and reps show once the workout is opened (Start / Edit)
          ...p.items.map((it) => el("small", { textContent: this.exerciseById.get(it.exercise)?.name ?? it.exercise }))),
        el("button", { type: "button", className: "ghost small", dataset: { editPlan: p.id }, textContent: "Edit" }),
        el("button", { type: "button", className: "primary-btn small", dataset: { startPlan: p.id }, textContent: "▶ Start" }))),
    );
    box.querySelector("#plans-hint").hidden = log.plans.length > 0;
    this.renderProgress(log);
  }

  /**
   * Progress of the selected plan's exercises: one card per exercise with total reps per day,
   * plus the heaviest weight per day below it when the exercise was ever done with weight
   * (two single-axis charts on the same dates rather than one chart with two scales).
   */
  renderProgress(log) {
    const box = this.root.querySelector("#plan-progress");
    const plan = !activeWorkout(log) && this.selectedPlan && log.plans.find((p) => p.id === this.selectedPlan);
    box.hidden = !plan;
    box.replaceChildren();
    if (!plan) return;
    const css = getComputedStyle(document.documentElement);
    const colors = { reps: css.getPropertyValue("--series-1").trim(), kg: css.getPropertyValue("--series-2").trim() };
    const fmtKg = (v) => (Number.isInteger(v) ? `${v}` : v.toFixed(1));
    box.appendChild(el("h4", { textContent: `Progress · ${plan.name}` }));

    for (const exercise of new Set(plan.items.map((it) => it.exercise))) {
      const days = dailyProgress(log.sessions.filter((s) => s.exercise === exercise));
      const card = el("div", { className: "progress-card" },
        el("strong", { textContent: this.exerciseById.get(exercise)?.name ?? exercise }));
      box.appendChild(card);
      if (!days.length) {
        card.appendChild(el("small", { textContent: "Not done yet" }));
        continue;
      }
      const first = days[0], last = days.at(-1);
      const weighted = days.some((d) => d.kg > 0);
      const change = (a, b, unit) => (b === a ? `${b} ${unit}` : `${a} → ${b} ${unit}`);
      card.appendChild(el("small", {
        textContent: [
          `${days.length} day${days.length === 1 ? "" : "s"} since ${fmtDay(`${first.date}T00:00`)}`,
          change(first.reps, last.reps, "reps"),
          weighted && change(fmtKg(first.kg), fmtKg(last.kg), "kg"),
        ].filter(Boolean).join(" · "),
      }));
      // one day alone: open the time axis a day earlier so the dot sits at the right edge
      const series = (key) => [...(days.length === 1 ? [{ t: first.t - 86400000, v: null }] : []), ...days.map((d) => ({ t: d.t, v: d[key] }))];
      const describe = (t) => {
        const d = days.find((x) => x.t === t);
        return d ? `${fmtDay(`${d.date}T00:00`)} · ${describeSets(d.sets)}` : "";
      };
      const chart = (key, label, unit, format) => {
        const c = el("div", { className: "progress-chart" });
        card.append(el("span", { className: "progress-label", textContent: label }), c);
        lineChart(c, series(key), { color: colors[key], height: 110, unit, format, describe });
      };
      chart("reps", "Total reps", "reps");
      if (weighted) chart("kg", "Heaviest weight", "kg", fmtKg);
    }
  }

  /**
   * The plan to do next (see suggestNextPlan), marked "suggested" in its row; `why` is the hover text.
   * Null with fewer than 2 plans, or when every plan's main groups already reached the weekly target.
   */
  suggestion(log) {
    const s = log.plans.length >= 2 ? suggestNextPlan(log, this.exerciseById, localNow().slice(0, 10)) : null;
    if (!s || s.score === 0) return null;
    const label = (g) => groupById.get(g)?.label ?? g;
    const fmt = (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
    const why = `Below ${VOLUME_TARGET[0]} sets this week: ${s.gaps.slice(0, 3).map((x) => `${label(x.g)} ${fmt(x.sets)}`).join(", ")}`
      + (s.fresh.length ? ` · trained in the last 2 days: ${s.fresh.map(label).join(", ")}` : "");
    return { plan: s.plan, why };
  }

  renderHistory(log) {
    const section = this.root.querySelector("#workout-history");
    const finished = log.workouts.filter((w) => w.end).slice(-10).reverse();
    section.hidden = !finished.length;
    const tracker = this.getTracker();
    section.querySelector("ul").replaceChildren(
      ...finished.map((w) => {
        const text = el("div", { className: "li-text" },
          // title, then when on its own line (a combined line wrapped over 3-4 lines on a phone)
          el("span", { textContent: w.name || "Free workout" }),
          el("small", { className: "when", textContent: `${fmtDay(w.start)} · ${w.start.slice(11)}–${w.end.slice(11)} · ${fmtDuration(toMs(w.end) - toMs(w.start))}` }),
          el("small", { textContent: this.exercisesOf(log, w).join(" · ") || "No exercises logged" }));
        const match = tracker && matchTrackerWorkout(w, tracker.workouts);
        if (match) {
          const parts = [match.activity, match.durationMin != null && `${match.durationMin} min`, match.strain != null && `strain ${match.strain.toFixed(1)}`,
            match.avgHr && `HR ${match.avgHr} / ${match.maxHr}`, match.kcal != null && `${Math.round(match.kcal)} kcal`].filter(Boolean);
          text.appendChild(el("small", { className: "tracker-match", textContent: `${match.source ?? tracker.source}: ${parts.join(" · ")}` }));
        }
        return el("li", {}, text,
          el("button", { type: "button", className: "ghost small", dataset: { showWorkout: w.id }, textContent: "Muscles" }),
          el("button", { type: "button", className: "icon-btn", dataset: { deleteWorkout: w.id }, ariaLabel: "Delete workout", textContent: "×" }));
      }),
    );
  }
}
