import { MuscleViewer } from "./viewer.js";
import { EXERCISES } from "./data/exercises.js";
import { MUSCLE_GROUPS, REGIONS, groupById } from "./data/muscle-groups.js";
import { GitHubStore } from "./github-store.js";
import { HealthView } from "./health.js";
import { SyncedDoc, readLocal, writeLocal } from "./synced-doc.js";
import { LogDialog, normalizeLog, mergeLogs, lastSessionText } from "./training-log.js";
import { CheckinView, normalizeJournal, mergeJournals, localToday } from "./checkin.js";
import { weeklySets, volumeColors, workoutMuscles, VOLUME_BINS, VOLUME_TARGET } from "./volume.js";
import { WorkoutView } from "./workouts.js";
import { SupplementDialog } from "./supplements.js";

const $ = (sel) => document.querySelector(sel);

const viewer = new MuscleViewer($("#viewer"));
const health = new HealthView($("#health-view"));
const state = {
  mine: [], // ids of the user's exercises, in the order added
  exercises: new Set(), // selected (highlighted) exercise ids
  group: null, // selected muscle group id (muscles tab)
  volume: false, // weekly-volume heatmap on the model
  workoutFocus: null, // workout id whose trained muscles are shown on the model
};

// ---------- highlighting

function refresh() {
  const primary = new Set();
  const secondary = new Set();
  const focus = state.workoutFocus && workoutMuscles(trainingLog.doc, state.workoutFocus, exerciseById);
  if (focus) {
    focus.primary.forEach((g) => primary.add(g));
    focus.secondary.forEach((g) => secondary.add(g));
  } else if (state.group) {
    primary.add(state.group);
  } else {
    for (const ex of EXERCISES.filter((e) => state.exercises.has(e.id))) {
      ex.primary.forEach((g) => primary.add(g));
      ex.secondary.forEach((g) => secondary.add(g));
    }
  }
  // a muscle that is a main mover for any selected exercise is listed as primary only
  for (const g of primary) secondary.delete(g);
  viewer.setHighlight([...primary], [...secondary]);
  writeHash();

  document.querySelectorAll("#exercise-list li").forEach((li) => li.classList.toggle("active", state.exercises.has(li.dataset.id)));
  document.querySelectorAll("#group-list .chip").forEach((c) => c.classList.toggle("active", c.dataset.id === state.group));
  if (state.volume) showVolume();
  else if (focus) showWorkoutSummary(focus);
  else showSummary(primary, secondary);
}

/** Show which muscles a workout trained: highlight on the model + sets per muscle group. */
function showWorkoutMuscles(workoutId) {
  setVolume(false);
  state.exercises.clear();
  state.group = null;
  state.workoutFocus = workoutId;
  viewer.setSelected(null);
  refresh();
}

function showWorkoutSummary(focus) {
  const w = trainingLog.doc.workouts.find((x) => x.id === state.workoutFocus);
  const info = $("#info");
  info.replaceChildren();
  const head = document.createElement("strong");
  const minutes = w?.end ? Math.round((Date.parse(`${w.end}:00Z`) - Date.parse(`${w.start}:00Z`)) / 60000) : null;
  head.textContent = `${w?.name ?? "Workout"}${minutes != null ? ` · ${minutes} min` : " · running"} · ${focus.totalSets} sets`;
  info.appendChild(head);
  const fmt = (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
  const line = document.createElement("div");
  line.textContent = focus.sets.size
    ? [...focus.sets].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${groupById.get(g)?.label ?? g} ${fmt(n)}`).join(" · ")
    : "No sets logged yet.";
  info.appendChild(line);
  const note = document.createElement("div");
  note.className = "muted";
  note.textContent = "Red: main muscles · orange: assisting (half a set). Tap an exercise or Clear to go back.";
  info.appendChild(note);
  info.hidden = false;
}

function showSummary(primary, secondary) {
  const info = $("#info");
  if (state.group) {
    const g = groupById.get(state.group);
    const trainedBy = EXERCISES.filter((e) => e.primary.includes(g.id) || e.secondary.includes(g.id));
    info.innerHTML = `<strong>${g.label}</strong>
      <div class="muted">Trained by: ${trainedBy.map((e) => e.name).join(", ") || "—"}</div>`;
    info.hidden = false;
  } else if (state.exercises.size) {
    const names = (set) => [...set].map((id) => groupById.get(id)?.label ?? id).join(", ");
    info.innerHTML = `<div><span class="dot primary"></span>${names(primary)}</div>
      ${secondary.size ? `<div class="muted"><span class="dot secondary"></span>${names(secondary)}</div>` : ""}`;
    info.hidden = false;
  } else {
    info.hidden = true;
  }
}

// ---------- synced data: "my exercises" (profile.json) and the training log (training-log.json)

const SYNC_KEY = "fa.sync"; // { repo, token }
const exerciseById = new Map(EXERCISES.map((e) => [e.id, e]));
const validIds = (ids) => (Array.isArray(ids) ? [...new Set(ids.filter((id) => exerciseById.has(id)))] : []);

const profile = new SyncedDoc({
  key: "fa.myExercises",
  dirtyKey: "fa.unsynced",
  path: "profile.json",
  message: "Update my exercises",
  // older versions cached a bare array of ids
  normalize: (raw) => ({ version: 1, myExercises: validIds(Array.isArray(raw) ? raw : raw?.myExercises) }),
  merge: (remote, local) => ({ version: 1, myExercises: validIds([...remote.myExercises, ...local.myExercises]) }),
});

const trainingLog = new SyncedDoc({
  key: "fa.trainingLog",
  dirtyKey: "fa.trainingLog.unsynced",
  path: "training-log.json",
  message: "Update training log",
  normalize: normalizeLog,
  merge: mergeLogs,
});

const journal = new SyncedDoc({
  key: "fa.journal",
  dirtyKey: "fa.journal.unsynced",
  path: "journal.json",
  message: "Update daily check-in",
  normalize: normalizeJournal,
  merge: mergeJournals,
});
const syncedDocs = [profile, trainingLog, journal];

let syncRepo = null; // repo name while connected
const syncState = new Map(); // doc -> { state, message }

function renderSyncStatus() {
  const el = $("#sync-status");
  if (!syncRepo) {
    el.textContent = "This device only — tap to sync";
    el.dataset.kind = "";
    return;
  }
  const states = [...syncState.values()];
  const error = states.find((s) => s.state === "error");
  if (error) {
    el.textContent = `Not synced: ${error.message}`;
    el.dataset.kind = "error";
  } else if (states.some((s) => s.state === "saving")) {
    el.textContent = "Saving…";
    el.dataset.kind = "";
  } else {
    el.textContent = `Synced to ${syncRepo}`;
    el.dataset.kind = "ok";
  }
}

for (const doc of syncedDocs) {
  doc.onStatus = (state, message) => {
    syncState.set(doc, { state, message });
    renderSyncStatus();
  };
}

profile.onChange = (doc) => {
  state.mine = doc.myExercises;
  readHash(); // the URL may select exercises that only the synced list contains
  renderMyExercises();
};
trainingLog.onChange = () => {
  renderMyExercises();
  workoutView.render();
  if (state.volume) showVolume();
};
journal.onChange = (doc) => {
  checkin.render();
  health.setJournal(doc);
};

const saveMyExercises = () => profile.update({ version: 1, myExercises: state.mine });

/** Connect both documents; `merge` keeps this device's data on a first connect. */
async function connectGitHub(cfg, { merge = false } = {}) {
  syncRepo = cfg.repo;
  syncState.clear();
  $("#sync-status").textContent = "Loading from GitHub…";
  await Promise.all(syncedDocs.map((doc) => doc.connect(cfg, { merge })));
  loadHealth(cfg);
}

function disconnectGitHub() {
  syncedDocs.forEach((doc) => doc.disconnect());
  syncRepo = null;
  renderSyncStatus();
}

// ---------- health data (health/whoop.json in the data repo), cached for offline use

const HEALTH_CACHE_KEY = "fa.health";

async function loadHealth(cfg) {
  try {
    const doc = await new GitHubStore({ ...cfg, path: "health/whoop.json" }).loadRaw();
    if (!doc) {
      health.setMessage(`No health data in ${cfg.repo} yet.`);
      return;
    }
    health.setMessage("");
    health.setData(doc);
    workoutView.render(); // tracker matches
    writeLocal(HEALTH_CACHE_KEY, doc);
  } catch (err) {
    health.setMessage(`Could not load health data: ${err.message}`);
  }
}

// ---------- views: body (3D) / health (dashboard)

function showView(view) {
  document.body.dataset.view = view;
  $("#health-view").hidden = view !== "health";
  if (view === "health") health.render();
  writeHash();
}

$("#health-open").addEventListener("click", () => showView("health"));
$("#health-back").addEventListener("click", () => showView("body"));

const primaryLabels = (e) => e.primary.map((g) => groupById.get(g)?.label ?? g).join(" · ");

function renderMyExercises() {
  const mine = state.mine.map((id) => exerciseById.get(id));
  $("#my-hint").textContent = mine.length
    ? "Tap exercises to see which muscles they train."
    : "No exercises yet. Search above and tap + to add one.";
  $("#exercise-list").innerHTML = mine
    .map((e) => {
      const last = lastSessionText(trainingLog.doc, e.id);
      return `<li data-id="${e.id}">
      <div class="li-text"><span>${e.name}</span><small>${primaryLabels(e)}</small>${last ? `<small class="last-session">${last}</small>` : ""}</div>
      <button class="ghost small" data-log="${e.id}" aria-label="Log a session of ${e.name}">Log</button>
      <button class="icon-btn" data-remove="${e.id}" aria-label="Remove ${e.name}">×</button></li>`;
    })
    .join("");
  refresh();
}

function renderSearch() {
  const q = $("#exercise-search").value.trim().toLowerCase();
  const results = $("#search-results");
  $("#my-exercises").hidden = !!q;
  results.hidden = !q;
  if (!q) return;
  const matches = EXERCISES.filter((e) => e.name.toLowerCase().includes(q));
  results.innerHTML = matches.length
    ? matches
      .map((e) => {
        const added = state.mine.includes(e.id);
        return `<li data-id="${e.id}">
          <div class="li-text"><span>${e.name}</span><small>${primaryLabels(e)}</small></div>
          <button class="icon-btn add" data-add="${e.id}" aria-label="Add ${e.name}" ${added ? "disabled" : ""}>${added ? "✓" : "+"}</button></li>`;
      })
      .join("")
    : `<li class="empty">No exercise matches “${$("#exercise-search").value.trim()}”.</li>`;
}

$("#search-results").addEventListener("click", (e) => {
  const id = e.target.closest("[data-add]")?.dataset.add;
  if (!id || state.mine.includes(id)) return;
  state.mine.push(id);
  saveMyExercises();
  renderSearch();
  renderMyExercises();
});

$("#exercise-list").addEventListener("click", (e) => {
  const logId = e.target.closest("[data-log]")?.dataset.log;
  if (logId) {
    logDialog.open(exerciseById.get(logId));
    return;
  }
  const removeId = e.target.closest("[data-remove]")?.dataset.remove;
  if (removeId) {
    state.mine = state.mine.filter((id) => id !== removeId);
    state.exercises.delete(removeId);
    saveMyExercises();
    renderMyExercises();
    return;
  }
  const li = e.target.closest("li");
  if (!li) return;
  const id = li.dataset.id;
  setVolume(false);
  state.workoutFocus = null;
  state.exercises.has(id) ? state.exercises.delete(id) : state.exercises.add(id);
  state.group = null;
  viewer.setSelected(null);
  refresh();
});

$("#exercise-search").addEventListener("input", renderSearch);
$("#exercise-search").addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  e.target.value = "";
  renderSearch();
});
$("#clear-selection").addEventListener("click", () => {
  state.workoutFocus = null;
  state.exercises.clear();
  state.group = null;
  viewer.setSelected(null);
  refresh();
});

// ---------- muscles tab

$("#group-list").innerHTML = REGIONS.map((r) => `
  <h3>${r.label}</h3>
  <div class="chips">${MUSCLE_GROUPS.filter((g) => g.region === r.id)
    .map((g) => `<button class="chip" data-id="${g.id}">${g.label}</button>`).join("")}</div>`).join("");

$("#group-list").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  setVolume(false);
  state.workoutFocus = null;
  state.group = state.group === chip.dataset.id ? null : chip.dataset.id;
  viewer.setSelected(null);
  refresh();
});

// ---------- tabs

document.querySelectorAll("[role=tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll("[role=tab]").forEach((t) => t.setAttribute("aria-selected", t === tab));
    document.querySelectorAll("[data-tab-body]").forEach((b) => (b.hidden = b.dataset.tabBody !== tab.dataset.tab));
    if (tab.dataset.tab === "today") checkin.render();
  }),
);

// ---------- toolbar

document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewer.setView(b.dataset.view)));

function toggle(btn, fn) {
  btn.addEventListener("click", () => {
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", on);
    fn(on);
  });
}
toggle($("#toggle-xray"), (on) => {
  viewer.setXray(on);
  writeHash();
});
toggle($("#toggle-skeleton"), (on) => viewer.setSkeletonVisible(on));
$("#toggle-volume").addEventListener("click", () => setVolume(!state.volume));

// ---------- weekly volume: muscles colored by hard sets in the last 7 days

function setVolume(on) {
  if (state.volume === on) return;
  state.volume = on;
  $("#toggle-volume").setAttribute("aria-pressed", on);
  $("#legend-highlight").hidden = on;
  $("#legend-volume").hidden = !on;
  if (on) showVolume();
  else {
    viewer.setGroupColors(null);
    refresh();
  }
  writeHash();
}

function showVolume() {
  const sets = weeklySets(trainingLog.doc, exerciseById, localToday());
  viewer.setSelected(null);
  viewer.setGroupColors(volumeColors(sets));

  const legend = $("#legend-volume");
  legend.replaceChildren();
  const title = document.createElement("span");
  title.className = "legend-title";
  title.textContent = "Sets, last 7 days";
  legend.appendChild(title);
  for (const bin of VOLUME_BINS) {
    const item = document.createElement("span");
    const sw = document.createElement("i");
    sw.className = "swatch";
    sw.style.background = `var(${bin.token})`;
    item.append(sw, document.createTextNode(bin.label));
    legend.appendChild(item);
  }

  // summary: trained groups, and groups your exercises target that are below 10 sets
  const fmt = (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
  const trained = [...sets].filter(([, n]) => n >= 0.5).sort((a, b) => b[1] - a[1]);
  const targeted = new Set(state.mine.flatMap((id) => exerciseById.get(id).primary));
  const below = [...targeted].filter((g) => (sets.get(g) ?? 0) < VOLUME_TARGET[0]);
  const info = $("#info");
  info.replaceChildren();
  const head = document.createElement("strong");
  head.textContent = trained.length ? "Hard sets, last 7 days" : "No sets logged in the last 7 days";
  info.appendChild(head);
  if (trained.length) {
    const line = document.createElement("div");
    line.textContent = trained.map(([g, n]) => `${groupById.get(g)?.label ?? g} ${fmt(n)}`).join(" · ");
    info.appendChild(line);
  }
  if (below.length) {
    const line = document.createElement("div");
    line.className = "muted";
    line.textContent = `Below ${VOLUME_TARGET[0]} sets: ${below.map((g) => groupById.get(g)?.label ?? g).join(", ")}`;
    info.appendChild(line);
  }
  const note = document.createElement("div");
  note.className = "muted";
  note.textContent = "Secondary muscles count half a set. Target: 10–20 sets per muscle group per week.";
  info.appendChild(note);
  info.hidden = false;
}

// ---------- picking a muscle on the model

viewer.onPick = (mesh) => {
  viewer.setSelected(mesh);
  if (!mesh) return refresh();
  const { muscle, side, group } = mesh.userData;
  const g = group && groupById.get(group);
  const sideLabel = side === "l" ? "left" : side === "r" ? "right" : "";
  const trainedBy = g ? EXERCISES.filter((e) => e.primary.includes(g.id) || e.secondary.includes(g.id)) : [];
  const info = $("#info");
  info.innerHTML = `<strong>${muscle}</strong>${sideLabel ? ` <span class="muted">(${sideLabel})</span>` : ""}
    <div class="muted">${g ? `Group: ${g.label}` : "Not part of a training group"}</div>
    ${trainedBy.length ? `<div class="muted">Trained by: ${trainedBy.map((e) => e.name).join(", ")}</div>` : ""}`;
  info.hidden = false;
};

// ---------- shareable state in the URL hash: #ex=push_up,squat or #group=lats

function writeHash() {
  const params = new URLSearchParams();
  if (state.group) params.set("group", state.group);
  else if (state.exercises.size) params.set("ex", [...state.exercises].join(","));
  if (viewer.xray) params.set("xray", "1");
  if (state.volume) params.set("volume", "1");
  if (document.body.dataset.view === "health") params.set("view", "health");
  const hash = params.toString().replaceAll("%2C", ",");
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.exercises = new Set((params.get("ex") ?? "").split(",").filter((id) => state.mine.includes(id)));
  state.group = groupById.has(params.get("group")) ? params.get("group") : null;
  if (params.get("view") === "health") {
    document.body.dataset.view = "health";
    $("#health-view").hidden = false;
  }
  if (params.get("xray") === "1") {
    viewer.setXray(true);
    $("#toggle-xray").setAttribute("aria-pressed", "true");
  }
}

// ---------- training log dialog

const logDialog = new LogDialog($("#log-dialog"), {
  getLog: () => trainingLog.doc,
  saveLog: (doc) => trainingLog.update(doc),
});

// ---------- timed workouts

const workoutView = new WorkoutView($("#exercises-tab"), $("#plan-dialog"), {
  getLog: () => trainingLog.doc,
  saveLog: (doc) => trainingLog.update(doc),
  exerciseById,
  getMine: () => state.mine,
  getTracker: () => (health.doc ? { source: "WHOOP", workouts: health.doc.workouts } : null),
  onShowMuscles: showWorkoutMuscles,
});

// ---------- daily check-in

const supplementDialog = new SupplementDialog($("#supp-dialog"), {
  getSupplements: () => journal.doc.supplements,
  save: (supplements) => journal.update({ ...journal.doc, supplements }),
  today: localToday,
});

const checkin = new CheckinView($("#checkin"), {
  getJournal: () => journal.doc,
  saveJournal: (doc) => journal.update(doc),
  editProtocol: () => supplementDialog.open(),
});

// ---------- sync settings dialog

const dialog = $("#sync-dialog");

function openSyncDialog() {
  const cfg = readLocal(SYNC_KEY, null);
  dialog.querySelector("[name=repo]").value = cfg?.repo ?? "";
  dialog.querySelector("[name=token]").value = cfg?.token ?? "";
  $("#sync-disconnect").hidden = !cfg;
  $("#sync-error").textContent = "";
  dialog.showModal();
}

$("#sync-open").addEventListener("click", openSyncDialog);
$("#sync-status").addEventListener("click", openSyncDialog);
$("#sync-cancel").addEventListener("click", () => dialog.close());

dialog.querySelector("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cfg = {
    repo: dialog.querySelector("[name=repo]").value.trim(),
    token: dialog.querySelector("[name=token]").value.trim(),
  };
  const submit = dialog.querySelector("[type=submit]");
  submit.disabled = true;
  $("#sync-error").textContent = "Connecting…";
  try {
    await connectGitHub(cfg, { merge: true });
    writeLocal(SYNC_KEY, cfg);
    dialog.close();
  } catch (err) {
    disconnectGitHub();
    $("#sync-error").textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});

$("#sync-disconnect").addEventListener("click", () => {
  writeLocal(SYNC_KEY, undefined);
  writeLocal(HEALTH_CACHE_KEY, undefined); // health data stays only on connected devices
  disconnectGitHub();
  dialog.close();
});

// ---------- boot

const startVolume = new URLSearchParams(location.hash.slice(1)).get("volume") === "1"; // read before the hash is rewritten
state.mine = profile.doc.myExercises;
readHash();
renderMyExercises();
health.setJournal(journal.doc);
if (startVolume) setVolume(true);
const cachedHealth = readLocal(HEALTH_CACHE_KEY, null);
if (cachedHealth) health.setData(cachedHealth);
workoutView.render(); // after the health cache, so tracker matches show right away
const syncCfg = readLocal(SYNC_KEY, null);
if (syncCfg) {
  connectGitHub(syncCfg).catch((err) => {
    $("#sync-status").textContent = `Not synced: ${err.message}`;
    $("#sync-status").dataset.kind = "error";
  });
} else {
  renderSyncStatus();
  if (!cachedHealth) health.setMessage("Connect GitHub sync (⚙) to load your health data.");
}
viewer
  .load("assets/models/muscles.glb", "assets/models/skeleton.glb", (p) => ($("#loading-fill").style.width = `${Math.round(p * 100)}%`))
  .then(() => $("#loading").remove())
  .catch((err) => {
    console.error(err);
    $("#loading").innerHTML = `<span>Could not load the 3D model: ${err.message}</span>`;
  });
