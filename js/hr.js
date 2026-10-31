// Heart rate around resting sessions (vagus nerve stimulation, meditation): the Polar Loop's continuous heart rate,
// stored by tools/polar.py as minute means per day (imports/polar/hr/YYYY-MM-DD.json: { date, hr: [[minute, bpm]] }).
// At rest the Loop samples every 5 minutes; while a workout runs on the Loop, every second.

const CACHE_KEY = "fa.hrDays"; // finished days only: { date: [[minute, bpm]] }
const CACHE_DAYS = 120;
export const BEFORE_MIN = 20; // baseline: the 20 minutes before the start
export const AFTER_MIN = 30; // after: the 30 minutes after the end
const toMinutes = (local) => Date.parse(`${local}:00Z`) / 60000; // local wall-clock minutes, compared consistently
const dayOf = (minutes) => new Date(minutes * 60000).toISOString().slice(0, 10);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export class MinuteHr {
  constructor() {
    this.days = new Map(); // date -> Map(absolute minute -> bpm) | null (no file)
    this.loading = new Map();
    this.fetchedAt = new Map(); // date -> ms of the last fetch
    this.fetchDay = null; // (date) => Promise<json | null>, set while connected
    try {
      for (const [date, hr] of Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {})) this.days.set(date, this.index(date, hr));
    } catch {}
  }

  index(date, pairs) {
    const base = toMinutes(`${date}T00:00`);
    return new Map(pairs.map(([m, v]) => [base + m, v]));
  }

  /** Load the days these sessions touch (with the before / after windows); resolves true if anything new came in. */
  async load(sessions, today) {
    if (!this.fetchDay) return false;
    const want = new Set();
    for (const a of sessions) {
      want.add(dayOf(toMinutes(a.start) - BEFORE_MIN));
      want.add(dayOf(toMinutes(a.end) + AFTER_MIN));
    }
    // today (and yesterday, whose evening may still be syncing) are fetched again on each load
    // (at most every 10 minutes), as are recent days without a file yet
    const recent = (d) => d >= today || (this.days.get(d) === null && d >= dayOf(toMinutes(`${today}T00:00`) - 3 * 1440));
    const stale = (d) => Date.now() - (this.fetchedAt.get(d) ?? 0) > 10 * 60000;
    const todo = [...want].filter((d) => !this.days.has(d) || (recent(d) && stale(d)));
    if (!todo.length) return false;
    const results = await Promise.all(todo.map((d) => this.fetchOne(d)));
    this.save(today);
    return results.some(Boolean);
  }

  async fetchOne(date) {
    if (!this.loading.has(date)) {
      this.loading.set(date, (async () => {
        try {
          this.fetchedAt.set(date, Date.now());
          const doc = await this.fetchDay(date);
          const before = this.days.get(date)?.size ?? -1;
          this.days.set(date, doc?.hr?.length ? this.index(date, doc.hr) : null);
          return (this.days.get(date)?.size ?? -1) !== before;
        } catch {
          return false;
        } finally {
          this.loading.delete(date);
        }
      })());
    }
    return this.loading.get(date);
  }

  save(today) {
    const out = {};
    const dates = [...this.days.keys()].filter((d) => d < today && this.days.get(d)).sort().slice(-CACHE_DAYS);
    for (const d of dates) {
      const base = toMinutes(`${d}T00:00`);
      out[d] = [...this.days.get(d)].map(([m, v]) => [m - base, v]);
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(out)); } catch {}
  }

  /** bpm values in [from, to) (absolute local minutes). */
  values(from, to) {
    const out = [];
    for (let m = from; m < to; m++) {
      const v = this.days.get(dayOf(m))?.get(m);
      if (v != null) out.push({ m, v });
    }
    return out;
  }

  /**
   * One session against its own baseline: mean HR in the 20 min before, during, and in the 30 min after; deltas
   * vs. before; curve = per-minute HR minus the baseline from 20 min before the start to 30 min after the end.
   * Null without a baseline and at least one value during the session.
   */
  session(a) {
    const s = toMinutes(a.start), e = toMinutes(a.end);
    const pre = this.values(s - BEFORE_MIN, s), during = this.values(s, e), post = this.values(e, e + AFTER_MIN);
    if (!pre.length || !during.length) return null;
    const before = mean(pre.map((p) => p.v));
    const avg = (ps) => (ps.length ? mean(ps.map((p) => p.v)) : null);
    const min = Math.min(...during.map((p) => p.v));
    return {
      before, during: avg(during), after: avg(post), min,
      dDuring: avg(during) - before, dAfter: post.length ? avg(post) - before : null,
      samples: during.length, minutes: e - s,
      curve: [...pre, ...during, ...post].map((p) => ({ m: p.m - s, v: p.v - before })),
    };
  }
}

const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v))}`;

/** One line for a session row: "HR 68 before → 62 during (−6) · 64 after (−4)". */
export function describeHr(r) {
  if (!r) return null;
  return `HR ${Math.round(r.before)} before → ${Math.round(r.during)} during (${signed(r.dDuring)})`
    + (r.after != null ? ` · ${Math.round(r.after)} after (${signed(r.dAfter)})` : "");
}
