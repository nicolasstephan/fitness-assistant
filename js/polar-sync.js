// Starts the "Polar sync" GitHub Action in the data repo (.github/workflows/polar-sync.yml) and waits for it.
// The token needs "Actions: Read and write" on that repo, besides "Contents: Read and write".

const API = "https://api.github.com";
const WORKFLOW = "polar-sync.yml";
const POLL_MS = 5000;
const TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(cfg, method, path, body) {
  const res = await fetch(`${API}/repos/${cfg.repo}/actions/workflows/${WORKFLOW}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token.trim()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.ok) return res.status === 204 ? null : res.json();
  if (res.status === 401) throw new Error("Token invalid or expired");
  if (res.status === 403) throw new Error("Token needs “Actions: Read and write”");
  if (res.status === 404) throw new Error("No Polar sync workflow in the data repo");
  throw new Error(`GitHub error ${res.status}`);
}

/** The newest run, or null. */
async function latestRun(cfg) {
  const { workflow_runs: runs } = await gh(cfg, "GET", "/runs?per_page=1");
  return runs[0] ?? null;
}

/**
 * Runs the sync (or joins one that is already running, e.g. started by another device) and resolves
 * once it has finished. Rejects with a readable message.
 */
export async function runPolarSync(cfg) {
  const started = Date.now();
  let run = await latestRun(cfg);
  if (!run || run.status === "completed") {
    await gh(cfg, "POST", "/dispatches", { ref: "main" });
    run = null;
  }
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(POLL_MS);
    const r = await latestRun(cfg);
    // the dispatched run shows up a few seconds later; until then the latest one is an older, finished run
    if (!run && (!r || Date.parse(r.created_at) < started - 30_000)) continue;
    run = r;
    if (run.status === "completed") {
      if (run.conclusion !== "success") throw new Error(`Polar sync ${run.conclusion}`);
      return;
    }
  }
  throw new Error("Polar sync takes too long");
}
