# Sky Viewer

A desktop planetarium. It's a static HTML/JS app with no build step and no server. It runs from `file://` in an Edge app-mode window (`Sky Viewer.bat`, or the desktop shortcut). It must keep working offline, so every dependency is vendored locally.

## Layout
- `index.html`: the page shell. Scripts load in this order: `vendor/astronomy.browser.min.js`, `data/sky-data.js`, `js/skycore.js`, `js/cities.js`, `js/app.js`.
- `js/skycore.js`: the pure astronomy and projection maths, as a UMD module. In the browser it becomes `window.SkyCore`. In Node, `require()` returns a factory you call with astronomy-engine. Keep it free of DOM code so it stays testable in Node.
- `js/app.js`: canvas rendering, input handling, the HUD, dialogs and persistence. It's one IIFE.
- `js/cities.js`: preset locations as `[name, country, lat, lon, IANA tz, defaultForZone]`. A row with `defaultForZone = 1` is used to guess the first-run location from the system time zone.
- `data/sky-data.js`: **generated**; don't edit it by hand. Regenerate it with `python tools/build_data.py` from the d3-celestial JSON files in `raw/`. Each star is `[raDeg, decDeg, mag, bv, properName, designation]`, sorted brightest first.
- `docs/report/`: source of the published build-report artifact (https://claude.ai/artifact/W9cEwXDT2jRrDYgySSYuDF). `index.html` has no doctype or head, because the Artifact tool adds them at publish time. To update the live page, republish this file with the Artifact tool and that URL. The folder also holds the demo video `sky-viewer-demo.mp4` (public on YouTube at https://youtu.be/L6EY8SLfnvI, whose description links back to the repo and report), its poster, and the screenshots.
- `tools/record_demo.js`: re-records the demo frame by frame through headless Edge over CDP. Encoding needs an ffmpeg binary; the command is in the file header.
- `raw/`: the d3-celestial source catalogs plus their BSD-3 licence (`LICENSE-d3-celestial.txt`). Keep the licence with the data.
- `window.__skyViewer`: a read-only hook for automated tests and recordings. `screenOf(name)` returns the screen position of a body or named star.
- `vendor/`: astronomy-engine 2.1.19. The browser bundle is for the app; `astronomy.js` is for the Node tests.

## Conventions
- **Frames:** catalog data is EQJ (J2000). The app works in ENU, where x = East, y = North, z = Up. Azimuth is measured from north through east. astronomy-engine's HOR frame is x = North, y = West, z = Zenith; `SkyCore.toENU` converts it, using matrix layout `rot[col][row]`.
- **Projection:** stereographic, centered on the view direction. `fov` is the angle across the shorter window side. The horizon projects to an exact circle (`horizonShape`), and the ground is filled with an even-odd path.
- **Stars:** star positions go through `Rotation_EQJ_HOR` plus `Refraction('normal')`. Bodies use `Equator(ofdate, aberration)` then `Horizon(..., 'normal')`.
- **Time:** time is a simulated clock, `sim = baseSim + (Date.now() - baseReal) * rate`. Change it only through `setSim()`.
- **Startup:** the default view faces north (az 0, alt 20, fov 90). Don't change it; that is the core requirement.
- **Persistence:** `localStorage` keys are prefixed `skyviewer.` (`loc`, `show`). Wrap every access in try/catch.
- **URL hash:** for testing and screenshots, the hash accepts `t, lat, lon, name, tz, az, alt, fov, rate, sel` and any toggle key, e.g. `#t=2026-11-17T00:00:00Z&az=203&alt=30&fov=6&sel=Moon&rate=0`.

## Testing (run both after any change)
- `node tools/test_core.js` checks the maths against astronomy-engine's independent code paths and against real-world Sun altitudes. Tolerances are sub-arcsecond for positions and sub-pixel for the horizon.
- `node tools/test_ui.js <outDir>` drives headless Edge over CDP (needs Node 22+ for its built-in `WebSocket`). It covers drag, zoom, selection, keys, the time controls and the location dialog, then writes screenshots to `<outDir>`.
- Headless screenshot of a scenario:
  `msedge --headless=new --disable-gpu --user-data-dir=<fresh dir> --window-size=1400,900 --screenshot=<out.png> "file:///.../index.html#..."`
  Use a fresh `--user-data-dir` for each run; a reused profile can stay locked and silently skip the capture.

## Accuracy notes
- Not modelled: stellar annual aberration (≤ 20″) and proper motion.
- Atmosphere mode is a visual approximation: twilight limiting magnitude, sky colour, and Kasten–Young extinction with k = 0.22.
