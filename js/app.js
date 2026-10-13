import { MuscleViewer } from "./viewer.js";
import { EXERCISES } from "./data/exercises.js";
import { MUSCLE_GROUPS, REGIONS, groupById } from "./data/muscle-groups.js";
import { GitHubStore } from "./github-store.js";

const $ = (sel) => document.querySelector(sel);

const viewer = new MuscleViewer($("#viewer"));
const state = {
  mine: [], // ids of the user's exercises, in the order added
  exercises: new Set(), // selected (highlighted) exercise ids
  group: null, // selected muscle group id (muscles tab)
};

// ---------- highlighting

function refresh() {
  const primary = new Set();
  const secondary = new Set();
  if (state.group) {
    primary.add(state.group);
  } else {
    for (const ex of EXERCISES.filter((e) => state.exercises.has(e.id))) {
      ex.primary.forEach((g) => primary.add(g));
      ex.secondary.forEach((g) => secondary.add(g));
    }
  }
  viewer.setHighlight([...primary], [...secondary]);
  writeHash();

  document.querySelectorAll("#exercise-list li").forEach((li) => li.classList.toggle("active", state.exercises.has(li.dataset.id)));
  document.querySelectorAll("#group-list .chip").forEach((c) => c.classList.toggle("active", c.dataset.id === state.group));
  showSummary(primary, secondary);
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

// ---------- my exercises: cached in this browser, synced to a private GitHub repo when connected

const STORAGE_KEY = "fa.myExercises";
const DIRTY_KEY = "fa.unsynced"; // local changes not yet pushed to GitHub
const SYNC_KEY = "fa.sync"; // { repo, token }
const exerciseById = new Map(EXERCISES.map((e) => [e.id, e]));
const validIds = (ids) => (Array.isArray(ids) ? ids.filter((id) => exerciseById.has(id)) : []);

function readLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode): data lives for this session only
  }
}

const loadMyExercises = () => validIds(readLocal(STORAGE_KEY, []));

function saveMyExercises() {
  writeLocal(STORAGE_KEY, state.mine);
  if (store) {
    writeLocal(DIRTY_KEY, true);
    scheduleSync();
  }
}

let store = null;
let syncTimer = null;

function setSyncStatus(text, kind = "") {
  const el = $("#sync-status");
  el.textContent = text;
  el.dataset.kind = kind;
}

function scheduleSync() {
  clearTimeout(syncTimer);
  setSyncStatus("Saving…");
  syncTimer = setTimeout(pushToGitHub, 800);
}

async function pushToGitHub() {
  try {
    await store.save({ version: 1, updatedAt: new Date().toISOString(), myExercises: state.mine }, "Update my exercises");
    writeLocal(DIRTY_KEY, undefined);
    setSyncStatus(`Synced to ${store.repo}`, "ok");
  } catch (err) {
    setSyncStatus(`Not synced: ${err.message}`, "error");
  }
}

/** Load from GitHub. Unsynced local changes (or a first connect with `merge`) are combined with the remote list. */
async function connectGitHub(cfg, { merge = false } = {}) {
  store = new GitHubStore(cfg);
  setSyncStatus("Loading from GitHub…");
  const remote = await store.load();
  const remoteIds = validIds(remote?.myExercises);
  const localWins = merge || readLocal(DIRTY_KEY, false);
  const ids = localWins ? [...new Set([...remoteIds, ...state.mine])] : remoteIds;
  state.mine = ids;
  readHash(); // the URL may select exercises that only the remote list contains
  writeLocal(STORAGE_KEY, ids);
  renderMyExercises();
  if (!remote || (localWins && ids.join() !== remoteIds.join())) await pushToGitHub();
  else setSyncStatus(`Synced to ${store.repo}`, "ok");
}

const primaryLabels = (e) => e.primary.map((g) => groupById.get(g)?.label ?? g).join(" · ");

function renderMyExercises() {
  const mine = state.mine.map((id) => exerciseById.get(id));
  $("#my-hint").textContent = mine.length
    ? "Tap exercises to see which muscles they train."
    : "No exercises yet. Search above and tap + to add one.";
  $("#exercise-list").innerHTML = mine
    .map((e) => `<li data-id="${e.id}">
      <div class="li-text"><span>${e.name}</span><small>${primaryLabels(e)}</small></div>
      <button class="icon-btn" data-remove="${e.id}" aria-label="Remove ${e.name}">×</button></li>`)
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
  state.group = state.group === chip.dataset.id ? null : chip.dataset.id;
  viewer.setSelected(null);
  refresh();
});

// ---------- tabs

document.querySelectorAll("[role=tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll("[role=tab]").forEach((t) => t.setAttribute("aria-selected", t === tab));
    document.querySelectorAll("[data-tab-body]").forEach((b) => (b.hidden = b.dataset.tabBody !== tab.dataset.tab));
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
  const hash = params.toString().replaceAll("%2C", ",");
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.exercises = new Set((params.get("ex") ?? "").split(",").filter((id) => state.mine.includes(id)));
  state.group = groupById.has(params.get("group")) ? params.get("group") : null;
  if (params.get("xray") === "1") {
    viewer.setXray(true);
    $("#toggle-xray").setAttribute("aria-pressed", "true");
  }
}

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
    store = null;
    $("#sync-error").textContent = err.message;
    setSyncStatus("This device only — tap to sync");
  } finally {
    submit.disabled = false;
  }
});

$("#sync-disconnect").addEventListener("click", () => {
  writeLocal(SYNC_KEY, undefined);
  writeLocal(DIRTY_KEY, undefined);
  store = null;
  setSyncStatus("This device only — tap to sync");
  dialog.close();
});

// ---------- boot

state.mine = loadMyExercises();
readHash();
renderMyExercises();
const syncCfg = readLocal(SYNC_KEY, null);
if (syncCfg) {
  connectGitHub(syncCfg).catch((err) => setSyncStatus(`Not synced: ${err.message}`, "error"));
} else {
  setSyncStatus("This device only — tap to sync");
}
viewer
  .load("assets/models/muscles.glb", "assets/models/skeleton.glb", (p) => ($("#loading-fill").style.width = `${Math.round(p * 100)}%`))
  .then(() => $("#loading").remove())
  .catch((err) => {
    console.error(err);
    $("#loading").innerHTML = `<span>Could not load the 3D model: ${err.message}</span>`;
  });
