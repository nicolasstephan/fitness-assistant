// "i" buttons on the Health values: where a measurement comes from and how to read it.
// INFO is keyed by tile label or card title; infoButton(key) returns null for keys without a text.

const INFO = {
  "Nightly Recharge": {
    source: "Polar Loop, measured over roughly the first 4 hours of sleep. It combines two parts, ANS charge and sleep charge, and compares each with your own usual level over the last 28 days.",
    read: "Six levels: very poor, poor, compromised, OK, good, very good. Good or very good means you recovered well and can train hard. Poor or very poor means take it easy: something (hard training, alcohol, a late meal, stress, an infection) is weighing on recovery. One night alone means little; watch for several low nights in a row.",
  },
  "ANS charge": {
    source: "Polar Loop. How calm your autonomic nervous system was in the first ~4 hours of sleep, from heart rate, heart rate variability and breathing rate, against your usual level over the last 28 days.",
    read: "−10 to +10, where 0 is your usual. Positive means more recovered than usual. Strongly negative values follow hard training, alcohol, illness or stress. It reacts faster than sleep charge.",
  },
  "Sleep charge": {
    source: "Polar Loop. This night's sleep score (amount, continuity, deep and REM sleep) against your usual sleep over the last 28 days.",
    read: "Five levels from much below to much above usual. It describes how well you slept, not how recovered your body is; that is the ANS charge.",
  },
  Alertness: {
    source: "Polar SleepWise on the Loop. A model of how alert you will be during the day, from the sleep you got recently (sleep pressure and sleep debt) and your body clock.",
    read: "Grade 0–10 with a class (excellent, strong, fair, …). Today's value is a forecast and is replaced by the measured value later. A drop below your usual usually follows short or late nights; expect more sleepiness in the afternoon dip.",
  },
  "Body-clock bedtime": {
    source: "Polar SleepWise circadian bedtime, estimated from when you slept over the last nights. The \"sleep gate\" is the 30-minute window in which your body clock makes falling asleep easiest.",
    read: "Going to bed much earlier than the gate makes falling asleep harder; much later shortens sleep before your body clock wakes you. Steady bed times keep the gate stable. Shown in local time.",
  },
  "Bedtime vs. body clock": {
    source: "Shaded: Polar SleepWise sleep gate, the 30 minutes in which your body clock makes falling asleep easiest. Line: when the tracker saw you fall asleep (WHOOP until Jul 2026, then Polar).",
    read: "The line inside or just after the band means your bed time fits your body clock. Far above the band means late nights, which shift the body clock later and cut sleep short when you have to get up.",
  },
  Recovery: {
    source: "WHOOP (until Jul 2026). The morning recovery score from heart rate variability, resting heart rate, sleep and breathing rate against your own baseline.",
    read: "0–100%: 67% and above green (ready for strain), 34–66% yellow, below 34% red (recover). Polar has no direct equivalent; Nightly Recharge is the closest.",
  },
  "Heart rate variability": {
    source: "RMSSD during sleep, in milliseconds. WHOOP weights it to the last deep-sleep phase; Polar averages the first ~4 hours of sleep, so the two devices give different values. Normal range: your own last 60 nights on the same device (from 14 nights on).",
    read: "Higher than your usual means a rested nervous system. Compare only with yourself; values between people differ a lot. Single nights swing 10–20%, so look at the 7-day average: below the normal range for several days points to fatigue, illness or stress; a slow rise over weeks to better fitness.",
  },
  "Resting heart rate": {
    source: "Heart rate during sleep. WHOOP: the last deep-sleep phase. Polar: the average over the first ~4 hours of sleep (Nightly Recharge). Values are shown as each device delivers them.",
    read: "Lower is generally better and falls slowly with fitness. A rise of 3–5 bpm over a few days, or a jump overnight, often comes from hard training, alcohol, a late meal, heat or an infection starting.",
  },
  "Sleep performance": {
    source: "WHOOP (until Jul 2026): the sleep you got compared with the sleep WHOOP thought you needed (baseline, strain, debt, naps).",
    read: "85% and above optimal, 70–84% sufficient, below 70% poor. Not comparable with Polar's sleep score.",
  },
  "Sleep score": {
    source: "Polar Loop. One score from sleep time, interruptions, continuity, and the share of deep and REM sleep.",
    read: "1–100; around 70 and above is good sleep for most people. More useful against your own usual than as an absolute number. Not comparable with WHOOP's sleep performance.",
  },
  "Sleep stages": {
    source: "Light, deep and REM sleep, estimated by the tracker from wrist movement and heart rate. WHOOP until Jul 2026, then Polar.",
    read: "Adults need about 7–9 hours. Wrist trackers estimate stages roughly and each device splits them differently (Polar scores less deep sleep than WHOOP), so trust the total more than the split.",
  },
  "Day strain": {
    source: "WHOOP (until Jul 2026). Cardiovascular load of the whole day from heart rate, on WHOOP's 0–21 scale.",
    read: "The scale rises steeply: 10 is a moderate day, 14+ strenuous, 18+ very hard. Compare with your recovery: high strain on low-recovery days is where overreaching starts.",
  },
  "Cardio load": {
    source: "Polar. Training impulse (TRIMP): time spent at each heart rate, weighted by intensity, summed over the day. Days the Loop did not cover in full are left out.",
    read: "A number per day; higher means more cardiovascular strain. Useful as a trend: steady weekly load builds fitness, sudden jumps raise the risk of fatigue.",
  },
  Steps: {
    source: "Polar Loop's motion sensor. Days the Loop did not cover from midnight to midnight are left out.",
    read: "Everyday movement outside workouts. 7,000–10,000 steps a day is linked with clear health benefits; more matters less than avoiding very low days.",
  },
  "Workouts by activity": {
    source: "Strength workouts and activities logged in this app (joined with the tracker's heart rate when it overlaps), plus tracker workouts nobody logged. Resting sessions are not counted.",
    read: "Hours per activity in the period: where your training time goes.",
  },
  "Training time per week": {
    source: "Same workouts as above, summed per Monday-based week and grouped into strength, cardio, walking and other.",
    read: "Guidelines: at least 150 minutes of moderate activity a week plus two strength sessions. Steady weeks beat occasional big ones.",
  },
  "Heart-rate zones": {
    source: "Tracker heart rate during workouts. Zones are % of your maximum heart rate: zone 1 50–60%, 2 60–70%, 3 70–80%, 4 80–90%, 5 90–100%. Only tracker time counts, not logged time without a tracker.",
    read: "Most endurance time belongs in zones 1–2 (easy, builds the base); zones 4–5 are hard intervals. Strength training mostly sits in zones 1–3.",
  },
  "All workouts": {
    source: "Every workout in the period. Source column: Logged (this app only), Logged + Polar/WHOOP (joined with tracker data by time), or the tracker alone.",
    read: "Heart rate, zones and calories come from the tracker; a logged workout without a tracker has only its time.",
  },
  "By period": {
    source: "Averages of the daily values per week or month; workouts counted per period.",
    read: "Partial weeks or months at the edges of the range rest on fewer days (see the Days column).",
  },
  "Journal vs. HRV": {
    source: "Your answers in the daily check-in (Today) compared with that night's HRV, in % from your 60-night normal. Shown once a question has at least 5 yes and 5 no answers.",
    read: "A clear difference hints at an effect (for example alcohol lowering HRV), but it is a correlation, not proof. More answers make it more reliable.",
  },
  "Sessions vs. heart rate": {
    source: "Polar Loop continuous heart rate (one value every ~5 minutes at rest) around each TENS or meditation session, against the 20 minutes before it.",
    read: "A drop during the session suggests a calming effect. Sitting still lowers heart rate by itself, so compare TENS with plain meditation. Needs about 5 sessions per kind before the averages mean much.",
  },
  // tiles
  "Avg recovery": { ref: "Recovery" },
  "Avg HRV": { ref: "Heart rate variability" },
  "Avg resting heart rate": { ref: "Resting heart rate" },
  "Avg sleep per night": {
    source: "Time asleep (light, deep and REM sleep), without awake periods in bed. WHOOP until Jul 2026, then Polar.",
    read: "Adults need about 7–9 hours. \"from N of M days\" means only nights with data count; the change below compares with the period before (hidden when the two periods come from different devices).",
  },
  "Avg sleep performance": { ref: "Sleep performance" },
  "Avg sleep score": { ref: "Sleep score" },
  Workouts: {
    source: "Workouts in the period: logged strength workouts and activities plus tracker workouts nobody logged. Resting sessions (TENS, meditation) are not counted.",
    read: "Compared with the period of the same length before.",
  },
};

const textOf = (key) => {
  const t = INFO[key];
  return t?.ref ? INFO[t.ref] : t;
};

let pop = null;
let owner = null;

function close() {
  pop?.remove();
  pop = null;
  owner?.setAttribute("aria-expanded", "false");
  owner = null;
}

function open(btn) {
  close();
  const t = textOf(btn.dataset.info);
  if (!t) return;
  pop = document.createElement("div");
  pop.className = "info-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", btn.dataset.info);
  const h = document.createElement("strong");
  h.textContent = btn.dataset.info;
  const src = document.createElement("p");
  src.innerHTML = "<b>Where it comes from</b> ";
  src.append(t.source);
  const read = document.createElement("p");
  read.innerHTML = "<b>How to read it</b> ";
  read.append(t.read);
  pop.append(h, src, read);
  document.body.appendChild(pop);
  owner = btn;
  btn.setAttribute("aria-expanded", "true");
  // below the button, kept inside the viewport with a 16px gutter; above it if there is no room below
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, hgt = pop.offsetHeight;
  const left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 16));
  const below = r.bottom + 8 + hgt <= innerHeight || r.top - 8 - hgt < 0;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + 8 : r.top - 8 - hgt}px`;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest?.(".info-btn");
  if (btn) {
    e.stopPropagation();
    return btn === owner ? close() : open(btn);
  }
  if (pop && !pop.contains(e.target)) close();
}, true);
document.addEventListener("keydown", (e) => e.key === "Escape" && close());
// the views scroll inside their own panels: a fixed popover closes when anything scrolls; resize only on a width
// change (iOS fires resize while its address bar collapses)
document.addEventListener("scroll", (e) => pop && !pop.contains(e.target) && close(), true);
let width = innerWidth;
addEventListener("resize", () => { if (innerWidth !== width) { width = innerWidth; close(); } });

/** A small "i" button for a value, or null when there is no text for it. */
export function infoButton(key) {
  if (!textOf(key)) return null;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "info-btn";
  b.dataset.info = key;
  b.setAttribute("aria-label", `About ${key}`);
  b.setAttribute("aria-expanded", "false");
  b.textContent = "i";
  return b;
}
