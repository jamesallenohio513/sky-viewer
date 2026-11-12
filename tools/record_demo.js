// Records a scripted demo of Sky Viewer, frame by frame, via headless Edge + CDP.
// Usage: node tools/record_demo.js <framesDir>   then encode frames with ffmpeg, e.g.:
//   ffmpeg -framerate 30 -i <framesDir>/f_%05d.jpg -vf "scale=in_range=pc:out_range=tv,format=yuv420p" -c:v libx264 -crf 22 -movflags +faststart docs/report/sky-viewer-demo.mp4
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.argv[2];
const W = 1280, H = 720, FPS = 30;
const URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/') +
  '#t=2026-11-20T00:30:00Z&lat=40.7128&lon=-74.006&name=' + encodeURIComponent('New York, USA') + '&tz=America/New_York&rate=0';
const PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(OUT, '..', 'prof_' + PORT)}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch (e) {} await sleep(200); }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') console.error('PAGE ERROR', JSON.stringify(m.params.exceptionDetails).slice(0, 300)); });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await sleep(1500);

  // Overlay: a visible mouse cursor, click ripples, and a caption bar (recording only; not part of the app).
  await ev(`(() => {
    const st = document.createElement('style');
    st.textContent = \`
      #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;pointer-events:none;z-index:9999;transform:translate(-2px,-2px)}
      .demo-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid rgba(255,214,140,.95);pointer-events:none;z-index:9998}
      #demo-cap{pointer-events:none;user-select:none;position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:9997;padding:9px 18px;border-radius:999px;
        background:rgba(10,16,30,.78);border:1px solid rgba(160,190,240,.28);color:#eef3ff;font:500 17px "Segoe UI",sans-serif;
        letter-spacing:.01em;white-space:nowrap;transition:opacity .25s}\`;
    document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'demo-cursor';
    c.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M2 2 L2 18 L6.5 13.8 L9.6 20.4 L12.4 19.1 L9.4 12.6 L15.6 12.6 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = 'demo-cap'; cap.style.opacity = 0; document.body.appendChild(cap);
    window.__ripples = [];
    addEventListener('pointermove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('pointerdown', e => { const r = document.createElement('div'); r.className = 'demo-ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); window.__ripples.push([r, 0]); }, true);
    window.__tickRipples = () => { window.__ripples = window.__ripples.filter(x => { x[1]++; const k = x[1] / 12;
      x[0].style.transform = 'scale(' + (0.4 + k) + ')'; x[0].style.opacity = String(1 - k); if (k >= 1) { x[0].remove(); return false; } return true; }); };
    window.__caption = t => { cap.textContent = t || ''; cap.style.opacity = t ? 1 : 0; };
    // the app's own top-left HUD would sit under the caption pill only on narrow screens; fine at 1280 wide
  })()`);

  let frame = 0;
  let mouse = { x: W / 2, y: H / 2 };
  async function snap() {
    await ev(`(window.__tickRipples(), new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    fs.writeFileSync(path.join(OUT, `f_${String(frame++).padStart(5, '0')}.jpg`), Buffer.from(r.result.data, 'base64'));
  }
  const hold = async sec => { for (let i = 0; i < Math.round(sec * FPS); i++) await snap(); };
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const md = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' }, extra));
  async function moveTo(x, y, sec, buttons = 0) {
    const x0 = mouse.x, y0 = mouse.y, n = Math.max(1, Math.round(sec * FPS));
    for (let i = 1; i <= n; i++) { const k = ease(i / n); mouse = { x: x0 + (x - x0) * k, y: y0 + (y - y0) * k };
      await md('mouseMoved', mouse.x, mouse.y, buttons ? { buttons, button: 'left' } : { button: 'none' }); await snap(); }
  }
  async function drag(x1, y1, sec) { await md('mousePressed', mouse.x, mouse.y); await moveTo(x1, y1, sec, 1); await md('mouseReleased', mouse.x, mouse.y); }
  async function click(x, y, dbl) {
    await md('mousePressed', x, y); await md('mouseReleased', x, y);
    if (dbl) { await md('mousePressed', x, y, { clickCount: 2 }); await md('mouseReleased', x, y, { clickCount: 2 }); }
  }
  const center = async sel => (await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`));
  async function clickEl(sel, sec = 0.6) { const [x, y] = await center(sel); await moveTo(x, y, sec); await click(x, y); await snap(); }
  async function wheel(dy, steps, sec) { const n = Math.round(sec * FPS); for (let i = 0; i < n; i++) { if (i % Math.max(1, Math.floor(n / steps)) === 0) await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mouse.x, y: mouse.y, deltaX: 0, deltaY: dy }); await snap(); } }
  const caption = t => ev(`window.__caption(${JSON.stringify(t)})`);
  const setTime = local => ev(`(() => { const i = document.getElementById('dt'); i.value = ${JSON.stringify(local)}; i.dispatchEvent(new Event('change')); })()`);
  const pad = n => String(n).padStart(2, '0');
  const fmtLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  // ---- storyboard ----
  await md('mouseMoved', mouse.x, mouse.y, { button: 'none' });
  await caption('Opens on tonight\'s sky, looking north'); await hold(2.6);

  await caption('Drag the sky like a panorama');
  await moveTo(1000, 380, 0.6);
  await drag(250, 330, 3.2);           // turns the view toward the east
  await moveTo(1000, 360, 0.5);
  await drag(380, 330, 2.6);           // keep turning toward the south-east / south
  await moveTo(640, 220, 0.5);
  await drag(640, 470, 1.6);           // tilt up so the high Moon comes into the middle of the view
  await hold(0.5);

  const moon = await ev(`window.__skyViewer.screenOf('Moon')`);
  console.log('moon at', moon);
  await caption('Double-click the Moon to centre it, then zoom in');
  await moveTo(moon[0], moon[1], 0.9);
  await click(moon[0], moon[1], true); await hold(0.6);
  await moveTo(W / 2, H / 2, 0.4);
  await wheel(-160, 12, 2.0);
  await caption('Its phase is computed for the exact moment');
  await hold(1.6);
  await wheel(220, 10, 1.4);
  await hold(0.4);

  await caption('Run time forward and the sky turns');
  await click(W / 2 + 300, H / 2 + 200); // clear selection by clicking empty sky
  await ev(`(() => { const i = document.getElementById('info'); })()`);
  const t0 = new Date(await ev(`(() => { const v = document.getElementById('dt').value; return v; })()`));
  for (let i = 1; i <= 150; i++) { await setTime(fmtLocal(new Date(t0.getTime() + i * 150 * 1000))); await snap(); } // 6 h 15 m in 5 s
  await hold(0.4);

  await caption('Look east: Orion is up after midnight');
  await clickEl('[data-look="90"]'); await hold(0.8);
  const bet = await ev(`window.__skyViewer.screenOf('Betelgeuse')`);
  await caption('Click any star for its details');
  await moveTo(bet[0], bet[1], 0.8); await click(bet[0], bet[1]); await hold(2.2);

  await caption('Grids and labels at a keystroke');
  await clickEl('[data-toggle="grid"]', 0.7); await hold(1.2);
  await clickEl('[data-toggle="grid"]', 0.3); await hold(0.3);

  await caption('Set any place on Earth');
  await clickEl('#loc-btn', 0.8); await hold(0.4);
  for (const ch of 'Sydney') { await send('Input.insertText', { text: ch }); await ev(`document.getElementById('city-q').dispatchEvent(new Event('input'))`); await hold(0.12); }
  await clickEl('#city-list li', 0.6); await hold(0.5);
  await clickEl('#loc-ok', 0.6); await hold(0.4);

  await caption('…and any date and time');
  await clickEl('#dt', 0.6);
  await setTime('2026-11-20T08:00:00'); // midnight in Sydney (computer clock is US Eastern)
  await ev(`document.activeElement.blur()`); await hold(0.6);
  await clickEl('[data-look="180"]', 0.7);
  await caption('The Southern Cross from Sydney at midnight'); await hold(2.4);
  await clickEl('[data-look="up"]', 0.6); await hold(1.4);
  await caption('Accurate to a fraction of an arcsecond · runs offline'); await moveTo(W - 40, H / 2, 0.6); await hold(2.4);

  console.log('frames', frame, 'seconds', (frame / FPS).toFixed(1));
  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
