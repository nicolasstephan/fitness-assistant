// Weekly training volume per muscle group from the strength log.
// A set counts fully for the exercise's primary groups and half for its secondary groups.

const DAY = 86400000;

export const VOLUME_TARGET = [10, 20]; // hard sets per muscle group per week (common hypertrophy guideline)

/** Sets per muscle group over the `days` days ending at `endDate` (inclusive). */
export function weeklySets(log, exerciseById, endDate, days = 7) {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const start = end - (days - 1) * DAY;
  const sets = new Map();
  const add = (g, n) => sets.set(g, (sets.get(g) ?? 0) + n);
  for (const s of log.sessions) {
    const t = Date.parse(`${s.date}T00:00:00Z`);
    const ex = exerciseById.get(s.exercise);
    if (!ex || t < start || t > end) continue;
    const n = s.sets.length;
    ex.primary.forEach((g) => add(g, n));
    ex.secondary.forEach((g) => add(g, n / 2));
  }
  return sets;
}

/** Ordinal bins; colors come from --vol-1..4 (validated per light/dark mode). */
export const VOLUME_BINS = [
  { min: 0.5, label: "1–4 sets", token: "--vol-1" },
  { min: 5, label: "5–9 sets", token: "--vol-2" },
  { min: 10, label: "10–20 sets (target)", token: "--vol-3" },
  { min: 20.5, label: "over 20 sets", token: "--vol-4" },
];

export function volumeColors(sets) {
  const css = getComputedStyle(document.documentElement);
  const colors = new Map();
  for (const [g, n] of sets) {
    const bin = [...VOLUME_BINS].reverse().find((b) => n >= b.min);
    if (bin) colors.set(g, css.getPropertyValue(bin.token).trim());
  }
  return colors;
}
