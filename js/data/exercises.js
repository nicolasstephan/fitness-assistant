// Exercise -> muscle groups (ids from muscle-groups.js). Primary = main movers, secondary = assisting/stabilising.

export const EXERCISES = [
  // push
  { id: "push_up", name: "Push-up", primary: ["chest", "chest_upper", "delts_front", "triceps"], secondary: ["serratus", "abs", "obliques", "transverse_abs"] },
  { id: "bench_press", name: "Bench press", primary: ["chest", "delts_front", "triceps"], secondary: ["chest_upper", "serratus"] },
  { id: "incline_bench", name: "Incline bench press", primary: ["chest_upper", "delts_front"], secondary: ["chest", "triceps", "serratus"] },
  { id: "dips", name: "Dips", primary: ["chest", "triceps"], secondary: ["delts_front", "pec_minor", "chest_upper"] },
  { id: "overhead_press", name: "Overhead press", primary: ["delts_front", "delts_side", "triceps"], secondary: ["traps_upper", "serratus", "chest_upper", "abs"] },
  { id: "lateral_raise", name: "Lateral raise", primary: ["delts_side"], secondary: ["traps_upper", "delts_front"] },
  { id: "triceps_pushdown", name: "Triceps pushdown", primary: ["triceps"], secondary: ["forearm_flexors"] },

  // pull
  { id: "pull_up", name: "Pull-up", primary: ["lats", "biceps"], secondary: ["brachialis", "brachioradialis", "rhomboids", "traps_lower", "delts_rear", "forearm_flexors", "abs"] },
  { id: "chin_up", name: "Chin-up", primary: ["lats", "biceps"], secondary: ["brachialis", "chest", "rhomboids", "traps_lower", "delts_rear", "forearm_flexors", "abs"] },
  { id: "barbell_row", name: "Barbell row", primary: ["lats", "rhomboids", "traps_middle", "delts_rear"], secondary: ["biceps", "brachialis", "erectors", "forearm_flexors", "hamstrings"] },
  { id: "face_pull", name: "Face pull", primary: ["delts_rear", "rotator_cuff", "traps_middle"], secondary: ["rhomboids", "traps_lower"] },
  { id: "shrug", name: "Shrug", primary: ["traps_upper"], secondary: ["forearm_flexors", "traps_middle"] },
  { id: "biceps_curl", name: "Biceps curl", primary: ["biceps", "brachialis"], secondary: ["brachioradialis", "forearm_flexors"] },
  { id: "hammer_curl", name: "Hammer curl", primary: ["brachioradialis", "brachialis"], secondary: ["biceps", "forearm_extensors"] },

  // legs
  { id: "squat", name: "Squat", primary: ["quads", "glutes"], secondary: ["adductors", "hamstrings", "erectors", "calves", "abs"] },
  { id: "deadlift", name: "Deadlift", primary: ["glutes", "hamstrings", "erectors"], secondary: ["quads", "adductors", "traps_upper", "traps_middle", "lats", "forearm_flexors"] },
  { id: "romanian_deadlift", name: "Romanian deadlift", primary: ["hamstrings", "glutes"], secondary: ["erectors", "adductors", "forearm_flexors"] },
  { id: "lunge", name: "Lunge", primary: ["quads", "glutes"], secondary: ["hamstrings", "adductors", "abductors", "calves"] },
  { id: "hip_thrust", name: "Hip thrust", primary: ["glutes"], secondary: ["hamstrings", "abductors", "quads"] },
  { id: "leg_extension", name: "Leg extension", primary: ["quads"], secondary: [] },
  { id: "leg_curl", name: "Leg curl", primary: ["hamstrings"], secondary: ["calves"] },
  { id: "calf_raise", name: "Calf raise", primary: ["calves"], secondary: [] },

  // core
  { id: "plank", name: "Plank", primary: ["abs", "transverse_abs"], secondary: ["obliques", "delts_front", "glutes", "quads", "serratus"] },
  { id: "crunch", name: "Crunch", primary: ["abs"], secondary: ["obliques"] },
  { id: "hanging_leg_raise", name: "Hanging leg raise", primary: ["abs", "hip_flexors"], secondary: ["obliques", "forearm_flexors", "lats"] },
  { id: "russian_twist", name: "Russian twist", primary: ["obliques"], secondary: ["abs", "hip_flexors"] },

  // cardio
  { id: "running", name: "Running", primary: ["quads", "hamstrings", "glutes", "calves"], secondary: ["hip_flexors", "abductors", "shins", "abs"] },
  { id: "cycling", name: "Cycling", primary: ["quads", "glutes"], secondary: ["hamstrings", "calves", "hip_flexors"] },
  { id: "rowing_machine", name: "Rowing machine", primary: ["lats", "quads", "glutes", "rhomboids"], secondary: ["hamstrings", "biceps", "erectors", "delts_rear", "traps_middle"] },
];
