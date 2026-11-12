/* Sky Viewer — UI, rendering and interaction. Maths lives in skycore.js. */
(function () {
  'use strict';
  const A = window.Astronomy, D = window.SKY_DATA, C = window.SkyCore;
  const DEG = C.DEG;
  const $ = id => document.getElementById(id);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const FONT = '"Segoe UI", system-ui, sans-serif';

  // ---------------- persistence (best effort) ----------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('skyviewer.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('skyviewer.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  function guessLocation() {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
    const c = window.CITIES.find(c => c[5] && c[4] === tz);
    if (c) return { name: `${c[0]}, ${c[1]}`, lat: c[2], lon: c[3], tz: c[4], guessed: true };
    return { name: 'Greenwich, UK', lat: 51.4769, lon: -0.0005, tz: 'Europe/London', guessed: true };
  }

  function validLoc(l) {
    return l && isFinite(l.lat) && isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180;
  }

  // ---------------- state ----------------
  const DEFAULT_SHOW = { lines: true, cnames: true, snames: true, grid: false, eqgrid: false, ground: true, atmosphere: true };
  const DEFAULT_VIEW = { az: 0, alt: 20, fov: 90 }; // facing north, horizon in the lower part of the window
  const savedLoc = store.get('loc', null);
  const state = {
    loc: validLoc(savedLoc) ? savedLoc : guessLocation(),
    show: Object.assign({}, DEFAULT_SHOW, store.get('show', {})),
    view: Object.assign({}, DEFAULT_VIEW),
    // Simulated clock: sim = baseSim + (Date.now() - baseReal) * rate
    baseSim: Date.now(), baseReal: Date.now(), rate: 1, lastRate: 1,
    selected: null,
  };
  const simNow = () => state.baseSim + (Date.now() - state.baseReal) * state.rate;
  function setSim(t, rate) {
    state.baseSim = t; state.baseReal = Date.now();
    if (rate !== undefined) state.rate = rate;
    $('rate').value = String(state.rate);
    recompute(); syncTimeInput(true);
  }

  // ---------------- precomputed catalog vectors ----------------
  const NS = D.stars.length;
  const starEQJ = C.eqjVectors(D.stars);
  const starENU = new Float64Array(NS * 3);
  const starColor = D.stars.map(s => rgb(C.bvColor(s[3])));

  // constellation figures: flatten polylines
  const linePolys = []; const linePts = [];
  for (const poly of D.lines) { linePolys.push([linePts.length, poly.length]); for (const p of poly) linePts.push(p); }
  const lineEQJ = C.eqjVectors(linePts), lineENU = new Float64Array(lineEQJ.length);

  const cLabelEQJ = C.eqjVectors(D.constellations.map(c => [c.ra, c.dec]));
  const cLabelENU = new Float64Array(cLabelEQJ.length);

  // equatorial (of-date) grid lines
  const eqPolys = []; const eqPts = [];
  for (let ra = 0; ra < 360; ra += 15) { eqPolys.push([eqPts.length, 0]); for (let d = -88; d <= 88; d += 2) eqPts.push([ra, d]); eqPolys[eqPolys.length - 1][1] = eqPts.length - eqPolys[eqPolys.length - 1][0]; }
  for (let d = -80; d <= 80; d += 10) { eqPolys.push([eqPts.length, 0]); for (let ra = 0; ra <= 360; ra += 2) eqPts.push([ra, d]); eqPolys[eqPolys.length - 1][1] = eqPts.length - eqPolys[eqPolys.length - 1][0]; }
  const eqEQD = C.eqjVectors(eqPts), eqENU = new Float64Array(eqEQD.length);

  // alt/az grid lines (already in ENU)
  const azPolys = [];
  for (let alt = -80; alt <= 80; alt += 10) { const p = []; for (let az = 0; az <= 360; az += 2) p.push(C.enuFromAltAz(alt, az)); azPolys.push({ pts: p, alt }); }
  for (let az = 0; az < 360; az += 15) { const p = []; for (let alt = -88; alt <= 88; alt += 2) p.push(C.enuFromAltAz(alt, az)); azPolys.push({ pts: p, az }); }

  // ---------------- sky computation ----------------
  const sky = { t: 0, bodies: [], sunAlt: -90, byName: {} };
  function recompute() {
    const t = simNow();
    const date = new Date(t);
    const rot = C.rotations(date, state.loc);
    C.toENU(rot.eqjToHor, starEQJ, starENU, true);
    C.toENU(rot.eqjToHor, lineEQJ, lineENU, true);
    C.toENU(rot.eqjToHor, cLabelEQJ, cLabelENU, true);
    C.toENU(rot.eqdToHor, eqEQD, eqENU, true);
    sky.bodies = C.bodies(date, state.loc);
    sky.byName = {};
    for (const b of sky.bodies) sky.byName[b.name] = b;
    sky.sunAlt = sky.byName.Sun.alt;
    sky.t = t;
    dirty = true;
  }

  // ---------------- canvas ----------------
  const canvas = $('sky');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, view = null, dirty = true, hits = [];
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    dirty = true;
  }
  window.addEventListener('resize', resize);

  function onScreen(p, m) { return p && p[0] > -m && p[0] < W + m && p[1] > -m && p[1] < H + m; }

  function strokePolyline(getPt, count, minCos) {
    let prev = null;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const v = getPt(i);
      const p = C.project(view, v[0], v[1], v[2], minCos);
      if (p && prev && Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) < (W + H)) ctx.lineTo(p[0], p[1]);
      else if (p) ctx.moveTo(p[0], p[1]);
      prev = p;
    }
    ctx.stroke();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view = C.makeView(state.view.az, state.view.alt, state.view.fov, W, H);
    const atm = state.show.atmosphere, ground = state.show.ground;
    const sunAlt = sky.sunAlt;
    const lim = atm ? C.limitingMag(sunAlt) : 6.0;
    const day = atm ? clamp((sunAlt + 12) / 12, 0, 1) : 0; // 0 night .. 1 day
    const bg = atm ? C.skyColor(sunAlt) : [0, 0, 0];
    const hz = C.horizonShape(view);
    hits = [];

    ctx.fillStyle = rgb(bg);
    ctx.fillRect(0, 0, W, H);
    if (atm) drawHorizonGlow(hz, bg);

    // grids
    ctx.lineWidth = 1;
    if (state.show.grid) {
      ctx.strokeStyle = 'rgba(120,170,255,0.28)';
      for (const g of azPolys) {
        if (ground && g.alt !== undefined && g.alt < 0) continue;
        strokePolyline(i => g.pts[i], g.pts.length, -0.6);
      }
      drawGridLabels();
    }
    if (state.show.eqgrid) {
      ctx.strokeStyle = 'rgba(110,210,170,0.26)';
      for (const [s, n] of eqPolys) strokePolyline(i => [eqENU[3 * (s + i)], eqENU[3 * (s + i) + 1], eqENU[3 * (s + i) + 2]], n, -0.6);
    }

    // constellation figures
    if (state.show.lines) {
      ctx.strokeStyle = `rgba(100,145,215,${(0.55 * (1 - 0.5 * day)).toFixed(3)})`;
      ctx.lineWidth = 1;
      for (const [s, n] of linePolys) strokePolyline(i => [lineENU[3 * (s + i)], lineENU[3 * (s + i) + 1], lineENU[3 * (s + i) + 2]], n, -0.6);
    }

    // stars (faintest first so bright stars sit on top)
    const zf = clamp(Math.pow(90 / view.fov, 0.3), 0.85, 2.2);
    const labelMag = view.fov >= 120 ? 1.0 : view.fov >= 80 ? 1.6 : view.fov >= 50 ? 2.3 : view.fov >= 25 ? 3.2 : 4.5;
    const starLabels = [];
    for (let i = NS - 1; i >= 0; i--) {
      const e = starENU[3 * i], n = starENU[3 * i + 1], u = starENU[3 * i + 2];
      if (ground && u < -0.005) continue;
      const alt = Math.asin(clamp(u, -1, 1)) / DEG;
      const m = D.stars[i][2] + (atm && alt > -1 ? C.extinction(alt) : 0);
      if (m > lim) continue;
      const p = C.project(view, e, n, u);
      if (!onScreen(p, 12)) continue;
      const d = lim - m;
      const r = (0.7 + 0.36 * d) * zf;
      ctx.fillStyle = starColor[i];
      if (d > 5) { // soft glow on the brightest stars
        ctx.globalAlpha = 0.12 * Math.min(1, (d - 5) / 2);
        ctx.beginPath(); ctx.arc(p[0], p[1], r * 2.8, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.globalAlpha = Math.min(1, 0.38 + 0.3 * d);
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.fill();
      hits.push({ x: p[0], y: p[1], r, sel: { kind: 'star', i } });
      if (state.show.snames && D.stars[i][4] && D.stars[i][2] <= labelMag && u > 0) starLabels.push([p, r, D.stars[i][4], D.stars[i][2]]);
    }
    ctx.globalAlpha = 1;

    // Sun, Moon, planets
    const bodyLabels = [];
    drawBodies(lim, atm, ground, zf, bg, bodyLabels);

    // ground and horizon
    if (ground) drawGround(hz, day);
    drawCardinals();

    // labels on top
    ctx.textBaseline = 'alphabetic';
    if (state.show.cnames) {
      ctx.font = `11.5px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(140,175,230,${(0.75 * (1 - 0.4 * day)).toFixed(3)})`;
      const maxRank = view.fov >= 130 ? 1 : view.fov >= 75 ? 2 : 3;
      D.constellations.forEach((c, i) => {
        if (c.rank > maxRank) return;
        const u = cLabelENU[3 * i + 2];
        if (ground && u < 0.02) return;
        const p = C.project(view, cLabelENU[3 * i], cLabelENU[3 * i + 1], u, -0.3);
        if (onScreen(p, 40)) ctx.fillText(c.name.toUpperCase(), p[0], p[1]);
      });
    }
    ctx.textAlign = 'left';
    if (state.show.snames) {
      // Place labels most-important first (Sun/Moon/planets, then brightest stars), skipping any that would overlap.
      ctx.font = `12px ${FONT}`;
      const placed = [];
      const tryLabel = (text, x, y, color) => {
        const w = ctx.measureText(text).width, box = [x - 1, y - 11, x + w + 1, y + 3];
        for (const b of placed) if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return;
        placed.push(box);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
      };
      for (const [p, r, name, col] of bodyLabels) tryLabel(name, p[0] + r + 4, p[1] - r - 2, col);
      starLabels.sort((a, b) => a[3] - b[3]);
      for (const [p, r, name] of starLabels) tryLabel(name, p[0] + r + 3, p[1] - r - 1, 'rgba(205,218,240,0.85)');
    }

    drawSelection();
  }

  function drawHorizonGlow(hz, bg) {
    // Brighter, slightly paler band near the horizon (scattered light / skyglow); faint at night, stronger by day.
    const k = 0.035 + 0.28 * clamp((sky.sunAlt + 12) / 18, 0, 1);
    const glow = bg.map(c => Math.min(255, Math.round(c + (255 - c) * k)));
    const w = 0.4 * view.s;
    let g;
    if (hz.line) {
      g = ctx.createLinearGradient(0, hz.y - w, 0, hz.y);
      g.addColorStop(0, rgba(glow, 0)); g.addColorStop(1, rgba(glow, 1));
    } else if (!hz.groundInside) { // sky inside the circle
      g = ctx.createRadialGradient(hz.cx, hz.cy, Math.max(0, hz.r - w), hz.cx, hz.cy, hz.r);
      g.addColorStop(0, rgba(glow, 0)); g.addColorStop(1, rgba(glow, 1));
    } else { // sky outside the circle
      g = ctx.createRadialGradient(hz.cx, hz.cy, hz.r, hz.cx, hz.cy, hz.r + w);
      g.addColorStop(0, rgba(glow, 1)); g.addColorStop(1, rgba(glow, 0));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function horizonPath(hz, forFill) {
    ctx.beginPath();
    if (hz.line) {
      if (forFill) ctx.rect(-10, hz.y, W + 20, H - hz.y + 10);
      else { ctx.moveTo(-10, hz.y); ctx.lineTo(W + 10, hz.y); }
    } else if (hz.groundInside || !forFill) {
      ctx.moveTo(hz.cx + hz.r, hz.cy);
      ctx.arc(hz.cx, hz.cy, hz.r, 0, 2 * Math.PI);
    } else {
      ctx.rect(-10, -10, W + 20, H + 20);
      ctx.moveTo(hz.cx + hz.r, hz.cy);
      ctx.arc(hz.cx, hz.cy, hz.r, 0, 2 * Math.PI);
    }
  }

  function drawGround(hz, day) {
    const night = [9, 13, 10], daylit = [44, 58, 36];
    const c = night.map((v, i) => Math.round(v + (daylit[i] - v) * day));
    horizonPath(hz, true);
    ctx.fillStyle = rgb(c);
    ctx.fill('evenodd');
    horizonPath(hz, false);
    ctx.strokeStyle = 'rgba(150,175,135,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function drawCardinals() {
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let k = 0; k < 8; k++) {
      const p = C.project(view, ...C.enuFromAltAz(0, k * 45), -0.2);
      if (!onScreen(p, 30)) continue;
      const major = k % 2 === 0;
      ctx.font = `${major ? 600 : 400} ${major ? 17 : 13}px ${FONT}`;
      ctx.fillStyle = k === 0 ? '#ff7a6b' : major ? '#f0d9a8' : 'rgba(225,210,175,0.8)';
      ctx.fillText(names[k], p[0], p[1] + 6);
      ctx.fillRect(p[0] - 0.75, p[1] - 4, 1.5, 8);
    }
  }

  function drawGridLabels() {
    ctx.font = `10.5px ${FONT}`;
    ctx.fillStyle = 'rgba(150,190,255,0.7)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (let alt = 10; alt <= 80; alt += 10) {
      const p = C.project(view, ...C.enuFromAltAz(alt, view.az0), -0.2);
      if (onScreen(p, 0)) ctx.fillText(alt + '°', p[0] + 3, p[1] - 2);
    }
    for (let az = 0; az < 360; az += 15) {
      if (az % 45 === 0) continue;
      const p = C.project(view, ...C.enuFromAltAz(1, az), -0.2);
      if (onScreen(p, 0)) ctx.fillText(az + '°', p[0] + 3, p[1] - 2);
    }
  }

  const PLANET_COLORS = { Mercury: [214, 200, 178], Venus: [255, 246, 220], Mars: [255, 150, 105], Jupiter: [255, 233, 196],
                          Saturn: [240, 220, 160], Uranus: [185, 236, 240], Neptune: [145, 175, 255] };

  function drawBodies(lim, atm, ground, zf, bg, labels) {
    const order = ['Neptune', 'Uranus', 'Saturn', 'Jupiter', 'Mars', 'Mercury', 'Venus', 'Moon', 'Sun'];
    for (const name of order) {
      const b = sky.byName[name];
      const radDeg = b.angRadius / DEG;
      if (ground && b.alt < -radDeg - 0.2) continue;
      const p = C.project(view, b.enu[0], b.enu[1], b.enu[2]);
      if (!onScreen(p, 60)) continue;
      const scale = view.s * 2 / (1 + p[2]); // local stereographic scale (px per radian)
      if (name === 'Sun') {
        const r = Math.max(5, b.angRadius * scale);
        const g = ctx.createRadialGradient(p[0], p[1], r * 0.8, p[0], p[1], r * 5);
        g.addColorStop(0, 'rgba(255,245,210,0.55)'); g.addColorStop(1, 'rgba(255,245,210,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], r * 5, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = '#fff8e2'; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.fill();
        hits.push({ x: p[0], y: p[1], r, sel: { kind: 'body', name } });
        if (b.alt > -radDeg) labels.push([p, r, 'Sun', 'rgba(255,230,170,0.95)']);
      } else if (name === 'Moon') {
        const r = Math.max(7, b.angRadius * scale); // drawn a little larger than life at wide fields so the phase is readable
        drawMoon(p, r, b, bg, atm);
        hits.push({ x: p[0], y: p[1], r, sel: { kind: 'body', name } });
        if (b.alt > -radDeg) labels.push([p, r, 'Moon', 'rgba(235,235,225,0.95)']);
      } else {
        const m = b.mag + (atm && b.alt > -1 ? C.extinction(b.alt) : 0);
        if (m > lim) continue;
        const d = lim - m;
        const r = Math.max(1.8, (0.7 + 0.4 * d) * zf);
        const col = PLANET_COLORS[name];
        ctx.fillStyle = rgb(col);
        ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.arc(p[0], p[1], r * 2.4, 0, 2 * Math.PI); ctx.fill();
        ctx.globalAlpha = Math.min(1, 0.35 + 0.3 * d);
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.fill();
        ctx.globalAlpha = 1;
        hits.push({ x: p[0], y: p[1], r, sel: { kind: 'body', name } });
        if (b.alt > 0 || !ground) labels.push([p, r, name, 'rgba(255,214,150,0.95)']);
      }
    }
  }

  function drawMoon(p, r, moon, bg, atm) {
    // Direction toward the Sun on screen: step a tiny amount from the Moon toward the Sun along the sky.
    const sun = sky.byName.Sun.enu, mv = moon.enu;
    const dot = sun[0] * mv[0] + sun[1] * mv[1] + sun[2] * mv[2];
    let t = [sun[0] - dot * mv[0], sun[1] - dot * mv[1], sun[2] - dot * mv[2]];
    const tl = Math.hypot(t[0], t[1], t[2]) || 1;
    const q = [mv[0] + 0.002 * t[0] / tl, mv[1] + 0.002 * t[1] / tl, mv[2] + 0.002 * t[2] / tl];
    const pq = C.project(view, q[0], q[1], q[2], -1);
    const ang = pq ? Math.atan2(pq[1] - p[1], pq[0] - p[0]) : 0;
    const k = moon.phaseFraction;

    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.rotate(ang); // +x now points toward the Sun
    // unlit disc
    ctx.fillStyle = atm ? rgba(bg.map(c => Math.round(c * 0.8 + 12)), 1) : 'rgb(38,40,48)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 2 * Math.PI); ctx.fill();
    // lit part: sunward half-disc plus/minus the terminator half-ellipse
    const rx = r * Math.abs(2 * k - 1);
    ctx.fillStyle = '#f2efe4';
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);       // top -> right -> bottom
    if (k >= 0.5) ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, 3 * Math.PI / 2, false); // gibbous: bulge away from Sun
    else ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);              // crescent: cut back toward Sun
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function selectionENU(sel) {
    if (!sel) return null;
    if (sel.kind === 'star') return [starENU[3 * sel.i], starENU[3 * sel.i + 1], starENU[3 * sel.i + 2]];
    return sky.byName[sel.name].enu;
  }

  function drawSelection() {
    const v = selectionENU(state.selected);
    if (!v) return;
    const p = C.project(view, v[0], v[1], v[2]);
    if (!onScreen(p, 20)) return;
    let r = 9;
    if (state.selected.kind === 'body' && (state.selected.name === 'Sun' || state.selected.name === 'Moon')) {
      r = Math.max(9, sky.byName[state.selected.name].angRadius * view.s * 2 / (1 + p[2]) + 5);
    }
    ctx.strokeStyle = 'rgba(255,210,120,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.stroke();
  }

  // ---------------- formatting ----------------
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = az => COMPASS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
  const sgn = (x, d) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
  function fmtRA(hours) {
    let s = Math.round(((hours % 24) + 24) % 24 * 36000) / 10; // tenths of seconds
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return `${h}h ${String(m).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`;
  }
  function fmtDec(deg) {
    let s = Math.round(Math.abs(deg) * 3600);
    const d = Math.floor(s / 3600); s -= d * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return `${deg < 0 ? '−' : '+'}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
  }
  function fmtLatLon(lat, lon) {
    return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
  }
  function fmtWhen(d) {
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function moonPhaseName(a) {
    const names = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
    const bounds = [11.25, 78.75, 101.25, 168.75, 191.25, 258.75, 281.25, 348.75];
    for (let i = 0; i < bounds.length; i++) if (a < bounds[i]) return names[i];
    return names[0];
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------- info panel ----------------
  let lastInfo = -Infinity;
  function updateInfo(force) {
    const sel = state.selected;
    const box = $('info');
    if (!sel) { box.hidden = true; return; }
    const nowMs = performance.now();
    if (!force && nowMs - lastInfo < 300) return;
    lastInfo = nowMs;
    const date = new Date(sky.t);
    const rows = [];
    let title, sub;
    if (sel.kind === 'star') {
      const s = D.stars[sel.i];
      const aa = C.altAzFromENU(starENU[3 * sel.i], starENU[3 * sel.i + 1], starENU[3 * sel.i + 2]);
      const con = A.Constellation(s[0] / 15, s[1]);
      title = s[4] || s[5] || 'Star';
      sub = (s[4] && s[5] ? s[5] + ' · ' : '') + 'Star in ' + con.name;
      rows.push(['Magnitude', s[2].toFixed(2)]);
      rows.push(['Altitude', sgn(aa.alt, 2) + '°' + (aa.alt < 0 ? ' (below horizon)' : '')]);
      rows.push(['Azimuth', aa.az.toFixed(2) + '° ' + compass(aa.az)]);
      rows.push(['RA (J2000)', fmtRA(s[0] / 15)]);
      rows.push(['Dec (J2000)', fmtDec(s[1])]);
      rows.push(['Colour (B−V)', s[3].toFixed(2)]);
    } else {
      const b = sky.byName[sel.name];
      const obs = C.observer(state.loc);
      const j2000 = A.Equator(sel.name, date, obs, false, true);
      const con = A.Constellation(j2000.ra, j2000.dec);
      title = sel.name;
      sub = (sel.name === 'Sun' ? 'Star' : sel.name === 'Moon' ? 'Moon' : 'Planet') + ' in ' + con.name;
      rows.push(['Magnitude', b.mag.toFixed(2)]);
      rows.push(['Altitude', sgn(b.alt, 2) + '°' + (b.alt < 0 ? ' (below horizon)' : '')]);
      rows.push(['Azimuth', b.az.toFixed(2) + '° ' + compass(b.az)]);
      rows.push(['RA (of date)', fmtRA(b.raOfDate)]);
      rows.push(['Dec (of date)', fmtDec(b.decOfDate)]);
      rows.push(['Distance', sel.name === 'Moon' ? Math.round(b.dist * 149597870.7).toLocaleString() + ' km' : b.dist.toFixed(3) + ' AU']);
      if (sel.name === 'Moon') {
        rows.push(['Phase', moonPhaseName(A.MoonPhase(date)) + ` (${Math.round(b.phaseFraction * 100)}% lit)`]);
      } else if (sel.name !== 'Sun') {
        rows.push(['Illuminated', Math.round(b.phaseFraction * 100) + '%']);
      }
      try {
        const rise = A.SearchRiseSet(sel.name, obs, +1, date, 2);
        const set = A.SearchRiseSet(sel.name, obs, -1, date, 2);
        rows.push(['Next rise', rise ? fmtWhen(rise.date) : 'not within 2 days']);
        rows.push(['Next set', set ? fmtWhen(set.date) : 'not within 2 days']);
      } catch (e) { /* rise/set search can fail near the poles; just omit it */ }
    }
    $('info-body').innerHTML = `<h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div><table>` +
      rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('') + '</table>';
    box.hidden = false;
  }

  // ---------------- HUD ----------------
  let lastHud = '';
  let SYS_TZ = '';
  try { SYS_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
  function updateHud() {
    const d = new Date(sky.t);
    const loc = state.loc;
    const sunAlt = sky.sunAlt;
    const phase = sunAlt > -0.833 ? 'Daytime' : sunAlt > -6 ? 'Civil twilight' : sunAlt > -12 ? 'Nautical twilight' : sunAlt > -18 ? 'Astronomical twilight' : 'Night';
    const rateTxt = state.rate === 1 ? '' : state.rate === 0 ? ' · ⏸ paused' : ` · time ×${state.rate.toLocaleString()}`;
    const time = d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
    const utc = d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    let localThere = '';
    if (loc.tz && loc.tz !== SYS_TZ) {
      try {
        localThere = `Local time there: ${d.toLocaleString(undefined, { timeZone: loc.tz, weekday: 'short', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}<br>`;
      } catch (e) { /* unknown zone */ }
    }
    const html = `${esc(loc.name)} <span style="font-weight:400;color:var(--muted)">· ${fmtLatLon(loc.lat, loc.lon)}</span>` +
      (loc.guessed ? ' <span class="warn" style="color:#ffcf7a;font-weight:400">(guessed — click to set)</span>' : '');
    const sub = `${utc}${rateTxt}<br>${localThere}${phase} · Sun ${sgn(sunAlt, 1)}°<br>` +
      `Looking ${compass(state.view.az)} (${state.view.az.toFixed(0)}°), ${state.view.alt.toFixed(0)}° up · field ${state.view.fov.toFixed(0)}°`;
    const key = html + time + sub;
    if (key === lastHud) return;
    lastHud = key;
    $('hud-loc').innerHTML = html;
    $('hud-time').textContent = time;
    $('hud-sub').innerHTML = sub;
  }

  // ---------------- date/time input ----------------
  const dtInput = $('dt');
  const pad = n => String(n).padStart(2, '0');
  function toLocalInput(d) {
    const y = d.getFullYear();
    const ys = y < 0 ? '-' + String(-y).padStart(6, '0') : y > 9999 ? '+' + String(y).padStart(6, '0') : String(y).padStart(4, '0');
    return `${ys}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  let lastInputSec = -1;
  function syncTimeInput(force) {
    if (document.activeElement === dtInput && !force) return;
    const sec = Math.floor(sky.t / 1000);
    if (sec === lastInputSec && !force) return;
    lastInputSec = sec;
    dtInput.value = toLocalInput(new Date(sky.t));
  }
  dtInput.addEventListener('change', () => {
    const v = dtInput.value;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
    if (!m) return;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)); // local time
    d.setFullYear(+m[1]); // keep years < 100 literal
    if (!isNaN(d.getTime())) setSim(d.getTime());
  });
  dtInput.addEventListener('blur', () => syncTimeInput(true));

  $('now').addEventListener('click', () => setSim(Date.now(), 1));
  document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => setSim(simNow() + Number(b.dataset.step) * 1000)));
  $('rate').addEventListener('change', e => {
    const r = Number(e.target.value);
    if (r !== 0) state.lastRate = r;
    setSim(simNow(), r);
  });

  // ---------------- view controls ----------------
  document.querySelectorAll('[data-look]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.look === 'up') { state.view.alt = 90; }
    else { state.view.az = Number(b.dataset.look); state.view.alt = DEFAULT_VIEW.alt; state.view.fov = DEFAULT_VIEW.fov; }
    dirty = true;
  }));

  function setToggleButtons() {
    document.querySelectorAll('[data-toggle]').forEach(b => {
      const on = !!state.show[b.dataset.toggle];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function toggle(key) {
    state.show[key] = !state.show[key];
    store.set('show', state.show);
    setToggleButtons();
    dirty = true;
  }
  document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggle(b.dataset.toggle)));

  function normAz(a) { return ((a % 360) + 360) % 360; }
  function pan(dAz, dAlt) {
    state.view.az = normAz(state.view.az + dAz);
    state.view.alt = clamp(state.view.alt + dAlt, -90, 90);
    dirty = true;
  }
  function zoom(factor) {
    state.view.fov = clamp(state.view.fov * factor, 2, 160);
    dirty = true;
  }

  // pointer: drag to pan, click to select, pinch to zoom
  const pointers = new Map();
  let dragMoved = 0, pinch = null;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { dragMoved = 0; canvas.classList.add('dragging'); }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, fov: state.view.fov };
      dragMoved = 99;
    }
  });
  canvas.addEventListener('pointermove', e => {
    updateCursor(e.clientX, e.clientY);
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1 && view) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      pan(-dx / view.s / DEG, dy / view.s / DEG);
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      state.view.fov = clamp(pinch.fov * pinch.d / d, 2, 160);
      dirty = true;
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      canvas.classList.remove('dragging');
      if (dragMoved < 5 && e.type === 'pointerup') select(pick(e.clientX, e.clientY));
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { $('cursor').textContent = ''; });
  canvas.addEventListener('dblclick', e => {
    const h = pick(e.clientX, e.clientY);
    if (!h) return;
    const v = selectionENU(h);
    const aa = C.altAzFromENU(v[0], v[1], v[2]);
    state.view.az = aa.az; state.view.alt = clamp(aa.alt, -90, 90);
    select(h);
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoom(Math.exp(clamp(dy, -300, 300) * 0.0012));
  }, { passive: false });

  function pick(x, y) {
    let best = null, bestD = Infinity;
    for (const h of hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= Math.max(9, h.r + 5) && d - h.r < bestD) { best = h.sel; bestD = d - h.r; }
    }
    return best;
  }
  function select(sel) {
    state.selected = sel;
    dirty = true;
    updateInfo(true);
  }
  $('info-close').addEventListener('click', () => select(null));

  function updateCursor(x, y) {
    if (!view) return;
    const aa = C.unproject(view, x, y);
    $('cursor').textContent = `Alt ${sgn(aa.alt, 1)}°  Az ${aa.az.toFixed(1)}° ${compass(aa.az)}`;
  }

  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, select, textarea, dialog')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = state.view.fov / 18;
    const map = { c: 'lines', v: 'cnames', l: 'snames', g: 'grid', q: 'eqgrid', h: 'ground', a: 'atmosphere' };
    const k = e.key.toLowerCase();
    if (map[k]) toggle(map[k]);
    else if (e.key === 'ArrowLeft') pan(-step, 0);
    else if (e.key === 'ArrowRight') pan(step, 0);
    else if (e.key === 'ArrowUp') pan(0, step);
    else if (e.key === 'ArrowDown') pan(0, -step);
    else if (e.key === '+' || e.key === '=') zoom(1 / 1.25);
    else if (e.key === '-' || e.key === '_') zoom(1.25);
    else if (e.key === ' ') {
      if (e.target.tagName === 'BUTTON') return; // let Space activate the focused button
      const r = state.rate === 0 ? (state.lastRate || 1) : 0;
      if (state.rate !== 0) state.lastRate = state.rate;
      setSim(simNow(), r);
    } else if (e.key === 'Escape') select(null);
    else return;
    e.preventDefault();
  });

  // ---------------- location dialog ----------------
  const dlg = $('loc-dlg');
  let cityMatches = [];
  function renderCities() {
    const q = $('city-q').value.trim().toLowerCase();
    cityMatches = window.CITIES.filter(c => !q || (c[0] + ' ' + c[1]).toLowerCase().includes(q));
    $('city-list').innerHTML = cityMatches.map((c, i) =>
      `<li data-i="${i}">${esc(c[0])} <span>${esc(c[1])} · ${fmtLatLon(c[2], c[3])}</span></li>`).join('');
  }
  let pendingTz = null;
  function chooseCity(c) {
    $('lat').value = c[2]; $('lon').value = c[3]; $('loc-name').value = `${c[0]}, ${c[1]}`;
    pendingTz = c[4];
    document.querySelectorAll('#city-list li').forEach(li => li.classList.toggle('sel', cityMatches[li.dataset.i] === c));
    $('geo-msg').textContent = '';
  }
  $('city-list').addEventListener('click', e => {
    const li = e.target.closest('li');
    if (li) chooseCity(cityMatches[Number(li.dataset.i)]);
  });
  $('city-q').addEventListener('input', renderCities);
  $('city-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (cityMatches[0]) chooseCity(cityMatches[0]); }
  });
  ['lat', 'lon'].forEach(id => $(id).addEventListener('input', () => {
    $('loc-name').value = 'Custom location';
    pendingTz = null;
    document.querySelectorAll('#city-list li.sel').forEach(li => li.classList.remove('sel'));
  }));
  function openLocation() {
    $('lat').value = state.loc.lat; $('lon').value = state.loc.lon; $('loc-name').value = state.loc.name;
    $('city-q').value = ''; $('geo-msg').textContent = '';
    pendingTz = state.loc.tz || null;
    renderCities();
    dlg.showModal();
    $('city-q').focus();
  }
  $('loc-btn').addEventListener('click', openLocation);
  $('hud-loc').addEventListener('click', openLocation);
  $('geo-btn').addEventListener('click', () => {
    const msg = $('geo-msg');
    if (!navigator.geolocation) { msg.textContent = 'Location services are not available. Pick a city or type coordinates.'; return; }
    msg.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(pos => {
      $('lat').value = pos.coords.latitude.toFixed(4);
      $('lon').value = pos.coords.longitude.toFixed(4);
      $('loc-name').value = 'My location';
      pendingTz = SYS_TZ || null;
      msg.textContent = `Found (accurate to about ${Math.round(pos.coords.accuracy)} m). Click "Set location" to use it.`;
    }, err => {
      msg.textContent = 'Couldn\'t get your location (' + (err.message || 'permission denied') + '). Pick a city or type coordinates instead.';
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
    if (!(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return;
    state.loc = { name: $('loc-name').value.trim() || fmtLatLon(lat, lon), lat, lon };
    if (pendingTz) state.loc.tz = pendingTz;
    store.set('loc', state.loc);
    recompute();
    updateInfo(true);
  });

  $('help-btn').addEventListener('click', () => $('help-dlg').showModal());

  // ---------------- main loop ----------------
  let lastSec = -1;
  function frame() {
    const t = simNow();
    if (state.rate !== 0) {
      const sec = Math.floor(t / 1000);
      if (Math.abs(state.rate) > 1 || sec !== lastSec) { lastSec = sec; recompute(); }
    }
    if (dirty) {
      dirty = false;
      draw();
      updateInfo(false);
    }
    updateHud();
    syncTimeInput(false);
    requestAnimationFrame(frame);
  }

  // Optional start-up overrides via URL hash, e.g. index.html#t=2026-12-25T21:00&az=180&alt=30&fov=60&lat=40&lon=-74
  try {
    const hp = new URLSearchParams(location.hash.slice(1));
    const num = k => (hp.has(k) && isFinite(parseFloat(hp.get(k))) ? parseFloat(hp.get(k)) : null);
    if (num('az') !== null) state.view.az = normAz(num('az'));
    if (num('alt') !== null) state.view.alt = clamp(num('alt'), -90, 90);
    if (num('fov') !== null) state.view.fov = clamp(num('fov'), 2, 160);
    if (num('lat') !== null && num('lon') !== null && validLoc({ lat: num('lat'), lon: num('lon') })) {
      state.loc = { name: hp.get('name') || fmtLatLon(num('lat'), num('lon')), lat: num('lat'), lon: num('lon') };
      if (hp.has('tz')) state.loc.tz = hp.get('tz');
    }
    if (hp.has('t') && !isNaN(Date.parse(hp.get('t')))) { state.baseSim = Date.parse(hp.get('t')); state.baseReal = Date.now(); }
    if (num('rate') !== null) state.rate = num('rate');
    for (const k of Object.keys(DEFAULT_SHOW)) if (hp.has(k)) state.show[k] = hp.get(k) !== '0';
    if (hp.has('sel')) {
      const s = hp.get('sel');
      if (C.BODIES.includes(s)) state.selected = { kind: 'body', name: s };
      else { const i = D.stars.findIndex(x => x[4] === s); if (i >= 0) state.selected = { kind: 'star', i }; }
    }
    $('rate').value = String(state.rate);
  } catch (e) { /* ignore malformed hash */ }

  // Read-only hook for automated tests and demo recordings: where is a named object on screen right now?
  window.__skyViewer = {
    state,
    screenOf(name) {
      let v = null;
      if (sky.byName[name]) v = sky.byName[name].enu;
      else { const i = D.stars.findIndex(s => s[4] === name); if (i >= 0) v = [starENU[3 * i], starENU[3 * i + 1], starENU[3 * i + 2]]; }
      return v && view ? C.project(view, v[0], v[1], v[2]) : null;
    },
  };

  resize();
  setToggleButtons();
  recompute();
  syncTimeInput(true);
  requestAnimationFrame(frame);
})();
