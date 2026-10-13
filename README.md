# Fitness Assistant

Personal fitness tracker. Step 1: an interactive 3D muscle viewer that highlights the muscles trained by an exercise.

- Static site, no build step: plain HTML + ES modules, Three.js loaded from jsDelivr via an import map.
- Runs on GitHub Pages; works on desktop and phone.
- Shareable state in the URL: `#ex=push_up,squat`, `#group=lats`, `&xray=1`.

## Data & sync

"My exercises" are cached in the browser and, once connected (⚙ in the panel), stored as `profile.json`
in a private GitHub repo via the contents API (`js/github-store.js`). The fine-grained token
(Contents: read & write, that repo only) is kept in the browser's localStorage, per device.

```json
{ "version": 1, "updatedAt": "…", "myExercises": ["push_up", "chin_up"] }
```

## Run locally

ES modules need a web server (opening `index.html` as a file won't work):

```sh
python -m http.server 8000
# open http://localhost:8000
```

## Structure

```
index.html                 page + import map
css/style.css
js/app.js                  UI: exercise list, muscle groups, picking, URL state
js/viewer.js               Three.js viewer (loading, highlighting, x-ray, camera)
js/data/muscle-groups.js   training groups -> Z-Anatomy muscle names
js/data/exercises.js       exercises -> primary/secondary muscle groups
assets/models/             muscles.glb (one node per muscle) + skeleton.glb, Draco-compressed
tools/blender/             script that generates the models from Z-Anatomy
```

## Adding exercises / groups

- **Exercise:** add an entry to `js/data/exercises.js` with `primary` / `secondary` group ids.
- **Muscle group:** add to `js/data/muscle-groups.js`. `muscles` are Z-Anatomy names without the
  `.l`/`.r` suffix; tap a muscle in the viewer to see its exact name.

## Regenerating the 3D models

1. Download `Z-Anatomy.zip` from <https://github.com/Z-Anatomy/Models-of-human-anatomy> and extract
   `Z-Anatomy/Startup.blend` (~300 MB, keep it outside the repo).
2. Run (Blender 4.x/5.x):

   ```sh
   blender -b --disable-autoexec path/to/Startup.blend --python tools/blender/export_model.py -- assets/models
   ```

The script filters out non-training structures (fasciae, bursae, eye/tongue/larynx muscles, ...),
decimates to ~410k triangles, stores each muscle's name in glTF extras (`userData.muscle`, `userData.side`)
and writes Draco-compressed GLBs (~1.8 MB muscles, ~1.1 MB skeleton).

## Deploy to GitHub Pages

Push to GitHub, then *Settings → Pages → Deploy from a branch → `main` / root*.
On a free account, Pages requires a public repository: keep personal data out of this repo.

## License

- Code: yours to choose.
- 3D models in `assets/models/`: derived from Z-Anatomy and BodyParts3D, licensed **CC BY-SA 4.0**;
  see [ATTRIBUTION.md](ATTRIBUTION.md).
