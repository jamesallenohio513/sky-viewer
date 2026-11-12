// End-to-end UI test: drives headless Edge over the DevTools protocol.
// Run: node tools/test_ui.js <screenshot-dir>
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.argv[2] || '.';
const URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/') +
  '#t=2026-11-12T03:00:00Z&lat=40.7128&lon=-74.006&name=NYC&rate=0';
const PORT = 9333 + Math.floor(Math.random() * 500);

let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const prof = path.join(OUT, 'cdp_profile_' + PORT);
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
    '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args.map(a => a.value)));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' }, extra));
  const key = async (k, code) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code }); };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64')); };
  const hud = () => evaluate(`document.getElementById('hud-sub').innerText`);

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await sleep(1500);

  check('page loaded without errors', errors.length === 0, errors.join(' | '));
  check('defaults to facing north, horizon visible', /Looking N \(0°\), 20° up/.test(await hud()), await hud());

  // Drag the sky: mouse moves right 300 px -> view turns toward the west (azimuth decreases).
  await mouse('mousePressed', 700, 400);
  for (let x = 700; x >= 400; x -= 30) await mouse('mouseMoved', x, 400, { buttons: 1 });
  await mouse('mouseReleased', 400, 400);
  await sleep(100);
  let h = await hud();
  const az1 = Number(/Looking \w+ \((\d+)°\)/.exec(h)[1]);
  check('dragging left turns view east (az increases)', az1 > 20 && az1 < 90, h.split('\n').pop());
  await mouse('mousePressed', 400, 400);
  for (let x = 400; x <= 1000; x += 30) await mouse('mouseMoved', x, 400, { buttons: 1 });
  await mouse('mouseReleased', 1000, 400);
  await sleep(100);
  h = await hud();
  const az2 = Number(/Looking \w+ \((\d+)°\)/.exec(h)[1]);
  check('dragging right turns view west (wraps past north)', az2 > 270 && az2 < 345, h.split('\n').pop());

  // Vertical drag: mouse down -> look higher.
  await mouse('mousePressed', 700, 300);
  for (let y = 300; y <= 500; y += 20) await mouse('mouseMoved', 700, y, { buttons: 1 });
  await mouse('mouseReleased', 700, 500);
  await sleep(100);
  h = await hud();
  check('dragging down tilts view up', /, (\d+)° up/.exec(h) && Number(/, (-?\d+)° up/.exec(h)[1]) > 30, h.split('\n').pop());

  // Zoom with wheel
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: -500 });
  await sleep(100);
  h = await hud();
  check('wheel zooms in (field narrows)', Number(/field (\d+)°/.exec(h)[1]) < 90, h.split('\n').pop());

  // Look buttons
  await evaluate(`document.querySelector('[data-look="0"]').click()`); await sleep(100);
  check('N button resets to north view', /Looking N \(0°\), 20° up · field 90°/.test(await hud()));

  // Click on Polaris to select it: find its screen position via unprojection search in-page.
  const pol = await evaluate(`(() => {
    const D = window.SKY_DATA; const i = D.stars.findIndex(s => s[4] === 'Polaris');
    // compute with the same pipeline the app uses
    const C = window.SkyCore; const t = Date.parse('2026-11-12T03:00:00Z');
    const rot = C.rotations(new Date(t), {lat: 40.7128, lon: -74.006});
    const v = C.toENU(rot.eqjToHor, C.eqjVectors([[D.stars[i][0], D.stars[i][1]]]), new Float64Array(3), true);
    const view = C.makeView(0, 20, 90, innerWidth, innerHeight);
    return C.project(view, v[0], v[1], v[2]);
  })()`);
  await mouse('mousePressed', pol[0], pol[1]); await mouse('mouseReleased', pol[0], pol[1]);
  await sleep(400);
  const info = await evaluate(`document.getElementById('info').hidden ? '' : document.getElementById('info').innerText`);
  check('clicking Polaris shows its info panel', /Polaris/.test(info) && /Ursa Minor/.test(info), info.replace(/\n/g, ' | '));
  const polAlt = Number(/Altitude\s*\+?([\d.]+)/.exec(info)?.[1]);
  check('Polaris altitude ~ NYC latitude (40.7°)', Math.abs(polAlt - 40.7) < 1, polAlt);
  await shot('ui_polaris.png');

  // Keyboard toggles
  await key('g', 'KeyG'); await sleep(50);
  check('G toggles alt/az grid on', await evaluate(`document.querySelector('[data-toggle=grid]').classList.contains('on')`));
  await key('g', 'KeyG'); await sleep(50);
  await key('Escape', 'Escape'); await sleep(50);
  check('Escape closes info panel', await evaluate(`document.getElementById('info').hidden`));

  // Time step buttons
  const t0 = await evaluate(`document.getElementById('dt').value`);
  await evaluate(`document.querySelector('[data-step="3600"]').click()`); await sleep(100);
  const t1 = await evaluate(`document.getElementById('dt').value`);
  check('+1h advances the clock by an hour', t0.slice(11, 13) !== t1.slice(11, 13) && t0.slice(14) === t1.slice(14), `${t0} -> ${t1}`);

  // Set the date/time input directly
  await evaluate(`(() => { const i = document.getElementById('dt'); i.value = '2027-01-15T21:30:00'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(100);
  check('typing a date/time updates the sky clock', /Jan 15, 2027/.test(await evaluate(`document.getElementById('hud-time').innerText`)), await evaluate(`document.getElementById('hud-time').innerText`));

  // Location dialog: search and pick a city
  await evaluate(`document.getElementById('loc-btn').click()`); await sleep(100);
  check('location dialog opens', await evaluate(`document.getElementById('loc-dlg').open`));
  await evaluate(`(() => { const q = document.getElementById('city-q'); q.value = 'reyk'; q.dispatchEvent(new Event('input')); })()`);
  await evaluate(`document.querySelector('#city-list li').click()`);
  await evaluate(`document.getElementById('loc-ok').click()`); await sleep(200);
  check('choosing Reykjavík sets the location', /Reykjavík/.test(await evaluate(`document.getElementById('hud-loc').innerText`)));
  check('location persisted', /Reykj/.test(await evaluate(`localStorage.getItem('skyviewer.loc')`) || ''));

  // Manual coordinates
  await evaluate(`document.getElementById('loc-btn').click()`); await sleep(100);
  await evaluate(`(() => { const a = document.getElementById('lat'), b = document.getElementById('lon');
    a.value = '-45.5'; a.dispatchEvent(new Event('input')); b.value = '170.25'; b.dispatchEvent(new Event('input')); })()`);
  await evaluate(`document.getElementById('loc-ok').click()`); await sleep(200);
  check('typed coordinates set the location', /45\.5000° S, 170\.2500° E/.test(await evaluate(`document.getElementById('hud-loc').innerText`)));
  // Invalid latitude must be rejected by the form
  await evaluate(`document.getElementById('loc-btn').click()`); await sleep(100);
  await evaluate(`(() => { const a = document.getElementById('lat'); a.value = '123'; a.dispatchEvent(new Event('input')); })()`);
  await evaluate(`document.getElementById('loc-ok').click()`); await sleep(200);
  check('invalid latitude rejected (dialog stays open)', await evaluate(`document.getElementById('loc-dlg').open`));
  await evaluate(`document.getElementById('loc-dlg').close('cancel')`); await sleep(100);
  check('location unchanged after cancel', /45\.5000° S/.test(await evaluate(`document.getElementById('hud-loc').innerText`)));

  // Now button resumes real time at the current moment
  await evaluate(`document.getElementById('now').click()`); await sleep(1200);
  const dtNow = await evaluate(`document.getElementById('dt').value`);
  const realNow = await evaluate(`(() => { const d = new Date(); const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes()); })()`);
  check('Now button jumps to the current time', dtNow.slice(0, 16) === realNow, `${dtNow} vs ${realNow}`);
  check('Now sets real-time flow', (await evaluate(`document.getElementById('rate').value`)) === '1');

  // Fast-forward animates the clock
  await evaluate(`(() => { const s = document.getElementById('rate'); s.value = '3600'; s.dispatchEvent(new Event('change')); })()`);
  const a = await evaluate(`document.getElementById('hud-time').innerText`); await sleep(1500);
  const b = await evaluate(`document.getElementById('hud-time').innerText`);
  check('time-flow 1 hour/sec advances the sky', a !== b, `${a} -> ${b}`);
  await key(' ', 'Space'); await sleep(100);
  check('Space pauses time', (await evaluate(`document.getElementById('rate').value`)) === '0');

  check('no runtime errors during interaction', errors.length === 0, errors.join(' | '));
  await shot('ui_end.png');

  ws.close(); edge.kill();
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nAll UI tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
