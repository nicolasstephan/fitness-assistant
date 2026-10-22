# Fitness Assistant

https://nicolasstephan.github.io/fitness-assistant/

## Health data

The Health view reads `health/whoop.json` (WHOOP export, `tools/import_whoop.py`) and `health/polar.json` from the private `fitness-data` repo and merges them per day.

Polar (AccessLink API): `python tools/polar.py setup` once (client from admin.polaraccesslink.com, redirect `http://localhost:5000/oauth2_callback`), then `python tools/polar.py sync` fetches, merges into `data/polar/history.json` (the API keeps only 28-30 days) and pushes `health/polar.json` via the `../fitness-data` clone. `tools/setup-polar-task.ps1` registers a Windows task (logon +2 min, daily 12:00; log `data/polar/sync.log`).
