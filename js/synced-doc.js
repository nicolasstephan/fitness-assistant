// A JSON document cached in localStorage and, once connected, synced to a file in the private GitHub repo.
import { GitHubStore } from "./github-store.js";

export function readLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode): data lives for this session only
  }
}

export class SyncedDoc {
  /**
   * key/dirtyKey: localStorage keys for the cached doc and the "has unpushed changes" flag.
   * path: file in the repo. normalize(raw|null) -> valid doc (also migrates old formats).
   * merge(remote, local) -> doc, used when local changes must not be lost.
   */
  constructor({ key, dirtyKey, path, normalize, merge, message }) {
    Object.assign(this, { key, dirtyKey, path, normalize, merge, message });
    this.doc = normalize(readLocal(key, null));
    this.store = null;
    this.timer = null;
    this.onChange = () => {};
    this.onStatus = () => {}; // (state: "ok" | "saving" | "error", message?)
  }

  /** Load from GitHub. Unsynced local changes (or `merge` on first connect) are merged into the remote doc. */
  async connect(cfg, { merge = false } = {}) {
    this.store = new GitHubStore({ ...cfg, path: this.path });
    const raw = await this.store.load();
    const remote = raw ? this.normalize(raw) : null;
    const localWins = merge || readLocal(this.dirtyKey, false);
    const next = !remote ? this.doc : localWins ? this.merge(remote, this.doc) : remote;
    const changed = !remote || JSON.stringify(next) !== JSON.stringify(remote);
    this.doc = next;
    writeLocal(this.key, next);
    this.onChange(next);
    if (changed) await this.push();
    else this.onStatus("ok");
  }

  update(doc) {
    this.doc = doc;
    writeLocal(this.key, doc);
    this.onChange(doc);
    if (!this.store) return;
    writeLocal(this.dirtyKey, true);
    clearTimeout(this.timer);
    this.onStatus("saving");
    this.timer = setTimeout(() => this.push(), 800);
  }

  async push() {
    try {
      await this.store.save({ ...this.doc, updatedAt: new Date().toISOString() }, this.message);
      writeLocal(this.dirtyKey, undefined);
      this.onStatus("ok");
    } catch (err) {
      this.onStatus("error", err.message);
    }
  }

  disconnect() {
    clearTimeout(this.timer);
    this.store = null;
    writeLocal(this.dirtyKey, undefined);
  }
}
