import { hash } from './util.js';

export const PAL = { out: '#14532d', g9: '#166534', g7: '#15803d', g6: '#16a34a', g5: '#22c55e', g4: '#4ade80', g3: '#86efac', g2: '#bbf7d0', g1: '#dcfce7', g0: '#f0fdf4', w: '#ffffff', s2: '#d2f3dd', s3: '#a6e6bb', r5: '#ef4444', r9: '#7f1d1d' };
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map(r => r.map(v => v / 16));
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

export function pxPerArt() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--p')) || 3; }

// crisp pixel text: draw with a pixel font at native size, then snap alpha to 0/1
const textCache = new Map();
export function pxText(text, font = '8px SK', color = PAL.out) {
  const key = text + '|' + font + '|' + color; if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas'); let g = c.getContext('2d', { willReadFrequently: true });
  g.font = font; const w = Math.ceil(g.measureText(text).width) + 4, h = 16;
  c.width = w; c.height = h; g = c.getContext('2d', { willReadFrequently: true }); g.font = font; g.textBaseline = 'top'; g.fillStyle = '#000'; g.fillText(text, 2, 2);
  const d = g.getImageData(0, 0, w, h), o = g.createImageData(w, h), [r, gg, b] = rgb(color);
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (d.data[i + 3] > 120) { o.data[i] = r; o.data[i + 1] = gg; o.data[i + 2] = b; o.data[i + 3] = 255; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  g.putImageData(o, 0, 0);
  const out = document.createElement('canvas');
  if (x1 < x0) { out.width = 1; out.height = 1; } else { out.width = x1 - x0 + 1; out.height = y1 - y0 + 1; out.getContext('2d').drawImage(c, -x0, -y0); }
  textCache.set(key, out); return out;
}

// placeholder tile: palette colour from the mint + first letter
export function placeholder(cv, coin) {
  const g = cv.getContext('2d'); const W = cv.width, H = cv.height; const h = hash(coin.m || coin.s || 'x');
  const bg = [PAL.g2, PAL.g3, PAL.g4, PAL.s2, PAL.g1][h % 5];
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(0, 0, W, 1); g.fillRect(0, 0, 1, H);
  const ch = (coin.s || coin.n || '?').replace(/^\$/, '').slice(0, 1).toUpperCase() || '?';
  const t = pxText(ch, '8px SK', PAL.out);
  g.drawImage(t, Math.floor((W - t.width) / 2), Math.floor((H - t.height) / 2));
}

const imgCache = new Map();
function loadImage(src, cors) {
  const key = src + (cors ? '|c' : '');
  if (imgCache.has(key)) return imgCache.get(key);
  const p = new Promise((ok, no) => {
    const im = new Image(); if (cors) im.crossOrigin = 'anonymous'; im.decoding = 'async';
    const t = setTimeout(() => no(new Error('timeout')), 15000);
    im.onload = () => { clearTimeout(t); ok(im); }; im.onerror = () => { clearTimeout(t); no(new Error('img')); }; im.src = src;
  });
  if (imgCache.size > 900) imgCache.delete(imgCache.keys().next().value);
  imgCache.set(key, p); p.catch(() => imgCache.delete(key)); return p;
}
export const proxied = u => /^data:image\/|^\/assets\//.test(u) ? u : '/api/img?u=' + encodeURIComponent(u);

const Q = []; let active = 0;
function pump() {
  while (active < 8 && Q.length) {
    const job = Q.shift(); active++;
    run(job).finally(() => { active--; pump(); });
  }
}
// always through our own proxy (keeps canvases readable for SAVE CARD and doesn't send visitors to random hosts)
async function run({ cv, urls, post }) {
  for (const u of urls) {
    try { const im = await loadImage(proxied(u), false); draw(cv, im, post); return; } catch (e) { }
  }
}
function draw(cv, im, post) {
  const g = cv.getContext('2d', { willReadFrequently: true }); const W = cv.width, H = cv.height;
  const s = Math.min(im.naturalWidth, im.naturalHeight); if (!s) return;
  const sx = (im.naturalWidth - s) / 2, sy = (im.naturalHeight - s) / 2;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(im, sx, sy, s, s, 0, 0, W, H);
  if (!post) return;
  try {
    const d = g.getImageData(0, 0, W, H), a = d.data;
    for (let i = 0; i < a.length; i += 4) { for (let k = 0; k < 3; k++) a[i + k] = Math.min(255, Math.round(a[i + k] / 36) * 36 + (a[i + k] > 230 ? 30 : 0)); a[i + 3] = 255; }
    g.putImageData(d, 0, 0);
  } catch (e) { /* tainted: keep the smooth version */ }
}
// draw the coin's logo as pixel art into a small canvas (lazy queue)
// pump.fun's own 86px thumbnail first (small and fast), then the coin's image, then Dexscreener's copy
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function pixelate(cv, coin, post = true, first = false) {
  placeholder(cv, coin);
  const thumb = coin.m && B58.test(coin.m) && !coin.own ? `https://images.pump.fun/coin-image/${coin.m}?variant=86x86` : '';
  const urls = [thumb, coin.i, coin.i2].filter(u => typeof u === 'string' && (/^https:\/\//.test(u) || /^\/assets\//.test(u)));
  if (urls.length) { (first ? Q.unshift : Q.push).call(Q, { cv, urls, post }); pump(); }
}
export function pixelateFile(cv, dataUrl) {
  loadImage(dataUrl, false).then(im => draw(cv, im, true)).catch(() => { });
}

// dithered sky behind everything
export function drawSky(cv) {
  const p = pxPerArt(); const w = Math.ceil(innerWidth / p), h = Math.ceil(innerHeight / p);
  cv.width = w; cv.height = h; const g = cv.getContext('2d'); const img = g.createImageData(w, h);
  const stops = [PAL.w, PAL.g0, PAL.g1, PAL.g2, PAL.g3].map(rgb); const n = stops.length - 1;
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1) * n, i = Math.min(Math.floor(t), n - 1), f = t - i;
    for (let x = 0; x < w; x++) {
      const c = BAYER[y & 3][x & 3] < f ? stops[i + 1] : stops[i]; const o = (y * w + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
export function makeClouds(box) {
  box.innerHTML = '';
  const p = pxPerArt(); const N = innerWidth < 760 ? 4 : 7;
  const sizes = { 1: [47, 21], 2: [36, 17], 3: [57, 25] };
  for (let i = 0; i < N; i++) {
    const k = 1 + (i % 3), im = document.createElement('img');
    im.src = `/assets/cloud${k}.png`; im.alt = '';
    im.width = sizes[k][0] * p; im.height = sizes[k][1] * p;
    const dur = 70 + (i * 37) % 80;
    im.style.top = (6 + (i * 23) % 72) + 'vh'; im.style.animationDuration = dur + 's'; im.style.animationDelay = (-(i * 0.37 % 1) * dur) + 's';
    box.appendChild(im);
  }
}
