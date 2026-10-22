import { MuscleViewer } from "./viewer.js";
import { EXERCISES } from "./data/exercises.js";
import { MUSCLE_GROUPS, REGIONS, groupById } from "./data/muscle-groups.js";
import { GitHubStore } from "./github-store.js";
import { HealthView, mergeHealthDocs } from "./health.js";
import { SyncedDoc, readLocal, writeLocal } from "./synced-doc.js";
import { LogDialog, normalizeLog, mergeLogs, lastSessionText } from "./training-log.js";
import { CheckinView, normalizeJournal, mergeJournals, localToday } from "./checkin.js";
import { weeklySets, volumeColors, workoutMuscles, VOLUME_BINS, VOLUME_TARGET } from "./volume.js";
import { WorkoutView } from "./workouts.js";
import { SupplementDialog } from "./supplements.js";
import { checkForUpdate } from "./update-check.js";
import { getThemeMode, setThemeMode } from "./theme.js";

const $ = (sel) => document.querySelector(sel);

// iOS Safari ignores user-scalable=no; block its pinch-zoom gesture directly
document.addEventListener("gesturestart", (e) => e.preventDefault());

const viewer = new MuscleViewer($("#viewer"));
const health = new HealthView($("#health-view"));
const state = {
  mine: [], // ids of the user's exercises, in the order added
  exercises: new Set(), // selected (highlighted) exercise ids
  group: null, // selected muscle group id (muscles tab)
  tab: "exercises", // panel tab, sets the model's display: "volume" | "exercises" (Training) | "muscles"
  workoutFocus: null, // workout id whose trained muscles are shown on the model
};

// ---------- highlighting

/**
 * The model shows what the selected panel tab is about: volume = weekly-sets heatmap,
 * exercises (Training) = selected exercises or workout in red / orange, muscles = the selected group.
 */
function refresh() {
  const primary = new Set();
  const secondary = new Set();
  const focus = state.tab === "exercises" && state.workoutFocus && workoutMuscles(trainingLog.doc, state.workoutFocus, exerciseById);
  if (focus) {
    focus.primary.forEach((g) => primary.add(g));
    focus.secondary.forEach((g) => secondary.add(g));
  } else if (state.tab === "muscles") {
    if (state.group) primary.add(state.group);
  } else if (state.tab === "exercises") {
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
  document.querySelectorAll("#group-list li").forEach((li) => li.classList.toggle("active", li.dataset.id === state.group));
  $("#legend-highlight").hidden = state.tab === "volume";
  $("#legend-volume").hidden = state.tab !== "volume";
  if (state.tab === "volume") showVolume();
  else {
    viewer.setGroupColors(null);
    if (focus) showWorkoutSummary(focus);
    else showSummary(primary, secondary);
  }
}

/** Select a panel tab; the model's display follows it (see refresh). */
function selectTab(name) {
  state.tab = name;
  document.querySelectorAll(".tabs [role=tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  document.querySelectorAll("[data-tab-body]").forEach((b) => (b.hidden = b.dataset.tabBody !== name));
  viewer.setSelected(null);
  refresh();
}

/** Show which muscles a workout trained: highlight on the model + sets per muscle group. */
function showWorkoutMuscles(workoutId) {
  state.exercises.clear();
  state.workoutFocus = workoutId;
  selectTab("exercises");
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
  if (state.tab === "muscles" && state.group) {
    const g = groupById.get(state.group);
    const trainedBy = EXERCISES.filter((e) => e.primary.includes(g.id) || e.secondary.includes(g.id));
    info.innerHTML = `<strong>${g.label}</strong>
      <div class="muted">Trained by: ${trainedBy.map((e) => e.name).join(", ") || "—"}</div>`;
    info.hidden = false;
  } else if (state.tab === "exercises" && state.exercises.size) {
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
  workoutView.render(); // renderMyExercises -> refresh() already redraws the volume heatmap
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

// ---------- health data (health/whoop.json + health/polar.json in the data repo), cached for offline use

const HEALTH_CACHE_KEY = "fa.health";

async function loadHealth(cfg) {
  try {
    const docs = await Promise.all(
      ["health/whoop.json", "health/polar.json"].map((path) => new GitHubStore({ ...cfg, path }).loadRaw()),
    );
    const doc = mergeHealthDocs(docs);
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

// ---------- three sections, switched in the app bar: health (dashboard, default) / exercise (3D model + panel) /
// today (daily check-in)

const VIEWS = ["health", "exercise", "today"];

function showView(view) {
  document.body.dataset.view = view;
  $("#health-view").hidden = view !== "health";
  $("#checkin").hidden = view !== "today";
  document.querySelectorAll("[data-show]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.show === view)));
  if (view === "health") health.render();
  else if (view === "today") checkin.render(); // its charts are sized from the page, so draw once visible
  else updateInsets(); // the stage was hidden: fit the model now that it has a size
  writeHash();
}

document.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.show)));

// phone: the panel can take the whole screen (remembered per device)
function setPanelExpanded(on) {
  document.body.classList.toggle("panel-expanded", on);
  const btn = $("#panel-expand");
  btn.setAttribute("aria-pressed", String(on)); // the CSS swaps the expand / collapse icon
  btn.title = btn.ariaLabel = on ? "Show model" : "Expand panel";
  try { localStorage.setItem("panelExpanded", on ? "1" : ""); } catch {}
}
$("#panel-expand").addEventListener("click", () => setPanelExpanded(!document.body.classList.contains("panel-expanded")));
try { setPanelExpanded(localStorage.getItem("panelExpanded") === "1"); } catch { setPanelExpanded(false); }

const primaryLabels = (e) => e.primary.map((g) => groupById.get(g)?.label ?? g).join(" · ");

function renderMyExercises() {
  const mine = state.mine.map((id) => exerciseById.get(id));
  $("#my-count").textContent = mine.length ? `(${mine.length})` : "";
  // nothing to fold yet: show the search; folds again once exercises arrive (e.g. from sync)
  const fold = $("#my-exercises-section");
  if (!mine.length) fold.open = fold.dataset.autoOpen = true;
  else if (fold.dataset.autoOpen) { fold.open = false; delete fold.dataset.autoOpen; }
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
  state.workoutFocus = null;
  state.exercises.has(id) ? state.exercises.delete(id) : state.exercises.add(id);
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
  state.exercises.clear(); // Training's selection only; the Muscles tab keeps its own
  viewer.setSelected(null);
  refresh();
});

// ---------- muscles tab

// a plain list per body region; tap a group to show it on the model, tap again to clear
$("#group-list").innerHTML = REGIONS.map((r) => `
  <h3>${r.label}</h3>
  <ul class="list">${MUSCLE_GROUPS.filter((g) => g.region === r.id)
    .map((g) => `<li data-id="${g.id}"><span class="li-text">${g.label}</span></li>`).join("")}</ul>`).join("");

$("#group-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  state.group = state.group === li.dataset.id ? null : li.dataset.id;
  viewer.setSelected(null);
  refresh();
});

// ---------- tabs

// the panel's own tabs only; the Health / Exercise switch in the app bar is a tablist too
document.querySelectorAll(".tabs [role=tab]").forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));

// ---------- toolbar

// keep the model clear of the legend and info box floating over the stage
function updateInsets() {
  const stage = $(".stage").getBoundingClientRect();
  // only overlays over the middle third count (where the body is); a legend at the left edge does not
  const mid = stage.left + stage.width / 2;
  const covers = (el) => {
    if (el.hidden || el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.left < mid + stage.width / 6 && r.right > mid - stage.width / 6;
  };
  const top = Math.max(0, ...[".stage-tools", "#legend-highlight", "#legend-volume"]
    .map((s) => $(s)).filter(covers).map((el) => el.getBoundingClientRect().bottom - stage.top));
  const info = $("#info");
  const bottom = covers(info) ? stage.bottom - info.getBoundingClientRect().top : 0;
  viewer.setInsets(top + 6, bottom + 6);
}
const insetObserver = new ResizeObserver(updateInsets);
[".stage", ".stage-tools", "#info", "#legend-highlight", "#legend-volume"].forEach((s) => insetObserver.observe($(s)));

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

// ---------- weekly volume (Volume tab): muscles colored by hard sets in the last 7 days

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

  // summary in the tab (not over the model): sets per trained group, and targeted groups below 10 sets
  const fmt = (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
  const trained = [...sets].filter(([, n]) => n >= 0.5).sort((a, b) => b[1] - a[1]);
  const targeted = new Set(state.mine.flatMap((id) => exerciseById.get(id).primary));
  const below = [...targeted].filter((g) => (sets.get(g) ?? 0) < VOLUME_TARGET[0]);
  const colors = volumeColors(sets);
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  const box = $("#volume-summary");
  box.replaceChildren(
    el("p", { className: "hint", textContent: trained.length
      ? "Hard sets per muscle group, last 7 days. Secondary muscles count half a set; target 10–20 per week."
      : "No sets logged in the last 7 days." }),
    el("ul", { className: "list vol-list" }, ...trained.map(([g, n]) => {
      const sw = el("i", { className: "swatch" });
      sw.style.background = colors.get(g) ?? "var(--chip)";
      return el("li", {}, sw, el("span", { className: "li-text", textContent: groupById.get(g)?.label ?? g }), el("span", { className: "vol-n", textContent: `${fmt(n)} sets` }));
    })),
  );
  if (below.length) {
    box.append(el("h3", { className: "vol-h", textContent: `Below ${VOLUME_TARGET[0]} sets` }),
      el("p", { className: "hint", textContent: below.map((g) => groupById.get(g)?.label ?? g).join(", ") }));
  }
  $("#info").hidden = true;
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
  if (state.tab === "muscles" && state.group) params.set("group", state.group);
  else if (state.tab === "exercises" && state.exercises.size) params.set("ex", [...state.exercises].join(","));
  if (!viewer.xray) params.set("xray", "0"); // x-ray is the default
  if (state.tab !== "exercises") params.set("tab", state.tab); // Training is the default tab
  if (document.body.dataset.view !== "health") params.set("view", document.body.dataset.view); // health is the default
  const hash = params.toString().replaceAll("%2C", ",");
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.exercises = new Set((params.get("ex") ?? "").split(",").filter((id) => state.mine.includes(id)));
  state.group = groupById.has(params.get("group")) ? params.get("group") : null;
  if (params.get("xray") === "0") {
    viewer.setXray(false);
    $("#toggle-xray").setAttribute("aria-pressed", "false");
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

// appearance (in the settings dialog): System / Light / Dark; charts and muscle colors follow on change
$("#theme-mode").value = getThemeMode();
$("#theme-mode").addEventListener("change", (e) => setThemeMode(e.target.value));
addEventListener("themechange", () => {
  if (state.tab === "volume") showVolume();
  if (document.body.dataset.view === "health") health.render();
  if (document.body.dataset.view === "today") checkin.render();
});
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

const startParams = new URLSearchParams(location.hash.slice(1)); // read before the hash is rewritten
// panel tab from the link (older links: #volume=1 meant the heatmap, #group= the muscles list)
const startTab = ["volume", "exercises", "muscles"].includes(startParams.get("tab")) ? startParams.get("tab")
  : startParams.get("volume") === "1" ? "volume" : startParams.has("group") ? "muscles" : "exercises";
// health unless the link asks for another section (the old "body" view and a selection on the model mean exercise)
const startView = startParams.get("view") === "body" || ["ex", "group", "volume", "tab"].some((k) => startParams.has(k))
  ? "exercise"
  : VIEWS.includes(startParams.get("view")) ? startParams.get("view") : "health";
state.mine = profile.doc.myExercises;
readHash();
selectTab(startTab);
showView(startView);
renderMyExercises();
health.setJournal(journal.doc);
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
// after everything has loaded, make sure no file is a stale cached copy from before a deploy
window.addEventListener("load", () => setTimeout(() => checkForUpdate().catch(() => {}), 1500));
// phones keep the app open in the background for days: check again when it comes back
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForUpdate().catch(() => {});
});

viewer
  .load("assets/models/muscles.glb", "assets/models/skeleton.glb", (p) => ($("#loading-fill").style.width = `${Math.round(p * 100)}%`))
  .then(() => $("#loading").remove())
  .catch((err) => {
    console.error(err);
    $("#loading").innerHTML = `<span>Could not load the 3D model: ${err.message}</span>`;
  });
