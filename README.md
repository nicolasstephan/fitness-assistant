# Fitness Assistant

https://nicolasstephan.github.io/fitness-assistant/

Desktop shortcut (Windows): `powershell -File tools/make_shortcut.ps1` opens the site in its own Chrome/Edge app window, with the hub icon `icons/fitness-assistant.ico`.

## Health data

The Health view reads `health/whoop.json` (WHOOP export, `tools/import_whoop.py`) and `health/polar.json` from the private `fitness-data` repo and merges them per day.

Polar (AccessLink API), all in the private `fitness-data` repo (cloned as `../fitness-data`): `imports/polar/credentials.json` (shared login), `imports/polar/history/YYYY-MM.json` (everything ever fetched; the API keeps only 28-30 days), `health/polar.json` (what the app reads). `python tools/polar.py setup` once on any machine (client from admin.polaraccesslink.com, redirect `http://localhost:5000/oauth2_callback`); `python tools/polar.py sync` pulls, fetches, merges, builds and pushes, and on a rejected push (another machine was faster) pulls and merges again. `tools/ensure-polar.ps1` sets up a machine (clones fitness-data, registers the Windows task: logon +2 min and daily 12:00 + up to 30 min random; log `data/polar/sync.log`); the hub launch runs it on every machine.
