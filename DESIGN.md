# Design baseline for new projects (GUI)

Starting point for every new project with an interface. Copy into the project as `DESIGN.md` and adapt.
Source: the Landscape Prototype Villa Massimo viewer (`landscape-prototype`, `app/viewer/index.html`); its
settings are copied here. The one deliberate difference: the page background is **white** in light mode
and **dark gray** in dark mode (Villa Massimo uses `#e7e8ea` and `#0d0d0f`).
First applied to: digital-library website (2026-10-17).

## Theme
- **Follows the system setting** (`prefers-color-scheme`) and switches live when it changes.
- Settings offer an override, **System / Light / Dark**, default System, remembered per device.
- One blue accent: `#2f6bf0` light, `#3a6df0` dark, with white text on it. In dark mode, links and other
  accent-colored *text* use a lighter blue (`--link`), because `#3a6df0` is too dark to read on dark gray.
- Everything drawn follows the theme too: 3D scene background (`--bg`), map basemap (light/dark style),
  canvas and chart colors (read from the CSS variables on every theme change).
- Font: `system-ui, sans-serif`.

## Tokens (Villa Massimo)
Set on `<html data-theme="light|dark">`. Components use only these variables, never hard-coded colors.
```css
:root, [data-theme="light"] {
  --bg:#ffffff; --text:#1b1c1f; --text-mid:#33353a; --text-dim:#5f636a;
  --panel-bg:rgba(247,248,250,.94); --panel-border:#cfd2d8; --sec-border:#dde0e5;
  --btn-bg:#e8eaee; --btn-border:#c2c5cc; --btn-text:#23252a; --btn-hover:#d6d9df;
  --accent:#2f6bf0; --accent-text:#fff; --link:#2f6bf0;
  --popup-bg:rgba(250,250,252,.97); --popup-border:#cfd2d8; --input-bg:#fff; --input-border:#c2c5cc;
  color-scheme: light;
}
[data-theme="dark"] {
  --bg:#1e1f22; --text:#eee; --text-mid:#bbb; --text-dim:#888;
  --panel-bg:rgba(20,20,24,.92); --panel-border:#333; --sec-border:#2a2a30;
  --btn-bg:#26262e; --btn-border:#3a3a44; --btn-text:#ddd; --btn-hover:#33333d;
  --accent:#3a6df0; --accent-text:#fff; --link:#8fb0ff;
  --popup-bg:rgba(20,20,24,.96); --popup-border:#444; --input-bg:#26262e; --input-border:#3a3a44;
  color-scheme: dark;
}
```

## Components (Villa Massimo)
```css
html, body { background:var(--bg); color:var(--text); font-family:system-ui,sans-serif; }
/* floating panel over a canvas/map */
.panel { background:var(--panel-bg); border:1px solid var(--panel-border); border-radius:10px;
  padding:12px 14px; backdrop-filter:blur(6px); }
.panel h2 { margin:0 0 8px; font-size:.85rem; letter-spacing:.5px; color:var(--text-mid); }
.sec { margin:10px 0; border-top:1px solid var(--sec-border); padding-top:8px; }   /* panel sections */
.lbl { font-size:.68rem; color:var(--text-dim); text-transform:uppercase; letter-spacing:.6px; margin-bottom:5px; }
button { background:var(--btn-bg); color:var(--btn-text); border:1px solid var(--btn-border); border-radius:6px;
  padding:5px 9px; cursor:pointer; }
button:hover { background:var(--btn-hover); }
button.on, button.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-text); }  /* toggled / main action */
select, input { background:var(--input-bg); color:var(--btn-text); border:1px solid var(--input-border); }
/* icon buttons in a corner: 36 x 34, panel background, blurred */
.corner-btn { background:var(--panel-bg); border:1px solid var(--btn-border); color:var(--text); border-radius:8px;
  width:36px; height:34px; backdrop-filter:blur(6px); }
/* modal (options, tables): dimmed backdrop, panel-styled window */
.modal { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; }
.modal-win { background:var(--panel-bg); border:1px solid var(--panel-border); border-radius:12px; padding:16px 18px;
  backdrop-filter:blur(10px); max-height:82vh; overflow:auto; }
```
Layout pattern: full-screen canvas or map, floating panels on top (controls top left, details top right,
mode switch top center, icon buttons bottom right, options in a modal).

## Theme switch (JS)
In `<head>`, before the stylesheet loads, so there is no flash of the wrong theme:
```html
<meta name="theme-color" content="#ffffff">
<script>try{var m=localStorage.getItem("theme")||"system";document.documentElement.dataset.theme=m==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):m}catch(e){}</script>
```
And as a module (`theme.js`), imported by the app:
```js
const KEY = "theme";
const mq = matchMedia("(prefers-color-scheme: dark)");
export const getThemeMode = () => { try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; } };
export function setThemeMode(mode) { try { localStorage.setItem(KEY, mode); } catch {} applyTheme(); }
export function applyTheme() {
  const mode = getThemeMode();
  const theme = mode === "system" ? (mq.matches ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  dispatchEvent(new CustomEvent("themechange", { detail: theme }));   // canvases, maps, charts redraw on this
}
mq.addEventListener("change", () => { if (getThemeMode() === "system") applyTheme(); });
applyTheme();
```
Settings: `<select>` with System / Light / Dark calling `setThemeMode()`.

## Phone (learned on fitness-assistant)
- Form fields at least 16px (iOS zooms otherwise); tap targets at least 40px.
- A panel under a 3D view or map gets at least 60% of the height and can expand to full screen.
- No horizontal page scroll; wide tables scroll inside their card.

## Before shipping
- Check System, Light and Dark, and switch the system setting while the app is open.
- Desktop and 390px phone width.
