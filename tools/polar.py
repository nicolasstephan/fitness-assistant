"""Polar AccessLink (API v3) client for the Fitness Assistant.

    python tools/polar.py setup            # once: store client id/secret, log in via the browser, register the user
    python tools/polar.py fetch            # download everything the API offers into data/polar/raw/

Credentials and downloads live in data/polar/ (data/ is git-ignored; personal data never goes in this repo).
Client registration: https://admin.polaraccesslink.com (log in with the Polar Flow account), redirect URL
http://localhost:5000/oauth2_callback. The access token does not expire unless revoked.

Lookback windows (API limits): sleep, Nightly Recharge, activities, SleepWise, biosensing 28 days;
exercises 30 days; cardio load 28 days; activities up to 365 days back in 28-day slices.
Only standard library, so it runs with any Python 3.10+.
"""
import base64
import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "polar"
CRED = DIR / "credentials.json"
RAW = DIR / "raw"

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


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"setup": setup, "fetch": fetch}.get(cmd, lambda: sys.exit(__doc__))()
