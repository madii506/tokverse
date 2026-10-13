import { pxText, PAL } from './pix.js';

// animated title island: elevator pill rides the rails, beacon blinks, live tickers float over the town
export function startIsland(cv, meta) {
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  const base = new Image(); base.src = '/assets/island.png';
  let coins = [], running = true, last = -1, plates = [];
  const start = performance.now();

  function plateFor(c) {
    const sym = '$' + String(c.s || '').toUpperCase().slice(0, 8);
    const t = pxText(sym, '8px SK', PAL.out);
    const w = t.width + 8 + 10, h = t.height + 8;
    const pc = document.createElement('canvas'); pc.width = w + 2; pc.height = h + 2;
    const q = pc.getContext('2d');
    q.fillStyle = PAL.out; q.fillRect(1, 0, w, h + 2); q.fillRect(0, 1, w + 2, h);
    q.fillStyle = PAL.w; q.fillRect(1, 1, w, h);
    q.fillStyle = PAL.g4; q.fillRect(1, 1, w, 1); q.fillRect(1, 1, 1, h); q.fillRect(w, 1, 1, h);
    q.fillStyle = PAL.g5; q.fillRect(1, h, w, 1);
    q.drawImage(t, 5, 5);
    const h1 = c.ch && c.ch.h1; const seq = h1 == null ? 'udu' : h1 >= 0 ? 'duu' : 'udd';
    let lv = 0; const xs = 5 + t.width + 3;
    seq.split('').forEach((k, i) => {
      const up = k === 'u'; lv += up ? 1 : -1;
      q.fillStyle = up ? PAL.g5 : PAL.r5;
      const yb = h - 3 - (lv + 1);
      q.fillRect(xs + i * 3, yb - 2, 2, 3); q.fillRect(xs + i * 3, yb - 3, 1, 1);
    });
    return pc;
  }
  function setCoins(list) {
    coins = list.slice(0, meta.slots.length);
    plates = coins.map(plateFor);
    last = -1;
  }
  function pill(x, y) {
    // 7x15 capsule with outline, white top / green bottom
    const rows = [[2, 4], [1, 5], [0, 6], [0, 6], [0, 6], [0, 6], [0, 6], [0, 6], [0, 6], [0, 6], [0, 6], [0, 6], [0, 6], [1, 5], [2, 4]];
    g.fillStyle = PAL.out;
    rows.forEach(([a, b], i) => g.fillRect(x - 3 + a - 1, y - 7 + i, b - a + 3, 1));
    g.fillRect(x - 3 + 2, y - 8, 3, 1); g.fillRect(x - 3 + 2, y + 8, 3, 1);
    rows.forEach(([a, b], i) => { g.fillStyle = i < 7 ? PAL.w : PAL.g4; g.fillRect(x - 3 + a, y - 7 + i, b - a + 1, 1); });
    g.fillStyle = PAL.g1; g.fillRect(x - 2, y - 5, 1, 3);
  }
  function frame(now) {
    if (!running) return;
    const fi = Math.floor((now - start) / 90);
    if (fi !== last && base.complete && base.naturalWidth) {
      last = fi;
      g.clearRect(0, 0, cv.width, cv.height); g.drawImage(base, 0, 0);
      const R = meta.rails; const cx = Math.round((R.xl + R.xh) / 2);
      const t = ((now - start) / 9000) % 1; const k = t < .5 ? t * 2 : 2 - t * 2; const e = k * k * (3 - 2 * k);
      const y = Math.round(R.bot - 10 - e * (R.bot - R.top - 16));
      // dithered trail under the pill while it rises
      if (t < .5) { g.fillStyle = PAL.g3; for (let dy = 9; dy < 22; dy++) for (let dx = -2; dx <= 2; dx++) if (((dx + dy) & 1) === 0 && Math.random() > dy / 24) g.fillRect(cx + dx, y + dy, 1, 1); }
      pill(cx, y);
      if (Math.floor((now - start) / 700) % 2) { const [bx, by] = meta.beacon; g.fillStyle = PAL.w; g.fillRect(Math.round(bx) - 3, Math.round(by), 7, 1); g.fillRect(Math.round(bx), Math.round(by) - 3, 1, 7); }
      meta.slots.forEach((s, i) => {
        const pc = plates[i]; if (!pc) return;
        const left = Math.max(1, Math.min(cv.width - pc.width - 1, Math.round(s.cx - pc.width / 2)));
        const bob = Math.floor((now - start) / 900 + i) % 2;
        const top = s.top - bob;
        const lx = Math.max(left + 5, Math.min(left + pc.width - 6, s.lx));
        g.fillStyle = PAL.g6;
        const x0 = lx, y0 = top + pc.height, x1 = s.ax, y1 = s.ay - 1;
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let j = 0; j <= n; j++) g.fillRect(Math.round(x0 + (x1 - x0) * j / n), Math.round(y0 + (y1 - y0) * j / n), 1, 1);
        g.fillStyle = PAL.g5; g.fillRect(s.ax - 1, s.ay - 1, 3, 2);
        g.drawImage(pc, left, top);
      });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { setCoins, stop() { running = false; }, start() { if (!running) { running = true; requestAnimationFrame(frame); } } };
}
