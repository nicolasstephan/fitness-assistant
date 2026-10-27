// Sports (other activities besides strength workouts) -> muscle groups, like exercises.js.
// tracker: activity names a tracker gives these sports (WHOOP labels, Polar sport names), lowercase.

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
];

export const sportById = new Map(SPORTS.map((s) => [s.id, s]));

/** The sport a tracker workout names, or null ("Other indoor", "Activity", "Walking" ...). */
export const sportOfTracker = (activity) => {
  const a = (activity ?? "").toLowerCase();
  return SPORTS.find((s) => s.tracker.includes(a)) ?? null;
};
