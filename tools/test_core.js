// Numerical tests for js/skycore.js.  Run: node tools/test_core.js
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'vendor', 'astronomy.js'));
const Core = require(path.join(__dirname, '..', 'js', 'skycore.js'))(A);
global.window = {};
require(path.join(__dirname, '..', 'data', 'sky-data.js'));
const D = global.window.SKY_DATA;

let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) fails++;
}
function angSep(alt1, az1, alt2, az2) {
  const a = Core.enuFromAltAz(alt1, az1), b = Core.enuFromAltAz(alt2, az2);
  return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / Core.DEG;
}

const cases = [
  { date: new Date('2026-11-11T22:00:00Z'), loc: { lat: 51.4769, lon: -0.0005 } },
  { date: new Date('2026-06-21T04:30:00Z'), loc: { lat: 40.7128, lon: -74.006 } },
  { date: new Date('2030-01-01T12:00:00Z'), loc: { lat: -33.8688, lon: 151.2093 } },
  { date: new Date('1999-08-11T11:00:00Z'), loc: { lat: 64.1466, lon: -21.9426 } },
];

// 1. Star pipeline (matrix + refraction) vs. independent astronomy-engine path
//    (precess to equator of date, then Horizon() which uses sidereal-time spin).
for (const c of cases) {
  const vecs = Core.eqjVectors(D.stars.map(s => [s[0], s[1]]));
  const rot = Core.rotations(c.date, c.loc);
  const enu = Core.toENU(rot.eqjToHor, vecs, new Float64Array(vecs.length), true);
  const obs = new A.Observer(c.loc.lat, c.loc.lon, 0);
  const pre = A.Rotation_EQJ_EQD(c.date);
  let maxErr = 0;
  for (let i = 0; i < D.stars.length; i += 7) {
    const v = new A.Vector(vecs[3 * i], vecs[3 * i + 1], vecs[3 * i + 2], A.MakeTime(c.date));
    const eqd = A.EquatorFromVector(A.RotateVector(pre, v));
    const hor = A.Horizon(c.date, obs, eqd.ra, eqd.dec, 'normal');
    if (hor.altitude < -0.5) continue;
    const mine = Core.altAzFromENU(enu[3 * i], enu[3 * i + 1], enu[3 * i + 2]);
    maxErr = Math.max(maxErr, angSep(mine.alt, mine.az, hor.altitude, hor.azimuth));
  }
  check(`stars alt/az vs Horizon() @ ${c.date.toISOString()} lat ${c.loc.lat}`, maxErr < 1 / 3600,
        `max error ${(maxErr * 3600).toFixed(3)} arcsec`);
}

// 2. Polaris altitude ~= latitude (within its ~0.7 deg polar distance + refraction).
for (const c of cases.filter(c => c.loc.lat > 0)) {
  const i = D.stars.findIndex(s => s[4] === 'Polaris');
  const vecs = Core.eqjVectors([[D.stars[i][0], D.stars[i][1]]]);
  const e = Core.toENU(Core.rotations(c.date, c.loc).eqjToHor, vecs, new Float64Array(3), true);
  const aa = Core.altAzFromENU(e[0], e[1], e[2]);
  check(`Polaris near north at lat ${c.loc.lat}`, Math.abs(aa.alt - c.loc.lat) < 1.0 && (aa.az < 2 || aa.az > 358),
        `alt ${aa.alt.toFixed(2)} az ${aa.az.toFixed(2)}`);
}

// 3. Bodies: compare with the J2000-vector + rotation-matrix path.
for (const c of cases) {
  const list = Core.bodies(c.date, c.loc);
  const obs = new A.Observer(c.loc.lat, c.loc.lon, 0);
  let maxErr = 0;
  for (const b of list) {
    const eq = A.Equator(b.name, c.date, obs, false, true);
    const hv = A.RotateVector(A.Rotation_EQJ_HOR(c.date, obs), eq.vec);
    const hs = A.HorizonFromVector(hv, 'normal');
    maxErr = Math.max(maxErr, angSep(b.alt, b.az, hs.lat, hs.lon));
  }
  check(`bodies alt/az two-path agreement @ ${c.date.toISOString()}`, maxErr < 2 / 3600,
        `max ${(maxErr * 3600).toFixed(3)} arcsec`);
}

// 4. Real-world sanity: Sun at Greenwich, March equinox 2026, local solar noon ~12:07 UTC.
{
  const sun = Core.bodies(new Date('2026-03-20T12:07:00Z'), { lat: 51.4769, lon: 0 })[0];
  check('Sun altitude at Greenwich equinox noon ~38.5 deg, due south', Math.abs(sun.alt - 38.55) < 0.4 && Math.abs(sun.az - 180) < 1.5,
        `alt ${sun.alt.toFixed(2)} az ${sun.az.toFixed(2)}`);
  const sunNYsolstice = Core.bodies(new Date('2026-06-21T16:57:00Z'), { lat: 40.7128, lon: -74.006 })[0];
  check('Sun at NYC June solstice noon ~72.7 deg', Math.abs(sunNYsolstice.alt - 72.7) < 0.4,
        `alt ${sunNYsolstice.alt.toFixed(2)}`);
}

// 5. Projection orientation and round trip.
{
  const v = Core.makeView(0, 0, 90, 1000, 800);
  const east = Core.enuFromAltAz(0, 45), up = Core.enuFromAltAz(30, 0), west = Core.enuFromAltAz(0, 315);
  const pe = Core.project(v, ...east), pu = Core.project(v, ...up), pw = Core.project(v, ...west);
  check('facing north: east is to the right', pe[0] > v.cx && Math.abs(pe[1] - v.cy) < 1e-6);
  check('facing north: west is to the left', pw[0] < v.cx);
  check('facing north: higher altitude is up the screen', pu[1] < v.cy && Math.abs(pu[0] - v.cx) < 1e-6);
  const edge = Core.project(v, ...Core.enuFromAltAz(45, 0));
  check('fov 90 maps 45 deg to the half-height edge', Math.abs(edge[1] - 0) < 1e-6, `y=${edge[1]}`);
  let maxErr = 0;
  for (const [az0, alt0] of [[0, 20], [123, -40], [270, 89.9], [10, 90], [200, -90]]) {
    const vv = Core.makeView(az0, alt0, 100, 1200, 700);
    for (let k = 0; k < 200; k++) {
      const alt = Math.random() * 180 - 90, az = Math.random() * 360;
      const p = Core.project(vv, ...Core.enuFromAltAz(alt, az));
      if (!p) continue;
      const q = Core.unproject(vv, p[0], p[1]);
      maxErr = Math.max(maxErr, angSep(alt, az, q.alt, q.az));
    }
  }
  check('project/unproject round trip', maxErr < 1e-5, `max ${maxErr.toExponential(2)} deg`);
}

// 6. Horizon circle formula: projected alt=0 points lie on the predicted circle/line.
{
  let maxErr = 0;
  for (const alt0 of [25, 60, 89, -15, -70, 0, 0.001]) {
    const v = Core.makeView(37, alt0, 90, 1000, 800);
    const hz = Core.horizonShape(v);
    for (let az = 0; az < 360; az += 5) {
      const p = Core.project(v, ...Core.enuFromAltAz(0, az), -0.99);
      if (!p || p[0] < -2000 || p[0] > 3000 || p[1] < -2000 || p[1] > 2800) continue; // on or near screen
      const err = hz.line ? Math.abs(p[1] - hz.y) : Math.abs(Math.hypot(p[0] - hz.cx, p[1] - hz.cy) - hz.r);
      maxErr = Math.max(maxErr, err / (hz.line ? 1 : Math.max(1, hz.r / 1000)));
    }
    // ground side: a point 10 deg below horizon must be on the ground side
    const g = Core.project(v, ...Core.enuFromAltAz(-10, 37 + 180 * (alt0 < 0 ? 0 : 0)), -0.99);
    if (g) {
      const inside = hz.line ? g[1] > hz.y : Math.hypot(g[0] - hz.cx, g[1] - hz.cy) < hz.r;
      const groundInside = hz.line ? true : hz.groundInside;
      check(`ground side correct (alt0=${alt0})`, inside === groundInside);
    }
  }
  check('horizon projects onto predicted circle/line (sub-pixel)', maxErr < 0.5, `max dev ${maxErr.toFixed(4)} px`);
}

// 7. Appearance helpers
check('limiting mag full night = 6', Core.limitingMag(-30) === 6);
check('limiting mag daytime < 0', Core.limitingMag(20) < 0);
check('extinction zenith ~0', Core.extinction(90) < 0.01);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nAll tests passed.');
process.exit(fails ? 1 : 0);
