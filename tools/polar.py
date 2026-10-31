"""Polar AccessLink (API v3) client for the Fitness Assistant.

    python tools/polar.py setup            # once (any machine): client id/secret, Polar login in the browser, register the user
    python tools/polar.py sync             # fetch + merge + build + commit/push the data repo (the scheduled task and the
                                           # data repo's "Polar sync" GitHub Action run this; the app starts the Action)
    python tools/polar.py fetch            # only download what the API offers into data/polar/raw/ (local cache)
    python tools/polar.py build            # only rebuild health/polar.json from the history

Where things live (private data repo `fitness-data`, cloned next to this repo as ../fitness-data):
    imports/polar/credentials.json         client id/secret + access token (shared by all machines; never in this public repo)
    imports/polar/history/YYYY-MM.json     every day/exercise ever fetched, per month (the API forgets after 28-30 days)
    imports/polar/hr/YYYY-MM-DD.json       continuous heart rate as minute means, one file per day (the app compares
                                           it with vagus nerve stimulation / meditation sessions)
    health/polar.json                      what the app reads (same shape as health/whoop.json)
Local only: data/polar/raw/ (last download), data/polar/sync.log.

Several machines may sync: each one pulls first, merges its download into the history (union by day,
newer download wins), and on a rejected push resets its commit, pulls again and redoes the merge.
Client registration: https://admin.polaraccesslink.com, redirect URL http://localhost:5000/oauth2_callback.
The access token does not expire unless revoked. Only standard library (Python 3.10+).
"""
import base64
import json
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / "data" / "polar"
RAW = LOCAL / "raw"
DATA_REPO = ROOT.parent / "fitness-data"  # local clone of the private data repo
IMPORTS = DATA_REPO / "imports" / "polar"
CRED = IMPORTS / "credentials.json"
HISTORY = IMPORTS / "history"
HR_DIR = IMPORTS / "hr"
OUT = DATA_REPO / "health" / "polar.json"
TRACKED = ["imports/polar", "health/polar.json"]  # the only paths this script commits

AUTH_URL = "https://flow.polar.com/oauth2/authorization"
TOKEN_URL = "https://polarremote.com/v2/oauth2/token"
API = "https://www.polaraccesslink.com"
REDIRECT = "http://localhost:5000/oauth2_callback"


def git(*args, check=True):
    return subprocess.run(["git", "-C", str(DATA_REPO), *args], check=check, capture_output=True, text=True)


def load_cred():
    if not CRED.exists():
        sys.exit(f"No Polar credentials in {CRED}: run  python tools/polar.py setup")
    return json.loads(CRED.read_text(encoding="utf-8"))


def save_cred(c):
    IMPORTS.mkdir(parents=True, exist_ok=True)
    CRED.write_text(json.dumps(c, indent=2), encoding="utf-8")


def request(method, url, token=None, basic=None, data=None, json_body=None):
    headers = {"Accept": "application/json"}
    body = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if basic:
        headers["Authorization"] = "Basic " + base64.b64encode(basic.encode()).decode()
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if json_body is not None:
        body = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        return e.code, text


def wait_for_code(state):
    """Tiny local server that catches the redirect from Polar Flow."""
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if self.path.startswith("/oauth2_callback"):
                result.update({k: v[0] for k, v in q.items()})
                ok = "code" in result and result.get("state") == state
                msg = "Polar connected. You can close this tab." if ok else f"Login failed: {result}"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(msg.encode())
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *args):
            pass

    srv = HTTPServer(("localhost", 5000), Handler)
    while "code" not in result and "error" not in result:
        srv.handle_request()
    srv.server_close()
    if result.get("state") != state:
        sys.exit("State mismatch, aborting.")
    if "error" in result:
        sys.exit(f"Polar returned an error: {result}")
    return result["code"]


def setup():
    git("pull", "-q", "--rebase", "--autostash", check=False)
    c = json.loads(CRED.read_text(encoding="utf-8")) if CRED.exists() else {}
    if not c.get("client_id"):
        c["client_id"] = input("Client ID: ").strip()
        c["client_secret"] = input("Client secret: ").strip()
        save_cred(c)
    state = secrets.token_urlsafe(16)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": c["client_id"], "redirect_uri": REDIRECT,
        "scope": "accesslink.read_all", "state": state})
    print("Opening the Polar Flow login in the browser ...")
    webbrowser.open(url)
    code = wait_for_code(state)
    status, tok = request("POST", TOKEN_URL, basic=f"{c['client_id']}:{c['client_secret']}",
                          data={"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT})
    if status != 200:
        sys.exit(f"Token exchange failed ({status}): {tok}")
    c["access_token"] = tok["access_token"]
    c["user_id"] = tok["x_user_id"]
    save_cred(c)
    status, body = request("POST", f"{API}/v3/users", token=c["access_token"],
                           json_body={"member-id": f"fitness-assistant-{c['user_id']}"})
    if status == 200:
        print("User registered:", {k: body.get(k) for k in ("polar-user-id", "first-name", "registration-date")})
    elif status == 409:
        print("User already registered (fine).")
    else:
        sys.exit(f"User registration failed ({status}): {body}  (403 = accept the consents in Polar Flow)")
    commit_and_push("Polar credentials")
    print(f"Saved to {CRED} (shared via the fitness-data repo)")


def fetch():
    c = load_cred()
    tok = c["access_token"]
    today = date.today()
    RAW.mkdir(parents=True, exist_ok=True)

    def get(name, path, **params):
        url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
        status, body = request("GET", url, token=tok)
        if status == 200:
            (RAW / f"{name}.json").write_text(json.dumps(body, indent=1, ensure_ascii=False), encoding="utf-8")
        elif status == 204:
            (RAW / f"{name}.json").unlink(missing_ok=True)
        n = len(body) if isinstance(body, list) else (len(next(iter(body.values()))) if isinstance(body, dict) and len(body) == 1 and isinstance(next(iter(body.values())), list) else "")
        print(f"{name:28} {status}  {n if status == 200 else str(body)[:80]}")
        if status in (401, 403):
            sys.exit("Polar rejected the token: run  python tools/polar.py setup  again")
        return body if status == 200 else None

    get("physical-info", "/v3/users/physical-info")
    get("exercises", "/v3/exercises", zones="true", samples="false")
    get("sleep", "/v3/users/sleep")
    get("nightly-recharge", "/v3/users/nightly-recharge")
    get("cardio-load", "/v3/users/cardio-load")  # period/months/12 returns 400 "Invalid value range"
    get("sleepwise-alertness", "/v3/users/sleepwise/alertness")
    get("sleepwise-bedtime", "/v3/users/sleepwise/circadian-bedtime")
    get("skin-temperature", "/v3/users/biosensing/skintemperature")
    get("spo2", "/v3/users/biosensing/spo2")
    # daily activity: up to 365 days back, in 28-day slices
    acts = []
    end = today
    while end > today - timedelta(days=365):
        start = max(end - timedelta(days=27), today - timedelta(days=364))
        status, body = request("GET", f"{API}/v3/users/activities?from={start}&to={end}", token=tok)
        if status == 200 and body:
            acts.extend(body if isinstance(body, list) else body.get("activities", []))
        elif status not in (200, 204):
            print("activities", start, end, status, str(body)[:80])
        end = start - timedelta(days=1)
    (RAW / "activities.json").write_text(json.dumps(acts, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{'activities (365 d)':28} {len(acts)} days")
    # continuous HR (samples every few seconds to minutes): kept as minute means per day, see merge_hr
    get("continuous-hr", "/v3/users/continuous-heart-rate", **{"from": str(today - timedelta(days=27)), "to": str(today)})


# ---------- history: imports/polar/history/YYYY-MM.json, merged from every fetch on every machine

def list_of(body, key):
    if isinstance(body, list):
        return body
    return (body or {}).get(key, [])


def read_raw(name):
    p = RAW / f"{name}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


STREAMS = {
    # name: (raw file, list key, record -> date key, record -> id)
    "sleep": ("sleep", "nights", lambda r: r["date"], lambda r: r["date"]),
    "recharge": ("nightly-recharge", "recharges", lambda r: r["date"], lambda r: r["date"]),
    "activities": ("activities", "activities", lambda r: r["start_time"][:10], lambda r: r["start_time"][:10]),
    "cardioLoad": ("cardio-load", "cardio_load", lambda r: r["date"], lambda r: r["date"]),
    "exercises": ("exercises", "exercises", lambda r: r["start_time"][:10], lambda r: r["id"]),
}


def load_history():
    h = {}
    for f in sorted(HISTORY.glob("*.json")):
        month = json.loads(f.read_text(encoding="utf-8"))
        for name, recs in month.items():
            if isinstance(recs, dict):
                h.setdefault(name, {}).update(recs)
    info = IMPORTS / "physical-info.json"
    if info.exists():
        h["physicalInfo"] = json.loads(info.read_text(encoding="utf-8"))
    return h


def merge_history():
    """Merge the last download (data/polar/raw) into the monthly history files; write only months that change."""
    HISTORY.mkdir(parents=True, exist_ok=True)
    months = {}
    for name, (raw, key, day_of, id_of) in STREAMS.items():
        rows = list_of(read_raw(raw), key)
        if name == "cardioLoad":
            rows = [r for r in rows if r.get("cardio_load", -1) >= 0]  # -1 = not available yet
        for r in rows:
            months.setdefault(day_of(r)[:7], {}).setdefault(name, {})[id_of(r)] = r
    changed = 0
    for month, streams in months.items():
        f = HISTORY / f"{month}.json"
        old = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        new = json.loads(json.dumps(old))
        for name, recs in streams.items():
            new.setdefault(name, {}).update(recs)  # newer download wins (today's partial day gets completed)
        if new != old:
            f.write_text(json.dumps(new, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")
            changed += 1
    info = read_raw("physical-info")
    if info:
        p = IMPORTS / "physical-info.json"
        if not p.exists() or json.loads(p.read_text(encoding="utf-8")) != info:
            p.write_text(json.dumps(info, indent=1), encoding="utf-8")
    h = load_history()
    print(f"history: {changed} month file(s) changed;", ", ".join(f"{k} {len(v)}" for k, v in h.items() if k != "physicalInfo"))
    merge_hr()


def merge_hr():
    """Continuous HR of the last download -> imports/polar/hr/YYYY-MM-DD.json: {"date", "hr": [[minute of day, bpm]]}.
    Minute means of the samples; merged with the stored day (newer download wins per minute), written only on change."""
    days = list_of(read_raw("continuous-hr"), "heart_rates")
    changed = 0
    for day in days:
        per = {}
        for smp in day.get("heart_rate_samples") or []:
            hh, mm = smp.get("sample_time", "")[:5].split(":")
            if smp.get("heart_rate"):
                per.setdefault(int(hh) * 60 + int(mm), []).append(smp["heart_rate"])
        if not per:
            continue
        f = HR_DIR / f"{day['date']}.json"
        old = {m: v for m, v in json.loads(f.read_text(encoding="utf-8"))["hr"]} if f.exists() else {}
        new = {**old, **{m: round(sum(v) / len(v)) for m, v in per.items()}}
        if new != old:
            HR_DIR.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps({"date": day["date"], "hr": sorted([m, v] for m, v in new.items())}, separators=(",", ":")), encoding="utf-8")
            changed += 1
    print(f"heart rate: {len(days)} day(s) downloaded, {changed} file(s) changed")


# ---------- build: history -> health/polar.json (same shape as whoop.json)

def minutes(iso):
    """ISO-8601 duration ('PT1H23M45.5S') -> minutes."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?", iso or "")
    if not m:
        return None
    d, hh, mm, ss = (float(x) if x else 0 for x in m.groups())
    return round(d * 1440 + hh * 60 + mm + ss / 60, 1)


def build():
    h = load_history()
    days = {}

    def day(key):
        return days.setdefault(key, {
            "date": key, "recovery": None, "rhr": None, "hrv": None, "strain": None,
            "sleep": {"onset": None, "wake": None, "performance": None, "score": None, "respRate": None,
                      "asleepMin": None, "lightMin": None, "deepMin": None, "remMin": None, "awakeMin": None},
            "journal": {},
        })

    for k, s in h.get("sleep", {}).items():
        d = day(k)
        light, deep, rem = (s.get(x, 0) / 60 for x in ("light_sleep", "deep_sleep", "rem_sleep"))
        d["sleep"].update({
            "onset": s["sleep_start_time"][:16], "wake": s["sleep_end_time"][:16],
            # Polar's sleep score (1-100, composite of 6 components) is not WHOOP's sleep performance
            # (% of sleep need): its own field, so the two never share a chart line or an average
            "performance": None, "score": s.get("sleep_score"),
            "asleepMin": round(light + deep + rem), "lightMin": round(light), "deepMin": round(deep), "remMin": round(rem),
            "awakeMin": round(s.get("total_interruption_duration", 0) / 60),
        })
        d["sleepCycles"] = s.get("sleep_cycles")
    for k, r in h.get("recharge", {}).items():
        d = day(k)
        d["hrv"] = r.get("heart_rate_variability_avg")
        # Nightly Recharge averages over ~4 h from falling asleep; WHOOP's RHR comes from the last deep-sleep phase
        d["rhr"] = r.get("heart_rate_avg")
        d["sleep"]["respRate"] = r.get("breathing_rate_avg")
        d["ansCharge"] = r.get("ans_charge")
    for k, a in h.get("activities", {}).items():
        d = day(k)
        d.update({"steps": a.get("steps"), "kcal": a.get("calories"), "activeKcal": a.get("active_calories")})
        # a day the band did not cover from midnight to midnight (first day worn, today so far):
        # its steps and cardio load are not comparable with full days
        if a.get("start_time", "")[11:16] != "00:00" or a.get("end_time", "")[11:16] < "23:50":
            d["partialDay"] = True
    for k, c in h.get("cardioLoad", {}).items():
        day(k)["cardioLoad"] = round(c["cardio_load"], 1)

    workouts = []
    for e in h.get("exercises", {}).values():
        dur = minutes(e.get("duration"))
        zones = [0.0] * 5
        # zones 1-5 = 50-60 ... 90-100% of max HR (like WHOOP); the API numbers them 0-4
        for z in e.get("heart_rate_zones") or []:
            i = z.get("index", -1)
            if 0 <= i < 5 and dur:
                zones[i] = round(100 * (minutes(z.get("in_zone")) or 0) / dur, 1)
        hr = e.get("heart_rate") or {}
        sport = (e.get("detailed_sport_info") or e.get("sport") or "Other").replace("_", " ").capitalize()
        start = e.get("start_time", "")[:16]
        end = (datetime.fromisoformat(start) + timedelta(minutes=dur)).isoformat(timespec="minutes") if start and dur else None
        workouts.append({
            "start": start, "end": end, "durationMin": round(dur) if dur else dur, "activity": sport, "strain": None,
            "kcal": e.get("calories"), "maxHr": hr.get("maximum"), "avgHr": hr.get("average"),
            "zones": zones, "cardioLoad": round((e.get("training_load_pro") or {}).get("cardio-load") or 0, 1) or None,
        })
    workouts.sort(key=lambda w: w["start"])
    ordered = sorted(days.values(), key=lambda d: d["date"])
    if not ordered:
        print("No Polar days yet.")
        return
    doc = {
        "version": 1, "source": "polar", "importedAt": None,
        "range": {"from": ordered[0]["date"], "to": ordered[-1]["date"]},
        "days": ordered, "workouts": workouts,
    }
    # keep the old timestamp when nothing changed, so an idle sync makes no commit
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    same = {**old, "importedAt": None} == doc
    doc["importedAt"] = old.get("importedAt") if same else datetime.now(timezone.utc).isoformat(timespec="seconds")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{len(ordered)} days ({doc['range']['from']} .. {doc['range']['to']}), {len(workouts)} workouts"
          f"{' (unchanged)' if same else ''} -> {OUT}")


# ---------- git: commit only our paths; on a rejected push undo, pull, redo

def commit_and_push(message, redo=None, tries=3):
    for attempt in range(1, tries + 1):
        git("add", "-A", "--", *TRACKED)
        if git("diff", "--cached", "--quiet", check=False).returncode == 0:
            print("data repo: no change")
            return
        git("commit", "-q", "-m", message, "--", *TRACKED)
        r = git("push", "-q", check=False)
        if r.returncode == 0:
            print("data repo: pushed")
            return
        print(f"data repo: push rejected (attempt {attempt}), another machine was faster; pulling and merging again")
        git("reset", "-q", "--keep", "HEAD~1")              # drop our commit, keep other local work
        git("checkout", "-q", "--", *TRACKED, check=False)  # our files are regenerated from raw anyway
        git("pull", "-q", "--rebase", "--autostash")
        if redo:
            redo()
    sys.exit("data repo: could not push after several tries")


def sync():
    """pull + fetch + merge + build + push; what the scheduled task runs."""
    if not (DATA_REPO / ".git").exists():
        sys.exit(f"Data repo clone missing: {DATA_REPO}")
    git("pull", "-q", "--rebase", "--autostash")
    fetch()

    def merge_and_build():
        merge_history()
        build()

    merge_and_build()
    commit_and_push(f"Polar import {date.today()}", redo=merge_and_build)


def migrate():
    """One-off: move credentials/history from the old local data/polar/ into the data repo."""
    old_cred, old_hist = LOCAL / "credentials.json", LOCAL / "history.json"
    git("pull", "-q", "--rebase", "--autostash")
    if old_cred.exists() and not CRED.exists():
        save_cred(json.loads(old_cred.read_text(encoding="utf-8")))
    if old_hist.exists():
        h = json.loads(old_hist.read_text(encoding="utf-8"))
        HISTORY.mkdir(parents=True, exist_ok=True)
        for name, (_, _, day_of, id_of) in STREAMS.items():
            for r in (h.get(name) or {}).values():
                if name == "cardioLoad" and r.get("cardio_load", -1) < 0:
                    continue
                f = HISTORY / f"{day_of(r)[:7]}.json"
                m = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
                m.setdefault(name, {})[id_of(r)] = r
                f.write_text(json.dumps(m, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")
    build()
    commit_and_push("Polar: credentials and history into the data repo")
    for p in (old_cred, old_hist):
        p.unlink(missing_ok=True)
    print("migrated; local copies removed")


if __name__ == "__main__":
    if sys.stdout is None:  # pythonw (scheduled task): no console, so append output to a log
        LOCAL.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = open(LOCAL / "sync.log", "a", encoding="utf-8")
        print(f"--- {datetime.now().isoformat(timespec='seconds')}")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"setup": setup, "fetch": fetch, "build": build, "sync": sync, "migrate": migrate}.get(cmd, lambda: sys.exit(__doc__))()
