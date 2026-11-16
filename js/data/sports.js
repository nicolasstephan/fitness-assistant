// Other activities besides strength workouts -> muscle groups, like exercises.js.
// tracker: activity names a tracker gives these activities (WHOOP labels, Polar sport names), lowercase.
// autoStopMin: a recording stops by itself after this many minutes (changeable per recording; 0/absent = off).
// rest: a resting session (no muscles, not a workout in the Health view); compared with heart rate instead.
// pace: a breathing guide while it records, [[label, seconds, "in" | "out"], ...] repeated from the start.

export const SPORTS = [
  {
    id: "boxing",
    name: "Boxing",
    // punches drive from the legs through the trunk rotation into the shoulders; footwork on the balls of the feet
    primary: ["delts_front", "delts_side", "triceps", "chest", "serratus", "obliques", "calves"],
    secondary: ["rotator_cuff", "lats", "abs", "transverse_abs", "quads", "glutes", "hip_rotators", "traps_upper", "forearm_flexors"],
    tracker: ["boxing", "kickboxing", "martial arts"],
  },
  {
    id: "skateboarding",
    name: "Skateboarding",
    // street: pushing, ollie pop (calves, shins), flick and catch (ankle work), landing and balance
    primary: ["quads", "glutes", "calves", "shins", "hip_flexors"],
    secondary: ["hamstrings", "adductors", "abductors", "hip_rotators", "abs", "obliques", "transverse_abs", "erectors"],
    tracker: ["skateboarding"],
  },
  {
    id: "running",
    name: "Running",
    primary: ["quads", "hamstrings", "glutes", "calves"],
    secondary: ["hip_flexors", "abductors", "shins", "abs"],
    tracker: ["running", "road running", "trail running", "treadmill running", "jogging"],
  },
  {
    id: "surfing",
    name: "Indoor surfing",
    // standing wave / wave pool: no paddling; riding in a low stance, balance and turns from the legs and trunk
    primary: ["quads", "glutes", "calves", "abs", "obliques", "transverse_abs"],
    secondary: ["hamstrings", "adductors", "abductors", "hip_rotators", "shins", "erectors", "delts_side"],
    tracker: ["surfing", "indoor surfing"],
  },
  {
    id: "tens",
    name: "Vagus nerve stimulation",
    short: "TENS",
    // transcutaneous (ear / neck) stimulation with a TENS unit; judged by heart rate during and after
    primary: [],
    secondary: [],
    tracker: [],
    rest: true,
    autoStopMin: 45,
    evidence: "weak", // how well studied for stress and anxiety (info.js has the one-line reason)
  },
  {
    id: "meditation",
    name: "Meditation",
    primary: [],
    secondary: [],
    tracker: ["meditation", "mindfulness", "breathing exercise", "breathwork"],
    rest: true,
    evidence: "strong",
  },
  {
    // Balban et al. 2023: double inhale through the nose, long exhale through the mouth, 5 min a day
    id: "sighing",
    name: "Cyclic sighing",
    short: "Sighing",
    primary: [],
    secondary: [],
    tracker: [],
    rest: true,
    autoStopMin: 5,
    evidence: "moderate",
    pace: [["Breathe in", 2, "in"], ["In a little more", 1, "in"], ["Breathe out slowly", 6, "out"]],
  },
  {
    // slow paced breathing near the resonance frequency (HRV biofeedback without the feedback): 6 per minute
    id: "resonance",
    name: "Resonance breathing",
    short: "Resonance",
    primary: [],
    secondary: [],
    tracker: [],
    rest: true,
    autoStopMin: 10,
    evidence: "moderate–good",
    pace: [["Breathe in", 4, "in"], ["Breathe out", 6, "out"]],
  },
];

export const sportById = new Map(SPORTS.map((s) => [s.id, s]));

/** The sport a tracker workout names, or null ("Other indoor", "Activity", "Walking" ...). */
export const sportOfTracker = (activity) => {
  const a = (activity ?? "").toLowerCase();
  return SPORTS.find((s) => s.tracker.includes(a)) ?? null;
};
