# Sky Viewer

**[▶ Watch the demo](https://youtu.be/L6EY8SLfnvI)** · **[Read the build report](https://claude.ai/artifact/W9cEwXDT2jRrDYgySSYuDF)**

A desktop planetarium: see the stars, planets, Sun and Moon from any place on Earth, at any date and time.
It opens at the current time, looking north at the horizon. Drag the sky around like a panorama.

## Running it
- Double-click **Sky Viewer** on the desktop, or `Sky Viewer.bat` in this folder.
  It opens in its own window (Microsoft Edge app mode).
- It works fully offline. There's no server, no install and no internet use.
- You can also open `index.html` in any modern browser.

## Using it
| Action | How |
|---|---|
| Look around | Drag the sky (or use the arrow keys) |
| Zoom | Mouse wheel, pinch, or `+` / `-` |
| Details on a star or planet | Click it (double-click to centre it) |
| Change date/time | The date box, the ±10m / ±1h / ±1d buttons, or **Now** |
| Animate time | The **Time** menu (real time, faster, reverse). `Space` pauses |
| Change location | **Location** button (search cities, type lat/lon, or use your location) |
| Toggles | `C` lines, `V` constellation names, `L` labels, `G` alt/az grid, `Q` RA/Dec grid, `H` ground, `A` atmosphere |

Times are in your computer's time zone. UTC is always shown too. If you pick a city in another time zone,
its local time is shown as well. Your location and toggle settings are remembered.

## Accuracy
- **Stars:** the 5,044 naked-eye stars (magnitude ≤ 6) from the Hipparcos/Yale Bright Star catalogs
  (J2000), via [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD-3).
- **Astronomy:** [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT) by Don Cross,
  checked against JPL Horizons. Star positions are corrected for precession, nutation and atmospheric refraction.
  The Sun, Moon and planets also get light-time, aberration and topocentric parallax.
- Not modelled, all invisible at naked-eye scale: stellar annual aberration (≤ 20″) and proper motion.
  Proper motion matters only many centuries from 2000.
- **Atmosphere mode** approximates what the eye sees. The sky brightens with the Sun, twilight hides faint stars,
  and stars dim near the horizon (extinction). Turn it off to see every star regardless of daylight.

## Demo and report
- 🎥 **Demo video (45 seconds):** [youtu.be/L6EY8SLfnvI](https://youtu.be/L6EY8SLfnvI)
- 📊 **Build report:** [claude.ai/artifact/W9cEwXDT2jRrDYgySSYuDF](https://claude.ai/artifact/W9cEwXDT2jRrDYgySSYuDF). It covers the catalog stats, accuracy checks, field-test screenshots and architecture.
- The report's source, the video file and the screenshots are in `docs/report/`.

## Development
- `node tools/test_core.js` runs the numerical checks of the astronomy and projection maths.
- `node tools/test_ui.js <dir>` runs end-to-end UI tests in headless Edge.
- `python tools/build_data.py` regenerates `data/sky-data.js` from the catalog files in `raw/`.
- `node tools/record_demo.js <framesDir>` re-records the demo video. The ffmpeg encode command is in the file header.

## Credits
- Star catalog data: [d3-celestial](https://github.com/ofrohn/d3-celestial) © Olaf Frohn, BSD-3-Clause. See `raw/LICENSE-d3-celestial.txt`.
- [astronomy-engine](https://github.com/cosinekitty/astronomy) © Don Cross, MIT. The licence is in the headers of the `vendor/` files.

## License
Sky Viewer's own code is MIT-licensed (see `LICENSE`). Bundled third-party data and libraries keep their own licences, listed under Credits.
