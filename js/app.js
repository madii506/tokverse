import { $, $$, esc, money, pct, ago, short, hash, sleep, toast, copyText, store, safeUrl, xUrl, tgUrl } from './util.js';
import { FLOORS, floorOf, range, rank, label, floor1h, loadTower, place } from './data.js';
import { pixelate, pixelateFile, drawSky, makeClouds, pxPerArt, pxText, PAL } from './pix.js';
import { startIsland } from './title.js';
import { WAL, onWallet, connect, disconnect, launch, STEPS, walletList } from './wallet.js';

// set these at launch: the coin's contract address and the X account
const CFG = { ca: '', x: '', site: 'https://tokverse.vercel.app' };

const S = { coins: [], by: new Map(), place: null, prevWhere: null, t: 0, src: '', inGame: false, built: false, curFloor: 'L', riding: false, log: [], sfx: store.get('tok-sfx', false), loadErr: false };
const FEL = new Map();   // floor -> element
const TEN = new Map();   // mint -> tenant element
let island = null, islandMeta = null;

/* ------------------------------------------------------------------ boot */
const sky = $('#sky');
function paintSky() { drawSky(sky); makeClouds($('#clouds')); }
paintSky();
let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { paintSky(); fitTitle(); if (S.built) { renderAll(); parkCar(true); } }, 160); });

function fitTitle() {
  const vw = innerWidth, vh = innerHeight, narrow = vw <= 900;
  const ex = Math.min((narrow ? vw - 32 : vw * .52) / 272, (narrow ? vh * .42 : vh * .78) / 167);
  const isl = Math.max(1, Math.min(6, ex < 3 ? Math.floor(ex * 2) / 2 : Math.floor(ex)));
  const ts = Math.max(1, Math.min(4, Math.floor(Math.min((narrow ? vw - 40 : vw * .4) / 188, 4))));
  document.documentElement.style.setProperty('--is', isl);
  document.documentElement.style.setProperty('--ts', ts);
  document.documentElement.style.setProperty('--hs', innerWidth <= 760 ? 1.5 : 2);
}
fitTitle();

(async () => {
  try { await Promise.all(['8px SK', '16px PS', '20px J'].map(f => document.fonts.load(f))); } catch (e) { }
  try { islandMeta = await (await fetch('/assets/island.json')).json(); island = startIsland($('#island'), islandMeta); } catch (e) { }
  if (CFG.ca) { const c = $('#caT'); c.hidden = false; $('span', c).textContent = CFG.ca; }
  for (const id of ['#xLink', '#xFoot']) { const a = $(id); if (CFG.x) { a.href = CFG.x; a.hidden = false; } }
  paintSnd();
  await refresh(true);
  const q = new URLSearchParams(location.search);
  if (q.get('c') || q.get('f')) enterGame(false);
  setInterval(() => { if (!document.hidden) refresh(false); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - S.t > 35000) refresh(false); });
})();

/* ------------------------------------------------------------------ data */
let loading = false;
async function refresh(first) {
  if (loading) return; loading = true;
  try { await refreshInner(first); } finally { loading = false; }
}
async function refreshInner(first) {
  let j;
  try { j = await loadTower(); S.loadErr = false; } catch (e) {
    S.loadErr = true; setStat(); renderLog(); if (S.built && !S.coins.length) renderAll();
    if (first) setTimeout(() => refresh(true), 15000); return;
  }
  if (j.t && S.t && j.t < S.t) return; // an older snapshot arrived late
  const now = Date.now();
  const coins = j.coins.filter(c => c && c.m && c.mc > 0);
  if (CFG.ca && !coins.some(c => c.m === CFG.ca)) { const own = await fetchOwn(); if (own) coins.push(own); }
  const prevWhere = S.place && S.coins.length ? S.place.where : null;
  const oldRects = new Map();
  S.coins = coins; S.by = new Map(coins.map(c => [c.m, c])); S.t = j.t || now; S.src = j.src || '';
  for (const [m, el] of TEN) if (!S.by.has(m) && !el.isConnected) { io && io.unobserve(el); TEN.delete(m); }
  const P = place(coins, now);
  let moves = [];
  if (prevWhere) {
    let fresh = 0;
    for (const c of coins) {
      const a = prevWhere[c.m], b = P.where[c.m];
      if (a && b && a !== b) moves.push({ c, from: a, to: b });
      if (!a && b === 'L' && c.t0 && now - c.t0 < 15 * 60000 && fresh++ < 4) addLog({ k: 'nw', m: c.m, txt: `<b>$${esc(c.s)}</b> checked in at the lobby`, sub: `${ago(c.t0)} old · ${money(c.mc)}` });
    }
    moves = moves.filter(mv => Math.max(rank(mv.from), rank(mv.to)) > 2 && mv.from !== 'L' && mv.to !== 'L')
      .sort((a, b) => Math.abs(rank(b.to) - rank(b.from)) - Math.abs(rank(a.to) - rank(a.from))).slice(0, 10);
    for (const mv of moves) {
      const el = TEN.get(mv.c.m);
      if (S.inGame) {
        const pic = el && el.isConnected ? $('.pic', el) : null;
        if (pic) oldRects.set(mv.c.m, rel(pic));
        else if (FEL.has(mv.from)) { const t = $('.tns', FEL.get(mv.from)); const last = t.lastElementChild; const r = rel(last || t); const p = pxPerArt(); oldRects.set(mv.c.m, { x: r.x + (last ? 0 : 8), y: rel(t).y + rel(t).h - 34 * p * .62, w: 14 * p, h: 14 * p }); }
      }
      logMove(mv.c, mv.from, mv.to, 'live');
    }
  } else {
    seedLog(coins, P, now);
  }
  S.place = P; S.justMoved = new Set(moves.map(mv => mv.c.m));
  if (island) island.setCoins(coins.filter(c => P.where[c.m] !== 'B' && P.where[c.m] !== 'L').slice(0, 6));
  setStat();
  if (S.built) {
    renderAll();
    if (moves.length) queueMoves(moves, oldRects);
  }
  renderLog(); renderKeys(); renderMine(); renderSenti(); renderTape(); renderBoard();
}
// live movers tape under the HUD: the biggest 1h moves, two up for every one down
function renderTape() {
  const box = $('#tape'); if (!box || !S.place) return;
  const L = S.coins.filter(c => c.ch && c.ch.h1 != null && isFinite(c.ch.h1) && c.mc >= 15000 && S.place.where[c.m] !== 'L');
  const ups = L.filter(c => c.ch.h1 >= 1).sort((a, b) => b.ch.h1 - a.ch.h1).slice(0, 12);
  const dns = L.filter(c => c.ch.h1 <= -1).sort((a, b) => a.ch.h1 - b.ch.h1).slice(0, 6);
  const mix = [];
  while (ups.length || dns.length) { if (ups.length) mix.push(ups.shift()); if (ups.length) mix.push(ups.shift()); if (dns.length) mix.push(dns.shift()); }
  if (!mix.length) { box.hidden = true; return; }
  const item = (c, dup) => { const h = c.ch.h1, up = h > 0; return `<button type="button" data-coin="${esc(c.m)}"${dup ? ' tabindex="-1" aria-hidden="true"' : ''}>$${esc((c.s || '').toUpperCase().slice(0, 12))} <span class="${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${pct(h)}</span> <i>${esc(label(S.place.where[c.m]))}</i></button><span class="sep"></span>`; };
  const inner = $('.tape-in', box);
  inner.innerHTML = mix.map(c => item(c, false)).join('') + mix.map(c => item(c, true)).join('');
  box.hidden = false;
  requestAnimationFrame(() => { const w = inner.scrollWidth / 2; if (w > 0) inner.style.setProperty('--tdur', Math.max(20, Math.round(w / 55)) + 's'); });
}
// title screen live board: top floor, best hour, newest check-in
function renderBoard() {
  const b = $('#tBoard'); if (!b || !S.place) return;
  const w = c => S.place.where[c.m];
  const top = S.coins.filter(c => w(c) !== 'B' && w(c) !== 'L').sort((a, b2) => b2.mc - a.mc)[0];
  const mover = bestBy(1);
  const fresh = (S.place.map.L || []).filter(c => c.t0).sort((a, b2) => b2.t0 - a.t0)[0];
  const row = (k, c, right) => `<button type="button" data-coin="${esc(c.m)}"><small>${k}</small><b>$${esc((c.s || '').toUpperCase())} <span class="mute">· ${esc(label(w(c)))}</span></b>${right}</button>`;
  let h = '';
  if (top) h += row('TOP FLOOR', top, `<span>${money(top.mc)}</span>`);
  if (mover && mover.ch.h1 > 0) h += row('BEST HOUR', mover, `<span class="up">${pct(mover.ch.h1)}</span>`);
  if (fresh) h += row('NEW IN LOBBY', fresh, `<span>${ago(fresh.t0)} old</span>`);
  b.innerHTML = h; b.hidden = !h;
}
// our own coin, straight from Dexscreener (only used when CFG.ca is set)
let OWN = { t: 0, c: null };
async function fetchOwn() {
  if (Date.now() - OWN.t < 25000) return OWN.c;
  OWN.t = Date.now();
  try {
    const arr = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/' + encodeURIComponent(CFG.ca))).json();
    const p = (Array.isArray(arr) ? arr : []).sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
    if (!p) return OWN.c;
    const pc = p.priceChange || {};
    OWN.c = { m: CFG.ca, n: p.baseToken.name, s: (p.baseToken.symbol || '').trim(), i: (p.info && p.info.imageUrl) || '/assets/pfp-512.png', mc: Math.round(+p.marketCap || +p.fdv || 0), t0: p.pairCreatedAt || 0,
      done: p.dexId === 'pumpfun' ? 0 : 1, ch: { m5: pc.m5, h1: pc.h1, h6: pc.h6, h24: pc.h24 }, v24: Math.round((p.volume && p.volume.h24) || 0), v1: Math.round((p.volume && p.volume.h1) || 0),
      b1: (p.txns && p.txns.h1 && p.txns.h1.buys) | 0, s1: (p.txns && p.txns.h1 && p.txns.h1.sells) | 0, liq: Math.round((p.liquidity && p.liquidity.usd) || 0), dex: p.dexId, pair: p.pairAddress };
  } catch (e) { }
  return OWN.c;
}
function senti() {
  let up = 0, dn = 0;
  for (const c of S.coins) { const h = c.ch && c.ch.h1; if (h == null) continue; if (h > .5) up++; else if (h < -.5) dn++; }
  return { up, dn, p: up + dn ? Math.round(up / (up + dn) * 100) : 50 };
}
function renderSenti() {
  const z = senti(); if (!(z.up + z.dn)) return;
  for (const id of ['#sbox', '#tSenti']) {
    const b = $(id); b.hidden = false; $('.senti span', b).style.width = z.p + '%';
    $('small', b).innerHTML = `<span class="up">ELEVATOR ${z.p}%</span> · <span class="dn">STAIRS ${100 - z.p}%</span> · last hour`;
  }
  if (CFG.ca && S.by.has(CFG.ca)) {
    const c = S.by.get(CFG.ca), f = S.place.where[c.m];
    let hb = $('#hqbar'); if (!hb) { hb = document.createElement('div'); hb.id = 'hqbar'; hb.className = 'hqbar'; $('.t-left').appendChild(hb); }
    hb.innerHTML = `<b>HQ</b> $${esc((c.s || '').toUpperCase())} lives on ${esc(label(f))} · ${money(c.mc)} · <span class="${chCls(c.ch && c.ch.h1)}">${pct(c.ch && c.ch.h1)} 1h</span> <button class="btn sm" type="button" data-coin="${esc(c.m)}">OPEN</button>`;
  }
}
function setStat() {
  const n = S.coins.length, fl = S.place ? FLOORS.filter(f => (S.place.map[f] || []).length).length : 0;
  const live = !S.loadErr && n > 0;
  const txt = S.loadErr ? (n ? `live data paused, retrying · ${n} coins` : `can't reach live data right now, retrying…`) : `${n} live coins on ${fl} floors · updated ${ago(S.t)} ago`;
  $('#tStat').textContent = txt;
  for (const d of ['#tDot', '#hDot']) $(d).classList.toggle('off', !live);
  $('#hStat').textContent = S.loadErr ? 'retrying…' : `${n} coins · ${fl} floors`;
}
setInterval(() => { if (S.coins.length) setStat(); }, 5000);

/* ------------------------------------------------------------------ title -> game */
function enterGame(intro = true) {
  if (S.inGame) return;
  S.inGame = true;
  $('#title').classList.add('gone');
  clearTimeout(S.titleT); S.titleT = setTimeout(() => { $('#title').hidden = true; island && island.stop(); }, 460);
  for (const id of ['#hud', '#game', '#logp', '#panel', '#fabL', '#fabE']) $(id).hidden = false;
  buildTower();
  const q = new URLSearchParams(location.search);
  const dc = q.get('c'), df = q.get('f');
  requestAnimationFrame(() => {
    const lobby = FEL.get('L'); window.scrollTo(0, Math.max(0, lobby.offsetTop + $('#tower').offsetTop - innerHeight * .45));
    parkCar(true, 'L');
    if (dc && S.by.has(dc)) { const c = S.by.get(dc); setTimeout(() => ride(S.place.where[c.m], { open: c.m }), 350); }
    else if (df && FEL.has(df.toUpperCase())) setTimeout(() => ride(df.toUpperCase()), 350);
    else if (intro) { const hot = hotFloor(); setTimeout(() => ride(hot, { slow: true }), 500); }
  });
}
function backToTitle() {
  S.inGame = false; clearTimeout(S.titleT);
  const t = $('#title'); t.hidden = false; requestAnimationFrame(() => t.classList.remove('gone'));
  for (const id of ['#hud', '#game', '#logp', '#panel', '#fabL', '#fabE']) $(id).hidden = true;
  island && island.start(); window.scrollTo(0, 0);
}
$('#enter').addEventListener('click', () => enterGame(true));
$('#toTitle').addEventListener('click', backToTitle);

/* ------------------------------------------------------------------ tower */
function buildTower() {
  if (S.built) { renderAll(); return; }
  const box = $('#floors'); box.innerHTML = '';
  FLOORS.forEach((f, i) => box.appendChild(floorEl(f, i)));
  $('#basement').appendChild(floorEl('B', 0));
  // lobby furniture
  const lr = $('.room', FEL.get('L'));
  lr.insertAdjacentHTML('beforeend', '<div class="desk"><span>CHECK-IN</span></div><div class="entrance"></div>');
  // street
  const st = $('#street'); const p = pxPerArt(); let html = '';
  for (let x = 40; x < innerWidth + 200; x += 210) html += `<div class="tree" style="left:${x}px"></div>`;
  const cars = [['car_w', 0, 34, ''], ['car_g', 0, 52, 'l'], ['car_r', 0, 41, ''], ['car_w', 0, 63, 'l']];
  cars.forEach(([img, , dur, dir], i) => { html += `<div class="car ${dir}" style="background-image:url(/assets/${img}.png);top:${(dir ? 9 : 5) * p}px;animation-duration:${dur}s;animation-delay:${-i * 9}s"></div>`; });
  st.innerHTML = html;
  S.built = true;
  renderAll();
  observeFloors();
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
function floorEl(f, i) {
  const el = document.createElement('section');
  el.className = 'floor' + (f === 'PH' ? ' ph' : f === 'L' ? ' lobby' : f === 'B' ? ' base' : (i % 2 ? ' alt' : ''));
  el.id = 'f-' + f; el.dataset.f = f;
  el.innerHTML = `<div class="stair"></div><div class="room"><div class="fl"></div><div class="tns"></div></div><div class="shaft"></div>`;
  FEL.set(f, el); return el;
}
function flLabel(f, n) {
  if (f === 'PH') return `<b>PH</b><small>$100M+</small><i>${n} coin${n === 1 ? '' : 's'}</i>`;
  if (f === 'L') return `<b>L</b><small>LOBBY</small><i>${n} new</i>`;
  if (f === 'B') return `<b>B</b><small>LAID OFF</small><i>${n} coin${n === 1 ? '' : 's'}</i>`;
  const [lo] = range(f); return `<b>${f}F</b><small>${money(lo)}+</small><i>${n} coin${n === 1 ? '' : 's'}</i>`;
}
function capacity(el) {
  const p = pxPerArt(); const room = $('.room', el); const tns = $('.tns', el);
  const cs = getComputedStyle(tns);
  const w = (tns.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)) || (room.clientWidth - 30 * p);
  const tw = (innerWidth <= 760 ? 34 : 28) * p + 2 * p;
  return Math.max(1, Math.floor((w + 2 * p) / tw));
}
function renderAll() {
  if (!S.place) S.place = place([]);
  for (const [f, el] of FEL) renderFloor(f, el);
}
function renderFloor(f, el) {
  const list = (S.place && S.place.map[f]) || [];
  $('.fl', el).innerHTML = flLabel(f, list.length);
  const tns = $('.tns', el); const cap = capacity(el);
  const kids = [];
  if (!list.length) {
    const r = range(f);
    const msg = !S.coins.length ? 'WAITING FOR<br>LIVE DATA' : f === 'B' ? 'NOBODY LAID OFF<br>RIGHT NOW' : f === 'L' ? 'NO NEW LAUNCHES<br>IN THE LAST 10 MIN' : `FOR LEASE<br>${r ? money(r[0]) + '–' + (isFinite(r[1]) ? money(r[1]) : '') : ''}`;
    const d = document.createElement('div'); d.className = 'lease'; d.innerHTML = msg; kids.push(d);
  } else {
    let L2 = list;
    if (S.justMoved && S.justMoved.size && list.length > cap) { const a = list.filter(c => S.justMoved.has(c.m)), b = list.filter(c => !S.justMoved.has(c.m)); L2 = a.concat(b); }
    const show = L2.length > cap ? L2.slice(0, cap - 1) : L2;
    for (const c of show) kids.push(tenantEl(c, f));
    if (list.length > cap) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn w sm more'; b.dataset.floorList = f; b.textContent = '+' + (list.length - show.length); kids.push(b);
    }
  }
  tns.replaceChildren(...kids);
}
function tenantEl(c, f) {
  let el = TEN.get(c.m);
  if (!el) {
    el = document.createElement('button'); el.type = 'button'; el.className = 'tn'; el.dataset.m = c.m;
    el.innerHTML = '<span class="pic"><canvas width="14" height="14"></canvas></span><span class="tk"></span><span class="mc"></span>';
    el.style.setProperty('--dl', (-(hash(c.m) % 26) / 10) + 's');
    TEN.set(c.m, el); io && io.observe(el);
  }
  const sym = (c.s || '?').toUpperCase();
  const small = innerWidth <= 760, lim = small ? 6 : 9;
  $('.tk', el).textContent = '$' + (sym.length > lim ? sym.slice(0, lim - 1) + '…' : sym);
  $('.mc', el).textContent = money(c.mc);
  el.title = `${c.n || sym} · ${money(c.mc)}${c.ch && c.ch.h1 != null ? ' · ' + pct(c.ch.h1) + ' 1h' : ''}`;
  el.setAttribute('aria-label', `$${sym}, ${money(c.mc)}. Open card.`);
  const pic = $('.pic', el);
  let ch = $('.ch', pic); const h1 = c.ch && c.ch.h1;
  if (h1 != null) {
    if (!ch) { ch = document.createElement('span'); pic.appendChild(ch); }
    ch.className = 'ch ' + (h1 > .05 ? 'up' : h1 < -.05 ? 'dn' : 'flat');
    const a = Math.abs(h1);
    ch.textContent = (h1 > .05 ? '▲' : h1 < -.05 ? '▼' : '') + (a >= 1000 ? Math.round(a / 100) / 10 + 'K' : (a >= 10 || small) ? Math.round(a) : a.toFixed(1)) + (small ? '' : '%');
  } else if (ch) ch.remove();
  pic.querySelectorAll('.crown,.box,.key').forEach(x => x.remove());
  if (f === 'PH') pic.insertAdjacentHTML('beforeend', '<i class="crown"></i>');
  if (f === 'B') pic.insertAdjacentHTML('beforeend', '<i class="box"></i>');
  pic.querySelectorAll('.mark').forEach(x => x.remove());
  const mine = WAL.held && WAL.held.has(c.m), w = WATCH.has(c.m);
  el.classList.toggle('me', !!mine); el.classList.toggle('watch', w && !mine);
  if (c.m === CFG.ca) pic.insertAdjacentHTML('beforeend', '<i class="mark hq">HQ</i>');
  else if (mine) pic.insertAdjacentHTML('beforeend', '<i class="key" title="you hold this"></i>');
  else if (w) pic.insertAdjacentHTML('beforeend', '<i class="mark star" title="on your watchlist"></i>');
  return el;
}
let io = null;
function observeFloors() {
  io = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) {
      const el = e.target; if (el.dataset.px) continue; const c = S.by.get(el.dataset.m); if (!c) continue;
      el.dataset.px = '1'; pixelate($('canvas', el), c);
    }
  }, { rootMargin: '400px 0px' });
  for (const el of TEN.values()) io.observe(el);
}

/* ------------------------------------------------------------------ elevator */
const car = $('#car'), cable = $('#cable');
function floorTopIn(f) { const el = FEL.get(f); return el ? el.offsetTop + (el.closest('#basement') ? 0 : 0) : 0; }
function carTopFor(f) { const el = FEL.get(f); const p = pxPerArt(); return el.offsetTop + el.offsetHeight - 26 * p - 3 * p; }
function setCar(top, dur) {
  car.style.setProperty('--dur', dur + 'ms'); cable.style.setProperty('--dur', dur + 'ms');
  car.style.top = top + 'px'; cable.style.top = ($('#roof').offsetTop + $('#roof').offsetHeight) + 'px';
  cable.style.height = Math.max(0, top - ($('#roof').offsetTop + $('#roof').offsetHeight)) + 'px';
}
function parkCar(instant, f) {
  f = f || S.curFloor || 'L'; if (!FEL.has(f)) return;
  setCar(carTopFor(f), instant ? 0 : 900);
}
function easeIO(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
let rideId = 0;
async function ride(f, opt = {}) {
  if (!f || !FEL.has(f)) return;
  const id = ++rideId; S.riding = true;
  const from = S.curFloor; const dist = Math.abs(rank(f) - rank(from || 'L'));
  const dur = Math.min(opt.slow ? 4200 : 3000, 450 + dist * (opt.slow ? 110 : 75));
  const top = carTopFor(f);
  setCar(top, dur);
  sfx('go');
  const el = FEL.get(f); const towerTop = $('#tower').getBoundingClientRect().top + scrollY;
  const y0 = scrollY, y1 = Math.max(0, towerTop + el.offsetTop + el.offsetHeight / 2 - innerHeight * .5);
  const t0 = performance.now();
  await new Promise(done => {
    function step(now) {
      if (id !== rideId) return done();
      const k = Math.min(1, (now - t0) / dur); window.scrollTo(0, y0 + (y1 - y0) * easeIO(k));
      if (k < 1) requestAnimationFrame(step); else done();
    }
    requestAnimationFrame(step);
  });
  if (id !== rideId) return;
  S.riding = false; S.curFloor = f; S.carAt = f; S.lockUntil = performance.now() + 1200; S.rideY = scrollY; showFloor(f, true);
  el.classList.remove('hl'); void el.offsetWidth; el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 3400);
  sfx('ding');
  if (opt.open) setTimeout(() => openCoin(opt.open), 220);
}
let lastY = scrollY, dir = '▲', scrollT = 0;
function onScroll() {
  if (!S.inGame) return;
  dir = scrollY < lastY ? '▲' : scrollY > lastY ? '▼' : dir; lastY = scrollY;
  if (S.riding || performance.now() < (S.lockUntil || 0) || (S.rideY != null && Math.abs(scrollY - S.rideY) < 60)) return;
  S.rideY = null;
  const f = floorAtCenter(); if (f) showFloor(f, false);
  clearTimeout(scrollT);
  scrollT = setTimeout(() => { if (!S.riding && !S.anim && f && f !== S.carAt) { S.curFloor = f; S.carAt = f; setCar(carTopFor(f), 700); } }, 450);
}
function floorAtCenter() {
  const y = innerHeight * .5; let best = null, bd = 1e9;
  for (const [f, el] of FEL) { const r = el.getBoundingClientRect(); const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < bd) { bd = d; best = f; } }
  return best;
}
function showFloor(f, arrived) {
  $('#dFloor').textContent = label(f); $('#dArrow').textContent = arrived ? '' : dir;
  const n = ((S.place && S.place.map[f]) || []).length; const r = range(f);
  $('#dInfo').innerHTML = f === 'B' ? `${n} laid off<br><span class="mute">down 90%+ from ATH</span>` : f === 'L' ? `${n} new launch${n === 1 ? '' : 'es'}<br><span class="mute">lobby · under $5K or &lt;10m old</span>` :
    `${n} coin${n === 1 ? '' : 's'}<br><span class="mute">${money(r[0])}${isFinite(r[1]) ? '–' + money(r[1]) : '+'}</span>`;
  $$('#keys .k').forEach(k => k.classList.toggle('on', k.dataset.f === f));
}
function renderKeys() {
  const box = $('#keys'); if (!S.place) return;
  // each key shows the floor's mood this hour (average 1h move of its coins)
  const mood = f => { const L = (S.place.map[f] || []).filter(c => c.ch && c.ch.h1 != null && isFinite(c.ch.h1)); if (!L.length) return null; return L.reduce((a, c) => a + Math.max(-50, Math.min(50, c.ch.h1)), 0) / L.length; };
  const mk = (f, cls = '') => { const n = (S.place.map[f] || []).length, m = mood(f); const md = m == null ? '' : m > 2 ? ' up' : m < -2 ? ' dn' : '';
    return `<button type="button" class="k ${cls}${n ? ' has' : ''}${md}" data-f="${f}" title="${label(f)} · ${n} coins${m == null ? '' : ' · avg ' + pct(m) + ' 1h'}">${label(f)}</button>`; };
  let h = mk('PH', 'wide');
  for (let n = 40; n >= 1; n--) h += mk(String(n));
  h += mk('L', 'half') + `<span></span>` + mk('B', 'half');
  box.innerHTML = h;
}
$('#keys').addEventListener('click', e => { const k = e.target.closest('.k'); if (k) { ride(k.dataset.f); closeSides(); } });
// the floor with the most green: coins up >5% this hour, weighted by how much
function hotFloor() {
  if (!S.place) return 'L';
  let best = null, bv = 0;
  for (const f of FLOORS) {
    if (f === 'L' || f === 'PH') continue;
    const v = (S.place.map[f] || []).reduce((a, c) => { const h = c.ch && c.ch.h1; return a + (h > 5 ? 1 + Math.min(h, 200) / 50 : 0); }, 0);
    if (v > bv) { bv = v; best = f; }
  }
  return best || '20';
}
function bestBy(sign) {
  let best = null;
  for (const c of S.coins) { const h = c.ch && c.ch.h1; if (h == null || c.mc < 20000) continue; if (!best || (sign > 0 ? h > best.ch.h1 : h < best.ch.h1)) best = c; }
  return best;
}
$('#qUp').addEventListener('click', () => { const c = bestBy(1); if (c) { ride(S.place.where[c.m], { open: c.m }); closeSides(); } else toast('No 1h data yet.'); });
$('#qDn').addEventListener('click', () => { const c = bestBy(-1); if (c) { ride(S.place.where[c.m], { open: c.m }); closeSides(); } else toast('No 1h data yet.'); });
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (!g) return;
  const v = g.dataset.go; if (!S.inGame) enterGame(false);
  setTimeout(() => ride(v === 'hot' ? hotFloor() : v), S.built ? 0 : 400);
  $('#nav').classList.remove('open');
});

/* ------------------------------------------------------------------ moves: elevator up, stairs down */
function logMove(c, from, to, why) {
  const up = rank(to) > rank(from);
  if (to === 'B') return addLog({ k: 'bx', m: c.m, txt: `<b>$${esc(c.s)}</b> got laid off`, sub: `${label(from)} → basement · ${money(c.mc)}` });
  if (from === 'B') return addLog({ k: 'up', m: c.m, txt: `<b>$${esc(c.s)}</b> got rehired`, sub: `basement → ${label(to)} · ${money(c.mc)}` });
  addLog({ k: up ? 'up' : 'dn', m: c.m, txt: `<b>$${esc(c.s)}</b> ${up ? 'took the elevator' : 'took the stairs'}`, sub: `${label(from)} → ${label(to)} · ${why === '1h' ? pct(c.ch.h1) + ' 1h' : money(c.mc)}` });
}
function seedLog(coins, P, now) {
  const mv = [];
  for (const c of coins) {
    const to = P.where[c.m]; if (to === 'B' || to === 'L') continue;
    const from = floor1h(c, now); if (!from || from === to || from === 'L' || Math.max(rank(from), rank(to)) <= 2) continue;
    mv.push({ c, from, to, d: Math.abs(rank(to) - rank(from)) });
  }
  mv.sort((a, b) => a.d - b.d || Math.abs(a.c.ch.h1) - Math.abs(b.c.ch.h1));
  for (const m of mv.slice(-24)) logMove(m.c, m.from, m.to, '1h');
  const fresh = (P.map.L || []).filter(c => c.t0 && now - c.t0 < 10 * 60000).slice(0, 6).reverse();
  for (const c of fresh) addLog({ k: 'nw', m: c.m, txt: `<b>$${esc(c.s)}</b> checked in at the lobby`, sub: `${ago(c.t0)} old · ${money(c.mc)}` });
}
function addLog(e) { e.t = Date.now(); S.log.unshift(e); if (S.log.length > 80) S.log.length = 80; }
function renderLog() {
  const ol = $('#log');
  if (!S.log.length) { ol.innerHTML = `<li class="empty">${S.loadErr ? 'waiting for live data…' : 'quiet hour. nobody changed floors.'}</li>`; return; }
  const ic = { up: ['▲', ''], dn: ['▼', 'dn'], nw: ['L', 'nw'], bx: ['B', 'bx'] };
  ol.innerHTML = S.log.map(e => `<li data-m="${esc(e.m)}"${WATCH.has(e.m) ? ' class="w"' : ''}><i class="${ic[e.k][1]}">${ic[e.k][0]}</i><span>${e.txt}<small>${e.sub}</small></span></li>`).join('');
}
$('#log').addEventListener('click', e => { const li = e.target.closest('li[data-m]'); if (!li) return; const c = S.by.get(li.dataset.m); if (!c) return toast('That coin left the building.'); ride(S.place.where[c.m], { open: c.m }); closeSides(); });

const MQ = []; S.anim = false;
function queueMoves(moves, oldRects) {
  for (const mv of moves) if (oldRects.has(mv.c.m)) MQ.push({ ...mv, old: oldRects.get(mv.c.m) });
  while (MQ.length > 5) MQ.shift();
  if (!S.anim) runMoves();
}
function liveToast(mv) {
  const t = $('#toast'); const up = rank(mv.to) > rank(mv.from);
  t.innerHTML = `${up ? '▲' : '▼'} $${esc((mv.c.s || '').toUpperCase())} ${up ? 'took the elevator' : 'took the stairs'} ${esc(label(mv.from))} → ${esc(label(mv.to))}`;
  t.style.pointerEvents = 'auto'; t.style.cursor = 'pointer'; t.onclick = () => { t.classList.remove('on'); ride(mv.to); };
  t.classList.add('on'); clearTimeout(liveToast.tm); liveToast.tm = setTimeout(() => { t.classList.remove('on'); t.style.pointerEvents = 'none'; }, 5200);
}
async function runMoves() {
  S.anim = true; let shown = 0; const skipped = [];
  while (MQ.length) {
    const mv = MQ.shift(); if (document.hidden || S.riding) continue;
    const el = TEN.get(mv.c.m); if (!el || !el.isConnected) { skipped.push(mv); continue; }
    const pic = $('.pic', el); const nw = rel(pic);
    const vis = r => r.y + towerY() < scrollY + innerHeight + 200 && r.y + towerY() > scrollY - 200;
    if (!vis(mv.old) && !vis(nw)) { skipped.push(mv); continue; }
    shown++; await travel(mv, el, pic, nw);
  }
  S.anim = false;
  if (!shown && skipped.length && S.inGame && modal.hidden) liveToast(skipped.sort((a, b) => Math.abs(rank(b.to) - rank(b.from)) - Math.abs(rank(a.to) - rank(a.from)))[0]);
}
const towerY = () => $('#tower').getBoundingClientRect().top + scrollY;
function rel(el) { const r = el.getBoundingClientRect(), t = $('#tower').getBoundingClientRect(); return { x: r.left - t.left, y: r.top - t.top, w: r.width, h: r.height }; }
async function travel(mv, el, pic, nw) {
  const p = pxPerArt(); const tower = $('#tower'); const up = rank(mv.to) > rank(mv.from);
  const tv = document.createElement('div'); tv.className = 'traveler';
  tv.style.cssText = `left:0;top:0;width:${nw.w}px;height:${nw.h}px;background:#fff;box-shadow:${getComputedStyle(pic).boxShadow}`;
  const cv = document.createElement('canvas'); cv.width = 14; cv.height = 14; cv.style.cssText = 'width:100%;height:100%;display:block';
  try { cv.getContext('2d').drawImage($('canvas', pic), 0, 0); } catch (e) { }
  tv.appendChild(cv); tower.appendChild(tv);
  el.classList.add('ghost');
  const W = tower.clientWidth;
  const st = $('.stair', FEL.get(mv.from) || FEL.get('L'));
  const sx = up ? car.offsetLeft + car.offsetWidth / 2 - nw.w / 2 : st.offsetLeft + st.offsetWidth / 2 - nw.w / 2;
  const o = mv.old, n = nw;
  const pts = [[o.x, o.y], [sx, o.y]];
  const floorsCrossed = Math.max(1, Math.abs(rank(mv.to) - rank(mv.from)));
  if (up) pts.push([sx, n.y]);
  else { const steps = Math.min(floorsCrossed * 2, 16); for (let i = 1; i <= steps; i++) pts.push([sx + (i % 2 ? 6 * p : -2 * p), o.y + (n.y - o.y) * i / steps]); }
  pts.push([n.x, n.y]);
  const walk = 520, vert = up ? Math.min(2600, 500 + floorsCrossed * 110) : Math.min(4200, 700 + floorsCrossed * 300);
  const total = walk * 2 + vert;
  const kf = pts.map((q, i) => {
    let off; if (i === 0) off = 0; else if (i === 1) off = walk / total; else if (i === pts.length - 1) off = 1; else off = (walk + vert * ((i - 1) / (pts.length - 2))) / total;
    return { transform: `translate(${Math.round(q[0])}px,${Math.round(q[1])}px)`, offset: Math.min(1, off) };
  });
  if (up) {
    setTimeout(() => { if (S.riding) return; S.carAt = mv.to; setCar(Math.round(o.y + nw.h - 26 * p + 8 * p), 300); }, 0);
    setTimeout(() => { if (S.riding) return; sfx('go'); setCar(carTopFor(mv.to), vert); }, walk);
  } else {
    let k = 0; const iv = setInterval(() => { if (++k > Math.floor(vert / 260)) return clearInterval(iv); sfx('step'); }, 260);
    setTimeout(() => clearInterval(iv), walk + vert);
  }
  const a = tv.animate(kf, { duration: total, easing: 'linear', fill: 'forwards' });
  await a.finished.catch(() => { });
  tv.remove(); el.classList.remove('ghost');
  if (up) sfx('ding');
}

/* ------------------------------------------------------------------ modals */
const modal = $('#modal');
function openModal(title, html, wide) {
  $('#mTitle').textContent = title; $('#mBody').innerHTML = html; $('#mWin').classList.toggle('wide', !!wide);
  modal.hidden = false; $('#mBody').scrollTop = 0; setTimeout(() => $('#mWin .x').focus(), 0);
}
function closeModal() {
  modal.hidden = true; $('#mBody').innerHTML = '';
  if (new URLSearchParams(location.search).get('c')) history.replaceState(null, '', location.pathname);
}
modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!modal.hidden) closeModal(); closeSides(); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
  const onCtl = document.activeElement && document.activeElement !== document.body && /BUTTON|A/.test(document.activeElement.tagName);
  if (!S.inGame && e.key === 'Enter' && !typing && !onCtl && modal.hidden) { e.preventDefault(); enterGame(true); return; }
  if (!S.inGame || typing || !modal.hidden) return;
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault(); const order = [...FLOORS, 'B']; const i = order.indexOf(S.curFloor);
    const j = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1))); ride(order[j]);
  }
});

function stat(k, v, cls = '') { return `<div class="st"><small>${k}</small><b class="${cls}">${v}</b></div>`; }
function chCls(v) { return v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : ''; }
function openCoin(m) {
  const c = S.by.get(m); if (!c) return toast('That coin left the building.');
  const f = S.place.where[m]; const r = range(f); const ch = c.ch || {};
  const f1 = floor1h(c);
  const lks = [];
  lks.push(`<a class="btn" href="https://pump.fun/coin/${encodeURIComponent(m)}" target="_blank" rel="noopener">PUMP.FUN</a>`);
  lks.push(`<a class="btn w" href="https://dexscreener.com/solana/${encodeURIComponent(m)}" target="_blank" rel="noopener">CHART</a>`);
  const xu = xUrl(c.x), tu = tgUrl(c.tg), wu = safeUrl(c.w);
  if (xu) lks.push(`<a class="btn w" href="${esc(xu)}" target="_blank" rel="noopener nofollow">X</a>`);
  if (tu) lks.push(`<a class="btn w" href="${esc(tu)}" target="_blank" rel="noopener nofollow">TG</a>`);
  if (wu) lks.push(`<a class="btn w" href="${esc(wu)}" target="_blank" rel="noopener nofollow">WEB</a>`);
  lks.push(`<button class="btn w" type="button" data-chart="${esc(m)}">LIVE CHART</button>`);
  lks.push(`<button class="btn w" type="button" data-watch="${esc(m)}">${WATCH.has(m) ? '★ WATCHING' : '☆ WATCH'}</button>`);
  lks.push(`<button class="btn w" type="button" data-share="${esc(m)}">SHARE ON X</button>`);
  lks.push(`<button class="btn w" type="button" data-card="${esc(m)}">SAVE CARD</button>`);
  if (S.inGame) lks.push(`<button class="btn dk" type="button" data-ride="${esc(f)}">RIDE TO ${esc(label(f))}</button>`);
  const where = f === 'PH' ? 'the penthouse' : f === 'L' ? 'the lobby' : f === 'B' ? 'the basement (laid off)' : `floor ${f}`;
  const html = `<div class="card"><span class="bigpic"><canvas width="32" height="32"></canvas></span><div>
    <h2 class="c-name">${esc(c.n || c.s)}${c.ver ? '<span class="vchip" title="pump.fun shows this coin as verified">✓ VERIFIED</span>' : ''}</h2>
    <p class="c-sub">$${esc((c.s || '').toUpperCase())} · lives on ${where}${r && f !== 'L' ? ` (${money(r[0])}${isFinite(r[1]) ? '–' + money(r[1]) : '+'})` : ''} · ${c.done ? 'graduated' : 'on the bonding curve'}${c.t0 ? ' · ' + ago(c.t0) + ' old' : ''}</p>
    <div class="ca"><span>${esc(m)}</span><button class="btn sm" type="button" data-copy="${esc(m)}">COPY CA</button></div></div></div>
    <div class="stats">${stat('MARKET CAP', money(c.mc))}${stat('5M', pct(ch.m5), chCls(ch.m5))}${stat('1H', pct(ch.h1), chCls(ch.h1))}${stat('24H', pct(ch.h24), chCls(ch.h24))}
    ${stat('VOL 24H', c.v24 ? money(c.v24) : '—')}${stat('BUYS/SELLS 1H', c.b1 || c.s1 ? `${c.b1 || 0} / ${c.s1 || 0}` : '—')}${stat('LIQUIDITY', c.liq ? money(c.liq) : '—')}
    ${stat('ALL-TIME HIGH', c.ath ? money(c.ath) : '—')}${stat('FROM ATH', c.ath ? pct((c.mc / c.ath - 1) * 100) : '—', c.ath ? 'dn' : '')}${stat('6H', pct(ch.h6), chCls(ch.h6))}
    ${stat('FLOOR 1H AGO', f1 ? label(f1) : '—')}${stat('REPLIES', c.rp != null && c.rp ? String(c.rp) : '—')}</div>
    <div class="links">${lks.join('')}</div><div id="cbox"></div>
    <p class="note">Live from pump.fun and Dexscreener. Memecoins are extremely risky; nothing here is advice.</p>`;
  openModal(`$${(c.s || '').toUpperCase()} · ${label(f)}`, html);
  pixelate($('#mBody canvas'), c, true, true);
  if (S.inGame) history.replaceState(null, '', '?c=' + encodeURIComponent(m));
}
function openFloorList(f) {
  const list = (S.place.map[f] || []); const r = range(f);
  const rows = list.map(c => `<button class="frow" type="button" data-m="${esc(c.m)}"><canvas width="10" height="10"></canvas><span><b>${esc(c.n || c.s)}</b> <span class="mute">$${esc((c.s || '').toUpperCase())}</span></span><span>${money(c.mc)}</span><span class="${chCls(c.ch && c.ch.h1)}">${c.ch ? pct(c.ch.h1) : '—'}</span></button>`).join('');
  openModal(`${label(f)} · ${list.length} COINS`, `<p class="c-sub">${f === 'B' ? 'Down 90%+ from their all-time high.' : f === 'L' ? 'New launches and coins under $5K.' : `Market cap ${money(r[0])}${isFinite(r[1]) ? '–' + money(r[1]) : '+'}.`} Sorted by ${f === 'L' ? 'age' : 'market cap'}.</p><div class="flist">${rows}</div>`, true);
  $$('#mBody .frow').forEach(b => { const c = S.by.get(b.dataset.m); if (c) pixelate($('canvas', b), c); });
}
function openHow() {
  const rows = ['PH', ...Array.from({ length: 40 }, (_, i) => String(40 - i))].map(f => { const r = range(f); return `<div><b>${label(f)}</b><span>${money(r[0])}${isFinite(r[1]) ? '–' + money(r[1]) : '+'}</span></div>`; }).join('');
  openModal('HOW TOKVERSE WORKS', `<div class="prose">
    <h3>EVERY FLOOR IS A MARKET CAP</h3>
    <p>TOKVERSE pulls live pump.fun coins and gives each one the floor its market cap pays for. Floor 1 starts at $5K, every floor up costs about 28% more, and floor 40 tops out at $100M. Past $100M you get the penthouse.</p>
    <h3>GREEN CANDLES TAKE THE ELEVATOR</h3>
    <p>When a coin's market cap crosses into a higher floor's range, it rides the elevator up. When it drops into a lower range, it walks down the stairs. The elevator log shows who moved: the last hour (from each coin's 1h change) and every move since you opened the page.</p>
    <h3>LOBBY, BASEMENT, PENTHOUSE</h3>
    <p>The lobby holds launches younger than 10 minutes and anything under $5K. The basement is for coins down 90% or more from an all-time high above $100K: laid off. The penthouse is $100M and up.</p>
    <h3>WHERE THE DATA COMES FROM</h3>
    <p>pump.fun's public coin lists (top market caps, latest trades, newest launches) plus Dexscreener for price changes, volume and liquidity, refreshed every 30 seconds. Coins whose market cap is far out of line with their liquidity are skipped, because those numbers usually come from a thin or rigged pool.</p>
    <h3>LAUNCH LAB</h3>
    <p>Launch a pump.fun coin from here. Your wallet signs the transaction; the site never sees your keys. New coins check in at the lobby like everyone else.</p>
    <p class="mute">Not affiliated with pump.fun. Nothing here is financial advice; memecoins are extremely risky.</p>
    <h3>THE FLOORS</h3><div class="ftable">${rows}</div>
    <h3>FAQ</h3><div class="faq">
      <details><summary>Is TOKVERSE part of pump.fun?</summary><p>No. It reads pump.fun's public coin data, checks it against Dexscreener and links you to pump.fun to trade.</p></details>
      <details><summary>Why isn't my coin in the building?</summary><p>The building holds about 500 coins at a time: pump.fun's biggest market caps, the coins trading right now and the newest launches. Quiet coins rotate out and come back when they trade. Coins with numbers that don't add up are skipped.</p></details>
      <details><summary>How often does it update?</summary><p>Every 30 seconds while the page is open. Moves since you opened the page animate live; the log also shows the last hour from each coin's 1h change.</p></details>
      <details><summary>What are the green and red tags on each coin?</summary><p>The price change over the last hour. Green is up, red is down.</p></details>
      <details><summary>What do keys and stars mean?</summary><p>Connect a wallet and every coin you hold gets a key. Press ☆ WATCH in a card to star a coin; your watchlist stays in this browser. The site only reads public balances and never moves funds unless you sign a launch.</p></details>
      <details><summary>Does Launch Lab cost extra?</summary><p>TOKVERSE adds no fee. pump.fun and PumpPortal charge their usual fees on the launch and the dev buy, plus Solana rent and network fees.</p></details>
      <details><summary>Is any of this advice?</summary><p>No. It's a game built on live market data. Memecoins are extremely risky.</p></details>
    </div></div>`, true);
}

/* ------------------------------------------------------------------ launch lab */
let IMG = null, busy = false;
function openLaunch() {
  openModal('LAUNCH LAB', `<div class="lgrid"><form class="lf" id="lf" novalidate>
    <label class="up-img" for="lfile"><span class="bigpic" id="limg">ADD<br>IMAGE</span><span class="note" style="margin:0">PNG, JPG, GIF or WEBP, up to 2.5 MB. Square works best.</span></label>
    <input id="lfile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
    <div class="lrow"><label>NAME<input id="lname" maxlength="32" placeholder="Elevator Cat"></label><label>TICKER<input id="lsym" maxlength="10" placeholder="LIFT"></label></div>
    <label>DESCRIPTION<textarea id="ldesc" maxlength="500" placeholder="what is it, in one breath"></textarea></label>
    <div class="lrow"><label>X LINK (OPTIONAL)<input id="lx" maxlength="200" placeholder="https://x.com/…"></label><label>WEBSITE (OPTIONAL)<input id="lweb" maxlength="200" placeholder="https://…"></label></div>
    <label>DEV BUY (SOL)<input id="lbuy" type="number" min="0.001" max="5" step="0.001" value="0.05" inputmode="decimal"></label>
    <div class="wpick" id="wpick" hidden></div>
    <div><button class="btn big" id="lgo" type="submit">LAUNCH ON PUMP.FUN</button></div>
    <p class="note" id="lnote">Your wallet signs. pump.fun and PumpPortal network fees apply, plus about 0.03 SOL for rent and fees.</p>
  </form>
  <div><div class="lprev" id="lprev"><span class="tn"><span class="pic"><canvas width="14" height="14" id="lcv"></canvas></span><span class="tk" id="ltk">$TICKER</span><span class="mc">LOBBY</span></span></div>
    <p class="note">This is how your coin checks in at the lobby. It moves up as its market cap grows.</p>
    <ol class="steps" id="lsteps"></ol><div class="done" id="ldone" hidden></div>${myLaunches()}</div></div>`, true);
  const cv = $('#lcv'); const blank = () => { const g = cv.getContext('2d'); g.fillStyle = '#bbf7d0'; g.fillRect(0, 0, 14, 14); }; blank();
  if (IMG) { $('#limg').style.backgroundImage = `url("${IMG}")`; $('#limg').textContent = ''; pixelateFile(cv, IMG); }
  $('#lfile').addEventListener('change', () => {
    const f = $('#lfile').files[0]; if (!f) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) return lnote('That file isn’t a PNG, JPG, GIF or WEBP.', true);
    if (f.size > 2500000) return lnote('That image is over 2.5 MB.', true);
    const r = new FileReader(); r.onload = () => { IMG = r.result; $('#limg').style.backgroundImage = `url("${IMG}")`; $('#limg').textContent = ''; pixelateFile(cv, IMG); lnote(''); }; r.readAsDataURL(f);
  });
  $('#lsym').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); $('#ltk').textContent = '$' + (e.target.value || 'TICKER'); });
  $('#lf').addEventListener('submit', onLaunch);
  paintSteps(-1);
}
function myLaunches() {
  const L = store.get('tok-launches', []); if (!L.length) return '';
  return `<div class="mylist"><p class="note" style="margin:0">YOUR LAUNCHES (this browser)</p>${L.slice(0, 6).map(x => { const c = S.by.get(x.ca); const f = S.place && S.place.where[x.ca];
    return `<div class="hqbar"><b>$${esc(x.symbol)}</b><span class="mute">${esc(short(x.ca))}</span><span>${c ? esc(label(f)) + ' · ' + money(c.mc) : 'not in the building yet'}</span><a class="btn sm" href="https://pump.fun/coin/${esc(x.ca)}" target="_blank" rel="noopener">PUMP.FUN</a>${c ? `<button class="btn w sm" type="button" data-coin="${esc(x.ca)}">CARD</button>` : ''}</div>`; }).join('')}</div>`;
}
function saveLaunch(r) { const mine = store.get('tok-launches', []).filter(x => x.ca !== r.ca); mine.unshift({ ca: r.ca, symbol: r.symbol, sig: r.sig, t: Date.now() }); store.set('tok-launches', mine.slice(0, 20)); }
function showDone(r, ok) {
  const d = $('#ldone'); if (!d) return; d.hidden = false;
  d.innerHTML = `<b>${ok ? `$${esc(r.symbol)} is live on pump.fun.` : `$${esc(r.symbol)} was sent to Solana. Confirming…`}</b><div class="ca"><span>${esc(r.ca)}</span><button class="btn sm" type="button" data-copy="${esc(r.ca)}">COPY CA</button></div>
    <div class="links"><a class="btn" href="https://pump.fun/coin/${esc(r.ca)}" target="_blank" rel="noopener">PUMP.FUN</a><a class="btn w" href="https://solscan.io/tx/${esc(r.sig)}" target="_blank" rel="noopener">TX ON SOLSCAN</a></div>
    <span class="note" style="margin:0">${ok ? 'It checks in at the lobby with the next refresh.' : 'Keep this window open. The CA is saved in this browser.'}</span>`;
}
function lnote(t, bad) { const n = $('#lnote'); if (!n) return; n.textContent = t || ''; n.classList.toggle('bad', !!bad); }
function paintSteps(at, bad) { const ol = $('#lsteps'); if (!ol) return; ol.innerHTML = at < 0 ? '' : STEPS.map((t, i) => `<li class="${i < at ? 'ok' : i === at ? (bad ? 'bad' : 'run') : ''}"><i></i>${esc(t)}</li>`).join(''); }
async function onLaunch(e) {
  e.preventDefault(); if (busy) return;
  const name = $('#lname').value.trim(), symbol = $('#lsym').value.trim(), amount = +$('#lbuy').value;
  const x = $('#lx').value.trim(), web = $('#lweb').value.trim();
  if (!IMG) return lnote('Add a coin image.', true);
  if (!name || !symbol) return lnote('Add a name and a ticker.', true);
  if (!(amount >= 0.001 && amount <= 5)) return lnote('Dev buy has to be between 0.001 and 5 SOL.', true);
  if ((x && !/^https:\/\//.test(x)) || (web && !/^https:\/\//.test(web))) return lnote('Links have to start with https://', true);
  if (!WAL.pk) { lnote('Connect a wallet first.', true); return connect($('#wpick'), lnote); }
  if (WAL.sol != null && WAL.sol < amount + 0.03) return lnote(`You need about ${(amount + 0.03).toFixed(3)} SOL: the dev buy plus roughly 0.03 for fees and rent.`, true);
  busy = true; $('#lgo').disabled = true; lnote(''); $('#ldone').hidden = true; let at = 0, sent = null;
  try {
    const res = await launch({ image: IMG, name, symbol, description: $('#ldesc').value.trim(), twitter: x, website: web, amount }, i => { at = i; paintSteps(i); }, r => { sent = r; saveLaunch(r); showDone(r, false); });
    showDone(res, true);
    setTimeout(() => refresh(false), 8000);
  } catch (err) {
    paintSteps(at, true);
    if (sent) lnote('Sent, but not confirmed yet. Check the transaction on Solscan before launching again: your CA is saved above.', true);
    else lnote(err && err.code === 4001 ? 'You cancelled in the wallet. Nothing was sent.' : (err.message || 'Something went wrong.'), true);
  } finally { busy = false; const b = $('#lgo'); if (b) b.disabled = false; }
}

/* ------------------------------------------------------------------ wallet UI */
function paintWallet() {
  if (WAL.pk && !modal.hidden && $('#wpick2')) closeModal();
  const b = $('#wbtn'); b.textContent = WAL.pk ? short(WAL.pk) : 'CONNECT'; b.classList.toggle('w', !!WAL.pk);
  if (S.built) renderAll();
  renderMine();
}
onWallet(paintWallet);
function renderMine() {
  const box = $('#myk'); if (!box) return;
  if (!WAL.pk) { box.hidden = true; return; }
  const mine = S.coins.filter(c => WAL.held.has(c.m));
  box.hidden = false;
  box.innerHTML = mine.length ? `<b>YOUR KEYS:</b> ${mine.slice(0, 12).map(c => `<a href="#" data-key="${esc(c.m)}">$${esc((c.s || '').toUpperCase())} (${esc(label(S.place.where[c.m]))})</a>`).join(', ')}` : `<b>YOUR KEYS:</b> none of your coins are in the building right now.`;
}
$('#myk').addEventListener('click', e => { const a = e.target.closest('[data-key]'); if (!a) return; e.preventDefault(); const c = S.by.get(a.dataset.key); if (c) ride(S.place.where[c.m], { open: c.m }); });
function openWallet() {
  if (!WAL.pk) {
    if (walletList().length > 1) { openModal('CONNECT A WALLET', `<p class="c-sub">Pick the wallet to connect. TOKVERSE only reads your public balances.</p><div class="wpick" id="wpick2"></div><p class="note" id="wnote"></p>`); return connect($('#wpick2'), (m, bad) => { const n = $('#wnote'); if (n) { n.textContent = m; n.classList.toggle('bad', !!bad); } }); }
    return connect(null);
  }
  const mine = S.coins.filter(c => WAL.held.has(c.m));
  openModal('WALLET', `<div class="ca"><span>${esc(WAL.pk)}</span><button class="btn sm" type="button" data-copy="${esc(WAL.pk)}">COPY</button></div>
    <p class="c-sub" style="margin-top:12px">${esc(WAL.name)} · ${WAL.sol == null ? 'balance —' : WAL.sol.toFixed(4) + ' SOL'}</p>
    <p class="note">${mine.length ? 'You hold coins on these floors (marked with a key in the tower):' : 'None of the coins you hold are in the building right now.'}</p>
    <div class="flist">${mine.map(c => `<button class="frow" type="button" data-m="${esc(c.m)}"><canvas width="10" height="10"></canvas><span><b>${esc(c.n || c.s)}</b> <span class="mute">$${esc((c.s || '').toUpperCase())}</span></span><span>${esc(label(S.place.where[c.m]))}</span><span>${money(c.mc)}</span></button>`).join('')}</div>
    <div class="links" style="margin-top:14px"><button class="btn r" type="button" id="wdis">DISCONNECT</button></div>`);
  $$('#mBody .frow').forEach(b => { const c = S.by.get(b.dataset.m); if (c) pixelate($('canvas', b), c); });
  $('#wdis').addEventListener('click', () => { disconnect(); closeModal(); });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-wallet]'); if (!b) return; e.preventDefault(); openWallet(); });

/* ------------------------------------------------------------------ search, clicks, misc */
function findCoin(q) {
  q = q.trim(); if (!q) return null; const s = q.replace(/^\$/, '').toLowerCase();
  if (S.by.has(q)) return S.by.get(q);
  const L = S.coins;
  return L.find(c => (c.s || '').toLowerCase() === s) || L.find(c => (c.n || '').toLowerCase() === s) ||
    L.find(c => (c.s || '').toLowerCase().startsWith(s)) || L.find(c => (c.n || '').toLowerCase().startsWith(s)) || L.find(c => (c.n || '').toLowerCase().includes(s)) || null;
}
$('#search').addEventListener('submit', e => {
  e.preventDefault(); const q = $('#q').value; const c = findCoin(q);
  if (!c) return toast(q.trim() ? 'Not in the building right now.' : 'Type a ticker, name or CA.');
  $('#q').blur(); ride(S.place.where[c.m], { open: c.m });
});
document.addEventListener('click', e => {
  const t = e.target;
  const tn = t.closest('.tn[data-m]'); if (tn && tn.closest('#tower')) { openCoin(tn.dataset.m); sfx('tap'); return; }
  const fr = t.closest('.frow[data-m]'); if (fr) { openCoin(fr.dataset.m); return; }
  const fl = t.closest('[data-floor-list]'); if (fl) { openFloorList(fl.dataset.floorList); return; }
  const rd = t.closest('[data-ride]'); if (rd) { const f = rd.dataset.ride; closeModal(); if (!S.inGame) { enterGame(false); setTimeout(() => ride(f), 450); } else ride(f); return; }
  const op = t.closest('[data-open]'); if (op) { $('#nav').classList.remove('open'); const k = op.dataset.open; if (k === 'launch') openLaunch(); else if (k === 'dir') openDirectory('movers'); else if (k === 'watch') openWatchlist(); else openHow(); return; }
  const tb = t.closest('[data-tab]'); if (tb) { openDirectory(tb.dataset.tab); return; }
  const co = t.closest('[data-coin]'); if (co) { openCoin(co.dataset.coin); return; }
  const wt = t.closest('[data-watch]'); if (wt) { toggleWatch(wt.dataset.watch); wt.textContent = WATCH.has(wt.dataset.watch) ? '★ WATCHING' : '☆ WATCH'; return; }
  const chb = t.closest('[data-chart]'); if (chb) { toggleChart(chb.dataset.chart, chb); return; }
  const sc = t.closest('[data-card]'); if (sc) { saveCard(sc.dataset.card, sc); return; }
  const cp = t.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy).then(ok => { const o = cp.textContent; cp.textContent = ok ? 'COPIED' : 'COPY FAILED'; setTimeout(() => cp.textContent = o, 1300); }); return; }
  const cc = t.closest('[data-copyca]'); if (cc && CFG.ca) { copyText(CFG.ca).then(ok => toast(ok ? 'CA copied' : 'Copy failed')); return; }
  const sh = t.closest('[data-share]'); if (sh) {
    const c = S.by.get(sh.dataset.share); if (!c) return; const f = S.place.where[c.m];
    const where = f === 'PH' ? 'the penthouse' : f === 'L' ? 'the lobby' : f === 'B' ? 'the basement' : 'floor ' + f;
    const text = `$${(c.s || '').toUpperCase()} lives on ${where} of TOKVERSE. green candles take the elevator.`;
    window.open('https://x.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(location.origin + '/?c=' + c.m), '_blank', 'noopener');
  }
});
$('#menuBtn').addEventListener('click', () => $('#nav').classList.toggle('open'));
function closeSides() { $('#logp').classList.remove('open'); $('#panel').classList.remove('open'); }
$('#fabL').addEventListener('click', () => { $('#panel').classList.remove('open'); $('#logp').classList.toggle('open'); });
$('#fabE').addEventListener('click', () => { $('#logp').classList.remove('open'); $('#panel').classList.toggle('open'); });
$('[data-close-side]').addEventListener('click', closeSides);

/* ------------------------------------------------------------------ 8-bit sfx (off by default) */
let AC = null;
function paintSnd() { const b = $('#snd'); b.textContent = S.sfx ? 'SFX ON' : 'SFX OFF'; b.setAttribute('aria-pressed', S.sfx ? 'true' : 'false'); }
$('#snd').addEventListener('click', () => { S.sfx = !S.sfx; store.set('tok-sfx', S.sfx); paintSnd(); if (S.sfx) sfx('ding'); });
function tone(f, t, d, type = 'square', v = .045) {
  const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f, AC.currentTime + t);
  g.gain.setValueAtTime(v, AC.currentTime + t); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + t + d);
  o.connect(g).connect(AC.destination); o.start(AC.currentTime + t); o.stop(AC.currentTime + t + d + .02);
}
function sfx(kind) {
  if (!S.sfx) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume();
    if (kind === 'ding') { tone(1318, 0, .18, 'sine', .07); tone(1046, .16, .32, 'sine', .07); }
    else if (kind === 'go') tone(330, 0, .08);
    else if (kind === 'step') tone(180, 0, .04, 'square', .03);
    else if (kind === 'tap') tone(880, 0, .05, 'square', .03);
  } catch (e) { }
}


/* ------------------------------------------------------------------ watchlist */
const WATCH = new Set(store.get('tok-watch', []));
function toggleWatch(m) {
  if (WATCH.has(m)) WATCH.delete(m); else WATCH.add(m);
  store.set('tok-watch', [...WATCH].slice(0, 200));
  const c = S.by.get(m); toast(WATCH.has(m) ? `Watching $${(c && c.s || '').toUpperCase()}` : 'Removed from your watchlist');
  if (S.built) renderAll(); renderLog();
}
function openWatchlist() {
  const list = [...WATCH].map(m => S.by.get(m)).filter(Boolean);
  const gone = [...WATCH].filter(m => !S.by.has(m));
  openModal(`WATCHLIST · ${WATCH.size}`, `<p class="c-sub">Coins you star in their card. Saved in this browser only. Their moves light up in the elevator log.</p>
    ${list.length ? `<div class="flist">${list.map(c => drow(c, 0, 'watch')).join('')}</div>` : `<p class="note">Nothing here yet. Open any coin and press ☆ WATCH.</p>`}
    ${gone.length ? `<p class="note">${gone.length} watched coin${gone.length === 1 ? ' is' : 's are'} not in the building right now (too small, too new or skipped).</p>` : ''}`, true);
  paintRows();
}

/* ------------------------------------------------------------------ building directory */
function drow(c, i, mode) {
  const f = S.place.where[c.m]; const h1 = c.ch && c.ch.h1;
  const col3 = mode === 'vol' ? money(c.v1 || 0) : mode === 'new' ? ago(c.t0) + ' old' : mode === 'base' ? (c.ath ? pct((c.mc / c.ath - 1) * 100) + ' ATH' : '—') : `<span class="${chCls(h1)}">${pct(h1)}</span>`;
  return `<button class="frow drow" type="button" data-m="${esc(c.m)}"><span class="rk">${i ? i : ''}</span><canvas width="10" height="10"></canvas><span><b>${esc(c.n || c.s)}</b> <span class="mute">$${esc((c.s || '').toUpperCase())}</span></span><span class="fl3">${esc(label(f))}</span><span>${money(c.mc)}</span><span>${col3}</span></button>`;
}
function paintRows() { $$('#mBody .frow').forEach(b => { const c = S.by.get(b.dataset.m); if (c) pixelate($('canvas', b), c); }); }
const TABS = [['movers', 'MOVERS 1H'], ['losers', 'STAIRS 1H'], ['vol', 'VOLUME 1H'], ['new', 'NEW'], ['ph', 'PENTHOUSE'], ['base', 'BASEMENT'], ['floors', 'ALL FLOORS']];
function openDirectory(tab) {
  if (!S.place) return toast('Still opening the building…');
  const big = S.coins.filter(c => c.mc >= 20000 && c.ch && c.ch.h1 != null);
  let body = '', intro = '';
  if (tab === 'movers') { intro = 'Biggest gains in the last hour (coins over $20K).'; body = big.slice().sort((a, b) => b.ch.h1 - a.ch.h1).slice(0, 40).map((c, i) => drow(c, i + 1)).join(''); }
  else if (tab === 'losers') { intro = 'Biggest drops in the last hour (coins over $20K).'; body = big.slice().sort((a, b) => a.ch.h1 - b.ch.h1).slice(0, 40).map((c, i) => drow(c, i + 1)).join(''); }
  else if (tab === 'vol') { intro = 'Most traded in the last hour.'; body = S.coins.filter(c => c.v1).sort((a, b) => b.v1 - a.v1).slice(0, 40).map((c, i) => drow(c, i + 1, 'vol')).join(''); }
  else if (tab === 'new') { intro = 'Newest launches in the building.'; body = S.coins.filter(c => c.t0).sort((a, b) => b.t0 - a.t0).slice(0, 40).map((c, i) => drow(c, i + 1, 'new')).join(''); }
  else if (tab === 'ph') { intro = 'Everyone over $100M.'; body = (S.place.map.PH || []).map((c, i) => drow(c, i + 1)).join(''); }
  else if (tab === 'base') { intro = 'Down 90%+ from an all-time high above $100K.'; body = (S.place.map.B || []).map((c, i) => drow(c, i + 1, 'base')).join(''); }
  else {
    intro = 'Every floor, its range and its biggest tenant.';
    body = ['PH', ...Array.from({ length: 40 }, (_, i) => String(40 - i)), 'L', 'B'].map(f => {
      const L = S.place.map[f] || []; const r = range(f); const top = L[0];
      return `<button class="frow drow" type="button" data-ride="${f}"><span class="rk"></span><span class="fl3">${esc(label(f))}</span><span>${f === 'B' ? 'laid off' : f === 'L' ? 'lobby' : money(r[0]) + (isFinite(r[1]) ? '–' + money(r[1]) : '+')}</span><span>${L.length}</span><span class="hide-m">${top ? '$' + esc((top.s || '').toUpperCase()) : '—'}</span><span class="hide-m">${top ? money(top.mc) : ''}</span></button>`;
    }).join('');
  }
  openModal('BUILDING DIRECTORY', `<div class="tabs">${TABS.map(([k, n]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
    <p class="c-sub">${intro}</p><div class="flist">${body || '<p class="note">Nobody here right now.</p>'}</div>`, true);
  paintRows();
}

/* ------------------------------------------------------------------ live chart (Dexscreener embed) */
function toggleChart(m, btn) {
  const box = $('#cbox'); if (!box) return;
  if (box.firstChild) { box.innerHTML = ''; btn.textContent = 'LIVE CHART'; return; }
  const c = S.by.get(m); const id = (c && c.pair) || m;
  box.innerHTML = `<div class="chartbox"><iframe title="Live chart" loading="lazy" src="https://dexscreener.com/solana/${encodeURIComponent(id)}?embed=1&theme=light&info=0&trades=0&tabs=0&chartLeftToolbar=0"></iframe></div>`;
  btn.textContent = 'HIDE CHART';
}

/* ------------------------------------------------------------------ share card (pixel PNG) */
let wmImg = null;
function loadWm() { if (wmImg) return wmImg; wmImg = new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = '/assets/wordmark-s.png'; }); return wmImg; }
async function saveCard(m, btn) {
  const c = S.by.get(m); if (!c) return;
  const f = S.place.where[m]; const src = $('#mBody .bigpic canvas');
  const W = 200, H = 105, k = 6; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const bands = [PAL.w, PAL.g0, PAL.g1, PAL.g2];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = y / H * 3, i = Math.floor(t), fr = t - i; const by = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]][y & 3][x & 3] / 16; g.fillStyle = bands[Math.min(3, by < fr ? i + 1 : i)]; g.fillRect(x, y, 1, 1); }
  // floor strip
  g.fillStyle = PAL.w; g.fillRect(0, 62, W, 31); g.fillStyle = PAL.g3; g.fillRect(0, 90, W, 1); g.fillStyle = PAL.g2; g.fillRect(0, 91, W, 2);
  for (let x = 6; x < W; x += 48) { g.fillStyle = PAL.g3; g.fillRect(x + 10, 66, 16, 14); g.fillStyle = PAL.g1; g.fillRect(x + 11, 67, 14, 12); g.fillStyle = PAL.g2; g.fillRect(x + 17, 67, 2, 12); g.fillRect(x + 11, 72, 14, 1); }
  g.fillStyle = PAL.g4; g.fillRect(0, 93, W, 1); g.fillStyle = PAL.g5; g.fillRect(0, 94, W, 1); g.fillStyle = PAL.out; g.fillRect(0, 95, W, 1); g.fillStyle = PAL.g3; g.fillRect(0, 96, W, H - 96);
  // the coin, standing on its floor
  g.fillStyle = PAL.out; g.fillRect(13, 35, 34, 34); g.fillStyle = PAL.w; g.fillRect(14, 36, 32, 32);
  try { if (src) { g.imageSmoothingEnabled = false; g.drawImage(src, 15, 37, 30, 30); } } catch (e) { }
  const wm = await loadWm().catch(() => null); if (wm) g.drawImage(wm, 6, 6);
  const sym = '$' + (c.s || '').toUpperCase().slice(0, 10);
  const t1 = pxText(sym, '8px PS', PAL.out); g.drawImage(t1, 54, 37);
  const where = f === 'PH' ? 'PENTHOUSE' : f === 'L' ? 'LOBBY' : f === 'B' ? 'BASEMENT' : 'FLOOR ' + f;
  const t2 = pxText(where + ' · ' + money(c.mc), '8px SK', PAL.g7); g.drawImage(t2, 54, 49);
  const h1 = c.ch && c.ch.h1; if (h1 != null) { const t3 = pxText((h1 >= 0 ? 'ELEVATOR ' : 'STAIRS ') + pct(h1) + ' 1H', '8px SK', h1 >= 0 ? PAL.g6 : PAL.r5); g.drawImage(t3, 54, 59 - 0); }
  const t4 = pxText('the trenches went vertical.', '10px J', PAL.out); g.drawImage(t4, 6, 98);
  const t5 = pxText((location.host || 'tokverse').toUpperCase(), '8px SK', PAL.g7); g.drawImage(t5, W - t5.width - 6, 99);
  const big = document.createElement('canvas'); big.width = W * k; big.height = H * k; const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(cv, 0, 0, W * k, H * k);
  try {
    big.toBlob(b => {
      if (!b) return toast('Could not make the image.');
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `tokverse-${(c.s || 'coin').toLowerCase()}.png`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000); if (btn) { btn.textContent = 'SAVED'; setTimeout(() => btn.textContent = 'SAVE CARD', 1500); }
    }, 'image/png');
  } catch (e) { toast('This coin’s image blocks saving. Try SHARE ON X instead.'); }
}

// local debugging only
if (location.hostname === 'localhost') window.__tok = { S, MQ, refresh, FEL, TEN, queueMoves, rel };
