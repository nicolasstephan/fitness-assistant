"""Polar AccessLink (API v3) client for the Fitness Assistant.

    python tools/polar.py setup            # once: store client id/secret, log in via the browser, register the user
    python tools/polar.py fetch            # download everything the API offers into data/polar/raw/ and merge into history.json
    python tools/polar.py build            # history.json -> ../fitness-data/health/polar.json (same shape as whoop.json)
    python tools/polar.py sync             # fetch + build + commit/push the data repo (the scheduled task runs this)

Credentials, raw downloads and the merged history live in data/polar/ (data/ is git-ignored; personal data never goes in this repo).
Client registration: https://admin.polaraccesslink.com (log in with the Polar Flow account), redirect URL
http://localhost:5000/oauth2_callback. The access token does not expire unless revoked.

Lookback windows (API limits): sleep, Nightly Recharge, activities, SleepWise, biosensing 28 days;
exercises 30 days; cardio load 28 days; activities up to 365 days back in 28-day slices.
Only standard library, so it runs with any Python 3.10+.
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
DIR = ROOT / "data" / "polar"
CRED = DIR / "credentials.json"
RAW = DIR / "raw"
HISTORY = DIR / "history.json"
DATA_REPO = ROOT.parent / "fitness-data"  # local clone of the private data repo
OUT = DATA_REPO / "health" / "polar.json"

AUTH_URL = "https://flow.polar.com/oauth2/authorization"
TOKEN_URL = "https://polarremote.com/v2/oauth2/token"
API = "https://www.polaraccesslink.com"
REDIRECT = "http://localhost:5000/oauth2_callback"


def load_cred():
    if not CRED.exists():
        sys.exit("No credentials yet: run  python tools/polar.py setup")
    return json.loads(CRED.read_text(encoding="utf-8"))


def save_cred(c):
    DIR.mkdir(parents=True, exist_ok=True)
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
    print(f"Saved to {CRED}")


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
        n = len(body) if isinstance(body, list) else (len(next(iter(body.values()))) if isinstance(body, dict) and len(body) == 1 and isinstance(next(iter(body.values())), list) else "")
        print(f"{name:28} {status}  {n if status == 200 else str(body)[:80]}")
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
    get("continuous-hr", "/v3/users/continuous-heart-rate", **{"from": str(today - timedelta(days=27)), "to": str(today)})
    print(f"Raw data in {RAW}")
    merge_history()


# ---------- history: the API forgets after 28-30 days, so every fetch is merged into one file

def list_of(body, key):
    if isinstance(body, list):
        return body
    return (body or {}).get(key, [])


def read_raw(name):
    p = RAW / f"{name}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def merge_history():
    h = json.loads(HISTORY.read_text(encoding="utf-8")) if HISTORY.exists() else {}
    streams = {
        "sleep": (list_of(read_raw("sleep"), "nights"), lambda r: r["date"]),
        "recharge": (list_of(read_raw("nightly-recharge"), "recharges"), lambda r: r["date"]),
        "activities": (list_of(read_raw("activities"), "activities"), lambda r: r["start_time"][:10]),
        "cardioLoad": ([r for r in list_of(read_raw("cardio-load"), "cardio_load") if r.get("cardio_load", -1) >= 0],
                       lambda r: r["date"]),
        "heartRate": (list_of(read_raw("continuous-hr"), "heart_rates"), lambda r: r["date"]),
        "exercises": (list_of(read_raw("exercises"), "exercises"), lambda r: r["id"]),
    }
    for name, (rows, key) in streams.items():
        h.setdefault(name, {}).update({key(r): r for r in rows})  # newer fetch wins (today's partial day gets completed)
    info = read_raw("physical-info")
    if info:
        h["physicalInfo"] = info
    HISTORY.write_text(json.dumps(h, ensure_ascii=False), encoding="utf-8")
    print("history:", ", ".join(f"{k} {len(v)}" for k, v in h.items() if isinstance(v, dict) and k != "physicalInfo"))


# ---------- build: history -> health/polar.json in the private data repo (same shape as whoop.json)

def minutes(iso):
    """ISO-8601 duration ('PT1H23M45.5S') -> minutes."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?", iso or "")
    if not m:
        return None
    d, hh, mm, ss = (float(x) if x else 0 for x in m.groups())
    return round(d * 1440 + hh * 60 + mm + ss / 60, 1)


def build():
    h = json.loads(HISTORY.read_text(encoding="utf-8"))
    days = {}

    def day(key):
        return days.setdefault(key, {
            "date": key, "recovery": None, "rhr": None, "hrv": None, "strain": None,
            "sleep": {"onset": None, "wake": None, "performance": None, "respRate": None,
                      "asleepMin": None, "lightMin": None, "deepMin": None, "remMin": None, "awakeMin": None},
            "journal": {},
        })

    for k, s in h.get("sleep", {}).items():
        d = day(k)
        light, deep, rem = (s.get(x, 0) / 60 for x in ("light_sleep", "deep_sleep", "rem_sleep"))
        d["sleep"].update({
            "onset": s["sleep_start_time"][:16], "wake": s["sleep_end_time"][:16],
            "performance": s.get("sleep_score"),
            "asleepMin": round(light + deep + rem), "lightMin": round(light), "deepMin": round(deep), "remMin": round(rem),
            "awakeMin": round(s.get("total_interruption_duration", 0) / 60),
        })
        d["sleepCycles"] = s.get("sleep_cycles")
    for k, r in h.get("recharge", {}).items():
        d = day(k)
        d["hrv"] = r.get("heart_rate_variability_avg")
        d["rhr"] = r.get("heart_rate_avg")  # Polar: average HR during sleep (WHOOP's RHR is lower)
        d["sleep"]["respRate"] = r.get("breathing_rate_avg")
        d["ansCharge"] = r.get("ans_charge")
    for k, a in h.get("activities", {}).items():
        d = day(k)
        d.update({"steps": a.get("steps"), "kcal": a.get("calories"), "activeKcal": a.get("active_calories")})
    for k, c in h.get("cardioLoad", {}).items():
        day(k)["cardioLoad"] = round(c["cardio_load"], 1)

    workouts = []
    for e in h.get("exercises", {}).values():
        dur = minutes(e.get("duration"))
        zones = [0.0] * 5
        for z in e.get("heart_rate_zones") or []:
            i = z.get("index", 0) - 1
            if 0 <= i < 5 and dur:
                zones[i] = round(100 * (minutes(z.get("in-zone")) or 0) / dur, 1)
        hr = e.get("heart_rate") or {}
        sport = (e.get("detailed_sport_info") or e.get("sport") or "Other").replace("_", " ").capitalize()
        start = e.get("start_time", "")[:16]
        workouts.append({
            "start": start, "end": None, "durationMin": dur, "activity": sport, "strain": None,
            "kcal": e.get("calories"), "maxHr": hr.get("maximum"), "avgHr": hr.get("average"),
            "zones": zones, "cardioLoad": e.get("cardio_load") or e.get("training_load"),
        })
    workouts.sort(key=lambda w: w["start"])
    ordered = sorted(days.values(), key=lambda d: d["date"])
    if not ordered:
        sys.exit("No Polar days yet.")
    doc = {
        "version": 1, "source": "polar",
        "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "range": {"from": ordered[0]["date"], "to": ordered[-1]["date"]},
        "days": ordered, "workouts": workouts,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{len(ordered)} days ({doc['range']['from']} .. {doc['range']['to']}), {len(workouts)} workouts -> {OUT}")


def push():
    git = ["git", "-C", str(DATA_REPO)]
    subprocess.run(git + ["pull", "-q", "--rebase", "--autostash"], check=False)
    subprocess.run(git + ["add", "health/polar.json"], check=True)
    if subprocess.run(git + ["diff", "--cached", "--quiet"]).returncode == 0:
        print("data repo: no change")
        return
    subprocess.run(git + ["commit", "-q", "-m", f"Polar import {date.today()}"], check=True)
    subprocess.run(git + ["push", "-q"], check=True)
    print("data repo: pushed")


def sync():
    """fetch + build + push; what the scheduled task runs."""
    fetch()
    build()
    push()


if __name__ == "__main__":
    if sys.stdout is None:  # pythonw (scheduled task): no console, so append output to a log
        DIR.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = open(DIR / "sync.log", "a", encoding="utf-8")
        print(f"--- {datetime.now().isoformat(timespec='seconds')}")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"setup": setup, "fetch": fetch, "build": build, "push": push, "sync": sync}.get(cmd, lambda: sys.exit(__doc__))()
