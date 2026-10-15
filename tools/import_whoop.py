"""Convert a WHOOP data export (CSV folder) into the app's health JSON.

Usage:
    python tools/import_whoop.py <export_dir> <out.json>

Each WHOOP "physiological cycle" runs from one sleep to the next. A day record is keyed by the
local date of the wake-up, so the recovery, HRV and sleep of a night belong to the morning after it,
and the day strain to the day that follows.
"""
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def num(v):
    if v is None or v.strip() == "":
        return None
    f = float(v)
    return int(f) if f.is_integer() else round(f, 2)


def date_of(ts):
    return ts[:10] if ts else None


def iso_local(ts):
    """'2026-07-19 09:30:40' -> '2026-07-19T09:30' (timestamps in the export are already local)."""
    return ts[:16].replace(" ", "T") if ts else None


def read(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def convert(src: Path):
    days = {}
    cycle_day = {}  # cycle start time -> day key, to attach journal answers
    for r in read(src / "physiological_cycles.csv"):
        key = date_of(r["Wake onset"]) or date_of(r["Cycle start time"])
        cycle_day[r["Cycle start time"]] = key
        days[key] = {
            "date": key,
            "recovery": num(r["Recovery score %"]),
            "rhr": num(r["Resting heart rate (bpm)"]),
            "hrv": num(r["Heart rate variability (ms)"]),
            "skinTemp": num(r["Skin temp (celsius)"]),
            "spo2": num(r["Blood oxygen %"]),
            "strain": num(r["Day Strain"]),
            "kcal": num(r["Energy burned (cal)"]),
            "maxHr": num(r["Max HR (bpm)"]),
            "avgHr": num(r["Average HR (bpm)"]),
            "sleep": {
                "onset": iso_local(r["Sleep onset"]),
                "wake": iso_local(r["Wake onset"]),
                "performance": num(r["Sleep performance %"]),
                "respRate": num(r["Respiratory rate (rpm)"]),
                "asleepMin": num(r["Asleep duration (min)"]),
                "inBedMin": num(r["In bed duration (min)"]),
                "lightMin": num(r["Light sleep duration (min)"]),
                "deepMin": num(r["Deep (SWS) duration (min)"]),
                "remMin": num(r["REM duration (min)"]),
                "awakeMin": num(r["Awake duration (min)"]),
                "needMin": num(r["Sleep need (min)"]),
                "debtMin": num(r["Sleep debt (min)"]),
                "efficiency": num(r["Sleep efficiency %"]),
                "consistency": num(r["Sleep consistency %"]),
            },
            "napMin": 0,
            "journal": {},
        }

    for r in read(src / "sleeps.csv"):
        if r["Nap"].lower() == "true":
            day = date_of(r["Wake onset"])
            if day in days:
                days[day]["napMin"] += num(r["Asleep duration (min)"]) or 0

    for r in read(src / "journal_entries.csv"):
        day = cycle_day.get(r["Cycle start time"])
        if day in days and r["Answered yes"] in ("true", "false"):
            days[day]["journal"][r["Question text"].strip()] = r["Answered yes"] == "true"

    workouts = []
    for r in read(src / "workouts.csv"):
        workouts.append({
            "start": iso_local(r["Workout start time"]),
            "end": iso_local(r["Workout end time"]),
            "durationMin": num(r["Duration (min)"]),
            "activity": r["Activity name"].strip(),
            "strain": num(r["Activity Strain"]),
            "kcal": num(r["Energy burned (cal)"]),
            "maxHr": num(r["Max HR (bpm)"]),
            "avgHr": num(r["Average HR (bpm)"]),
            "zones": [num(r[f"HR Zone {i} %"]) or 0 for i in range(1, 6)],
        })

    ordered = sorted(days.values(), key=lambda d: d["date"])
    workouts.sort(key=lambda w: w["start"] or "")
    return {
        "version": 1,
        "source": "whoop",
        "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "range": {"from": ordered[0]["date"], "to": ordered[-1]["date"]},
        "days": ordered,
        "workouts": workouts,
    }


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    doc = convert(src)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    journal_days = sum(1 for d in doc["days"] if d["journal"])
    print(f"{len(doc['days'])} days ({doc['range']['from']} .. {doc['range']['to']}), "
          f"{len(doc['workouts'])} workouts, {journal_days} days with journal -> {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
