// Training-oriented muscle groups. `muscles` are Z-Anatomy object names without the .l/.r side suffix
// (stored as `userData.muscle` on every mesh in assets/models/muscles.glb).

export const REGIONS = [
  { id: "chest", label: "Chest" },
  { id: "shoulders", label: "Shoulders" },
  { id: "back", label: "Back" },
  { id: "arms", label: "Arms" },
  { id: "core", label: "Core" },
  { id: "hips", label: "Hips & Glutes" },
  { id: "legs", label: "Legs" },
  { id: "neck", label: "Neck" },
];

export const MUSCLE_GROUPS = [
  // chest
  { id: "chest_upper", region: "chest", label: "Upper chest", muscles: ["Clavicular head of pectoralis major muscle"] },
  {
    id: "chest", region: "chest", label: "Chest (pectoralis major)",
    muscles: ["Sternocostal head of pectoralis major muscle", "(Abdominal part of pectoralis major muscle)"],
  },
  { id: "pec_minor", region: "chest", label: "Pectoralis minor", muscles: ["Pectoralis minor muscle", "Subclavius muscle"] },
  { id: "serratus", region: "chest", label: "Serratus anterior", muscles: ["Serratus anterior muscle"] },

  // shoulders
  { id: "delts_front", region: "shoulders", label: "Front delts", muscles: ["Clavicular part of deltoid muscle"] },
  { id: "delts_side", region: "shoulders", label: "Side delts", muscles: ["Acromial part of deltoid muscle"] },
  { id: "delts_rear", region: "shoulders", label: "Rear delts", muscles: ["Scapular spinal part of deltoid muscle"] },
  {
    id: "rotator_cuff", region: "shoulders", label: "Rotator cuff",
    muscles: ["Supraspinatus muscle", "Infraspinatus muscle", "Teres minor muscle", "Subscapularis muscle"],
  },

  // back
  { id: "traps_upper", region: "back", label: "Upper traps", muscles: ["Descending part of trapezius muscle", "Levator scapulae"] },
  { id: "traps_middle", region: "back", label: "Middle traps", muscles: ["Transverse part of trapezius muscle"] },
  { id: "traps_lower", region: "back", label: "Lower traps", muscles: ["Ascending part of trapezius muscle"] },
  { id: "rhomboids", region: "back", label: "Rhomboids", muscles: ["Rhomboid major muscle", "Rhomboid minor muscle"] },
  { id: "lats", region: "back", label: "Lats", muscles: ["Latissimus dorsi muscle", "Teres major muscle"] },
  {
    id: "erectors", region: "back", label: "Lower back (erector spinae)",
    muscles: [
      "Iliocostalis lumborum muscle", "Iliocostalis thoracis muscle", "Iliocostalis colli muscle",
      "Longissimus thoracis muscle", "Longissimus colli muscle", "Longissimus capitis muscle",
      "Spinalis thoracis muscle", "Spinalis colli muscle", "Spinalis capitis muscle",
      "Multifidus lumborum muscle", "Multifidus thoracis muscle", "Multifidus colli muscle",
      "Semispinalis thoracis muscle", "Semispinalis colli muscle", "Rotatores",
      "Quadratus lumborum muscle",
      "Serratus posterior inferior muscle", "Serratus posterior superior muscle",
    ],
  },

  // arms
  { id: "biceps", region: "arms", label: "Biceps", muscles: ["Long head of biceps brachii", "Short head of biceps brachii", "Coracobrachialis muscle"] },
  { id: "brachialis", region: "arms", label: "Brachialis", muscles: ["Brachialis muscle"] },
  {
    id: "triceps", region: "arms", label: "Triceps",
    muscles: ["Long head of triceps brachii", "Lateral head of triceps brachii", "Medial head of triceps brachii", "Anconeus muscle"],
  },
  { id: "brachioradialis", region: "arms", label: "Brachioradialis", muscles: ["Brachioradialis muscle"] },
  {
    id: "forearm_flexors", region: "arms", label: "Forearm flexors (grip)",
    muscles: [
      "Superficial head of pronator teres", "Deep head of pronator teres",
      "Humeral head of flexor carpi ulnaris", "Ulnar head of flexor carpi ulnaris",
      "Humero-ulnar head of flexor digitorum superficialis", "Radial head of flexor digitorum superficialis",
      "Flexor carpi radialis", "Palmaris longus muscle", "Flexor digitorum profundus",
      "Flexor pollicis longus", "Pronator quadratus",
    ],
  },
  {
    id: "forearm_extensors", region: "arms", label: "Forearm extensors",
    muscles: [
      "Extensor digitorum", "Ulnar head of extensor carpi ulnaris", "Humeral head of extensor carpi ulnaris",
      "Extensor carpi radialis longus", "Extensor carpi radialis brevis", "Extensor digiti minimi",
      "Supinator", "Abductor pollicis longus", "Extensor indicis", "Extensor pollicis brevis", "Extensor pollicis longus",
    ],
  },

  // core
  { id: "abs", region: "core", label: "Abs (rectus abdominis)", muscles: ["Rectus abdominis muscle", "Pyramidalis muscle"] },
  { id: "obliques", region: "core", label: "Obliques", muscles: ["External abdominal oblique muscle", "Internal abdominal oblique muscle"] },
  { id: "transverse_abs", region: "core", label: "Transverse abdominis", muscles: ["Transversus abdominis muscle"] },
  {
    id: "intercostals", region: "core", label: "Intercostals",
    muscles: ["External intercostal muscles", "Levatores longi costarum", "Levatores breves costarum"],
  },

  // hips
  { id: "glutes", region: "hips", label: "Gluteus maximus", muscles: ["Gluteus maximus muscle"] },
  { id: "abductors", region: "hips", label: "Hip abductors (glute med/min, TFL)", muscles: ["Gluteus medius muscle", "Gluteus minimus muscle", "Tensor fasciae latae", "Iliotibial tract"] },
  { id: "hip_flexors", region: "hips", label: "Hip flexors", muscles: ["Iliacus muscle", "Psoas major", "Sartorius muscle"] },
  {
    id: "hip_rotators", region: "hips", label: "Deep hip rotators",
    muscles: ["Piriformis muscle", "Quadratus femoris muscle", "Superior gemellus muscle", "Inferior gemellus muscle", "Obturator internus", "Obturator externus"],
  },
  {
    id: "adductors", region: "hips", label: "Adductors",
    muscles: ["Adductor magnus", "Adductor longus", "Adductor brevis", "(Adductor minimus)", "Pectineus muscle", "Gracilis muscle"],
  },

  // legs
  {
    id: "quads", region: "legs", label: "Quadriceps",
    muscles: ["Rectus femoris muscle", "Vastus lateralis muscle", "Vastus medialis muscle", "Vastus intermedius muscle"],
  },
  {
    id: "hamstrings", region: "legs", label: "Hamstrings",
    muscles: ["Long head of biceps femoris", "Short head of biceps femoris", "Semimembranosus muscle", "Semitendinosus muscle"],
  },
  {
    id: "calves", region: "legs", label: "Calves",
    muscles: [
      "Lateral head of gastrocnemius", "Medial head of gastrocnemius", "Soleus muscle", "Plantaris muscle", "Calcaneal tendon",
      "Tibialis posterior muscle", "Flexor digitorum longus", "Flexor hallucis longus", "Popliteus muscle",
    ],
  },
  {
    id: "shins", region: "legs", label: "Shins & peroneals",
    muscles: [
      "Tibialis anterior muscle", "Extensor digitorum longus", "Tendon of extensor digitorum longus", "Extensor hallucis longus",
      "Fibularis tertius muscle", "Fibularis longus muscle", "Fibularis brevis muscle",
    ],
  },

  // neck
  {
    id: "neck", region: "neck", label: "Neck",
    muscles: [
      "Sternocleidomastoid muscle", "Splenius capitis muscle", "Splenius colli muscle",
      "Scalenus anterior muscle", "Scalenus medius muscle", "Scalenus posterior muscle",
      "Longus capitis muscle", "Longus colli muscle",
    ],
  },
];

const byMuscle = new Map();
for (const g of MUSCLE_GROUPS) for (const m of g.muscles) byMuscle.set(m, g);

export const groupById = new Map(MUSCLE_GROUPS.map((g) => [g.id, g]));

/** Muscle group for a Z-Anatomy muscle name, or undefined for muscles not used in training views. */
export function groupForMuscle(name) {
  return byMuscle.get(name);
}
