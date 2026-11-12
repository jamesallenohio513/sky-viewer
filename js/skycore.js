/*
 * SkyCore — the astronomy and projection maths for Sky Viewer.
 *
 * Coordinate conventions used throughout:
 *   EQJ  : J2000 mean equator & equinox (the star catalog's frame).
 *   ENU  : observer's local frame. x = East, y = North, z = Up (zenith).
 *   Azimuth is measured from North toward East (N=0, E=90, S=180, W=270).
 *
 * All precise astronomy (precession, nutation, Earth rotation, refraction,
 * Sun/Moon/planet ephemerides) is delegated to astronomy-engine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.SkyCore = factory(root.Astronomy);
})(this, function (A) {
  'use strict';
  const DEG = Math.PI / 180;

  // ---------- catalog -> unit vectors ----------
  function eqjVectors(points /* [[raDeg, decDeg], ...] */) {
    const out = new Float64Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const ra = points[i][0] * DEG, dec = points[i][1] * DEG;
      const c = Math.cos(dec);
      out[3 * i] = c * Math.cos(ra);
      out[3 * i + 1] = c * Math.sin(ra);
      out[3 * i + 2] = Math.sin(dec);
    }
    return out;
  }

  function observer(loc) {
    return new A.Observer(loc.lat, loc.lon, loc.elev || 0);
  }

  // Rotation matrices for the current time/place (astronomy-engine layout: rot[col][row]).
  function rotations(date, loc) {
    const obs = observer(loc);
    return {
      eqjToHor: A.Rotation_EQJ_HOR(date, obs).rot,
      eqdToHor: A.Rotation_EQD_HOR(date, obs).rot,
    };
  }

  /*
   * Transform unit vectors from an equatorial frame into ENU using a rotation
   * from astronomy-engine (whose horizontal frame is x=North, y=West, z=Zenith).
   * If `refract` is true, apply standard atmospheric refraction to the altitude.
   */
  function toENU(rot, src, out, refract) {
    const n = src.length / 3;
    for (let i = 0; i < n; i++) {
      const x = src[3 * i], y = src[3 * i + 1], z = src[3 * i + 2];
      const hn = rot[0][0] * x + rot[1][0] * y + rot[2][0] * z; // north
      const hw = rot[0][1] * x + rot[1][1] * y + rot[2][1] * z; // west
      let hu = rot[0][2] * x + rot[1][2] * y + rot[2][2] * z;   // up
      let e = -hw, nn = hn;
      if (refract) {
        const h = Math.hypot(e, nn);
        const alt = Math.atan2(hu, h) / DEG;
        const alt2 = (alt + A.Refraction('normal', alt)) * DEG;
        if (h > 1e-12) {
          const k = Math.cos(alt2) / h;
          e *= k; nn *= k;
        }
        hu = Math.sin(alt2);
      }
      out[3 * i] = e; out[3 * i + 1] = nn; out[3 * i + 2] = hu;
    }
    return out;
  }

  function enuFromAltAz(altDeg, azDeg) {
    const a = altDeg * DEG, z = azDeg * DEG, c = Math.cos(a);
    return [c * Math.sin(z), c * Math.cos(z), Math.sin(a)];
  }

  function altAzFromENU(e, n, u) {
    let az = Math.atan2(e, n) / DEG;
    if (az < 0) az += 360;
    return { alt: Math.atan2(u, Math.hypot(e, n)) / DEG, az };
  }

  // ---------- Sun, Moon, planets ----------
  const BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  const AU_KM = 149597870.7;
  const RADIUS_KM = { Sun: 695700, Moon: 1737.4 };

  function bodies(date, loc) {
    const obs = observer(loc);
    const out = [];
    for (const name of BODIES) {
      // Topocentric apparent coordinates of date (includes aberration, light time,
      // precession, nutation, parallax), then horizontal with refraction.
      const eq = A.Equator(name, date, obs, true, true);
      const hor = A.Horizon(date, obs, eq.ra, eq.dec, 'normal');
      const ill = A.Illumination(name, date);
      const radKm = RADIUS_KM[name];
      out.push({
        kind: 'body', name,
        raOfDate: eq.ra, decOfDate: eq.dec, dist: eq.dist,
        alt: hor.altitude, az: hor.azimuth,
        enu: enuFromAltAz(hor.altitude, hor.azimuth),
        mag: ill.mag,
        phaseFraction: ill.phase_fraction,
        angRadius: radKm ? Math.asin(Math.min(1, radKm / (eq.dist * AU_KM))) : 0,
      });
    }
    return out;
  }

  // ---------- stereographic projection ----------
  /*
   * The camera looks at (az0, alt0). Stereographic projection preserves
   * shapes, like a panorama viewer, and works up to very wide fields.
   * fovDeg is the angle spanned by the shorter side of the window.
   */
  function makeView(az0, alt0, fovDeg, width, height) {
    const a = alt0 * DEG, z = az0 * DEG;
    const f = [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)];
    const r = [Math.cos(z), -Math.sin(z), 0];
    const u = [ // u = r x f
      r[1] * f[2] - r[2] * f[1],
      r[2] * f[0] - r[0] * f[2],
      r[0] * f[1] - r[1] * f[0],
    ];
    const s = (Math.min(width, height) / 2) / (2 * Math.tan(fovDeg * DEG / 4));
    return { az0, alt0, fov: fovDeg, f, r, u, s, cx: width / 2, cy: height / 2, w: width, h: height };
  }

  // Returns [sx, sy, cosAngleFromCenter] or null when too close to the antipode.
  function project(v, e, n, up, minCos) {
    const df = e * v.f[0] + n * v.f[1] + up * v.f[2];
    if (df < (minCos === undefined ? -0.9 : minCos)) return null;
    const dr = e * v.r[0] + n * v.r[1] + up * v.r[2];
    const du = e * v.u[0] + n * v.u[1] + up * v.u[2];
    const k = 2 / (1 + df);
    return [v.cx + dr * k * v.s, v.cy - du * k * v.s, df];
  }

  function unproject(v, sx, sy) {
    const x = (sx - v.cx) / v.s, y = (v.cy - sy) / v.s;
    const p2 = x * x + y * y, d = 4 + p2;
    const cr = 4 * x / d, cu = 4 * y / d, cf = (4 - p2) / d;
    const e = cr * v.r[0] + cu * v.u[0] + cf * v.f[0];
    const n = cr * v.r[1] + cu * v.u[1] + cf * v.f[1];
    const up = cr * v.r[2] + cu * v.u[2] + cf * v.f[2];
    return altAzFromENU(e, n, up);
  }

  /*
   * The horizon (a great circle) projects to a circle (or a straight line when
   * looking exactly at the horizon). Derived from the inverse stereographic map:
   * centre (0, 2*cot(alt0)), radius 2/|sin(alt0)| in projection units.
   */
  function horizonShape(v) {
    const sa = Math.sin(v.alt0 * DEG), ca = Math.cos(v.alt0 * DEG);
    const lineY = v.cy - (-2 * Math.tan(v.alt0 * DEG / 2)) * v.s; // horizon point straight below/above centre
    if (Math.abs(sa) < 1e-4 || (2 / Math.abs(sa)) * v.s > 2e5) {
      return { line: true, y: lineY };
    }
    return {
      line: false,
      cx: v.cx,
      cy: v.cy - (2 * ca / sa) * v.s,
      r: (2 / Math.abs(sa)) * v.s,
      groundInside: sa < 0, // looking down: the view centre (ground) is inside the circle
    };
  }

  // ---------- appearance ----------
  // Naked-eye limiting magnitude as twilight deepens (dark, rural sky at full night).
  function limitingMag(sunAlt) {
    const pts = [[10, -3], [0, -1.5], [-3, 1], [-6, 2.5], [-9, 3.8], [-12, 4.8], [-15, 5.5], [-18, 6.0]];
    if (sunAlt >= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (sunAlt >= pts[i][0]) {
        const [a0, m0] = pts[i - 1], [a1, m1] = pts[i];
        return m0 + (m1 - m0) * (sunAlt - a0) / (a1 - a0);
      }
    }
    return 6.0;
  }

  // Atmospheric extinction (mag) at a given apparent altitude, Kasten–Young airmass.
  function extinction(altDeg) {
    if (altDeg <= -1) return 99;
    const h = Math.max(altDeg, 0);
    const X = 1 / (Math.sin(h * DEG) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
    return 0.22 * (X - 1);
  }

  function mix(c0, c1, t) {
    return [0, 1, 2].map(i => Math.round(c0[i] + (c1[i] - c0[i]) * t));
  }

  function skyColor(sunAlt) {
    const pts = [[-18, [1, 3, 9]], [-12, [5, 10, 26]], [-6, [18, 32, 66]], [-3, [40, 70, 120]],
                 [0, [70, 112, 170]], [8, [95, 150, 215]], [90, [105, 160, 225]]];
    if (sunAlt <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (sunAlt <= pts[i][0]) {
        const [a0, c0] = pts[i - 1], [a1, c1] = pts[i];
        return mix(c0, c1, (sunAlt - a0) / (a1 - a0));
      }
    }
    return pts[pts.length - 1][1];
  }

  // Approximate star colour from B–V colour index.
  function bvColor(bv) {
    const pts = [[-0.4, [155, 176, 255]], [0.0, [202, 215, 255]], [0.3, [248, 247, 255]],
                 [0.6, [255, 244, 234]], [0.9, [255, 228, 196]], [1.3, [255, 206, 152]], [2.0, [255, 170, 110]]];
    if (bv <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (bv <= pts[i][0]) {
        const [b0, c0] = pts[i - 1], [b1, c1] = pts[i];
        return mix(c0, c1, (bv - b0) / (b1 - b0));
      }
    }
    return pts[pts.length - 1][1];
  }

  return {
    DEG, BODIES, eqjVectors, rotations, toENU, enuFromAltAz, altAzFromENU, bodies,
    makeView, project, unproject, horizonShape, limitingMag, extinction, skyColor, bvColor, observer,
  };
});
