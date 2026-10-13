// TOKVERSE tower data. Real pump.fun coins (pump.fun's public API), checked and enriched with
// Dexscreener (price changes, volume, liquidity). Coins whose numbers can't be trusted are skipped:
// market cap far out of line with liquidity, big unverified coins with almost no volume (usually a
// rigged pool), dead coins, banned/NSFW coins and hateful names.
const PF = 'https://frontend-api-v3.pump.fun/coins';
const DS = 'https://api.dexscreener.com';
const HDR = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; TOKVERSE/1.0)' };
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DAY = 864e5;
// well-known pump.fun coins, used only if pump.fun's own list can't be reached
const SEED = [
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',
  'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY',
  'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump', '5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp',
  '8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn', 'GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump'
];
// pump.fun pages: the biggest coins, the biggest still on the bonding curve, the most recently
// traded and the newest launches (22 pages of 50)
const PAGES = [
  ...[0, 50, 100, 150, 200, 250, 300, 350, 400, 450].map(o => `sort=market_cap&offset=${o}`),
  ...[0, 50, 100].map(o => `sort=market_cap&complete=false&offset=${o}`),
  ...[0, 50, 100, 150, 200, 250, 300].map(o => `sort=last_trade_timestamp&offset=${o}`),
  ...[0, 50].map(o => `sort=created_timestamp&offset=${o}`)
];
// names that never get a room in the building
const DENY = [
  /n+[i1!|l]+gg+(a|er|uh|az|ah)/i, /\bnigs?\b/i, /\bf[a@4]gg?[o0]t/i, /\bkikes?\b/i, /\bjews?\b/i, /jewcat/i, /hitler/i, /\bnazi/i,
  /1488/, /\bheil\b/i, /\bkkk\b/i, /happy\s*merchant/i, /retard/i, /\brap(e|ed|es|ist)\b/i, /\bpedo/i, /\bchinks?\b/i,
  /\btrann(y|ie)/i, /holocaust/i, /\bslur\b/i, /\bisis\b/i, /school\s*shoot/i, /nidal/i
];
const badName = c => DENY.some(re => re.test(c.n || '') || re.test(c.s || ''));
// tower geometry (same as js/data.js): used to keep every floor stocked without sending thousands of coins
const F0 = 5000, FTOP = 1e8, NF = 40, RR = Math.pow(FTOP / F0, 1 / NF);
function floorKey(c, now) {
  if (c.ath >= 1e5 && c.mc < c.ath * 0.1 && c.mc < 2.5e5) return 'B';
  if (c.t0 && now - c.t0 < 10 * 60000) return 'L';
  if (!(c.mc > 0) || c.mc < F0) return 'L';
  if (c.mc >= FTOP) return 'PH';
  return String(Math.min(NF, 1 + Math.floor(Math.log(c.mc / F0) / Math.log(RR))));
}
const PER_FLOOR = 28, PER_LOBBY = 40, PER_BASE = 24, MAX_OUT = 640;

async function getJson(url, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 6000);
  try {
    const r = await fetch(url, { headers: HDR, signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// all pump.fun pages, 8 at a time, inside the time budget
async function pumpAll(deadline) {
  const out = new Array(PAGES.length).fill(null); let k = 0, ok = 0;
  async function worker() {
    while (k < PAGES.length) {
      const i = k++; const left = deadline - Date.now(); if (left < 600) return;
      try {
        const a = await getJson(`${PF}?${PAGES[i]}&limit=50&order=DESC&includeNsfw=false`, Math.min(5000, left));
        out[i] = Array.isArray(a) ? a : (a && Array.isArray(a.coins) ? a.coins : []); ok++;
      } catch (e) { out[i] = []; }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return { pages: out.map(p => p || []), ok };
}

const num = v => (v == null || v === '' || !isFinite(+v)) ? null : +v;
const str = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, n);
// last good Dexscreener pair per mint, so one failed chunk doesn't blank the top floors (warm instances only)
const PAIR_CACHE = new Map();
const r1 = v => v == null ? null : Math.round(v * 10) / 10;

function fromPump(c) {
  return {
    m: c.mint, n: str(c.name, 40), s: str(c.symbol, 14).replace(/^\$/, ''),
    i: str(c.image_uri, 400), mc: num(c.usd_market_cap) || 0, ath: num(c.ath_market_cap) || 0,
    t0: num(c.created_timestamp) || 0, lt: num(c.last_trade_timestamp) || 0, done: !!c.complete, ver: c.verified === true,
    x: str(c.twitter, 200), tg: str(c.telegram, 200), w: str(c.website, 200), rp: num(c.reply_count) | 0, live: !!c.is_currently_live,
    ban: !!c.is_banned, nsfw: !!c.nsfw
  };
}

async function dexPairs(mints, deadline) {
  const best = {};
  const chunks = []; for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
  let k = 0;
  async function worker() {
    while (k < chunks.length) {
      const ch = chunks[k++];
      const left = deadline - Date.now(); if (left < 700) return;
      try {
        const arr = await getJson(`${DS}/tokens/v1/solana/${ch.join(',')}`, Math.min(5000, left));
        for (const p of (Array.isArray(arr) ? arr : [])) {
          const a = p && p.baseToken && typeof p.baseToken.address === 'string' && p.baseToken.address; if (!a) continue;
          const liq = num(p.liquidity && p.liquidity.usd) || 0;
          if (!best[a] || liq > best[a]._liq) best[a] = Object.assign(p, { _liq: liq });
        }
      } catch (e) { /* keep going: a missing chunk just means less detail */ }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const now = Date.now();
  for (const m of mints) {
    if (best[m]) PAIR_CACHE.set(m, { p: best[m], t: now });
    else { const c = PAIR_CACHE.get(m); if (c && now - c.t < 180000) best[m] = c.p; }
  }
  if (PAIR_CACHE.size > 5000) { for (const [k2, v] of PAIR_CACHE) if (now - v.t > 180000) PAIR_CACHE.delete(k2); }
  return best;
}

function enrich(c, p) {
  if (!p) return c;
  const pc = p.priceChange || {}, tx = p.txns || {}, vol = p.volume || {};
  const mc = num(p.marketCap) || num(p.fdv);
  if (mc) c.mc = mc;
  c.ch = { m5: r1(num(pc.m5)), h1: r1(num(pc.h1)), h6: r1(num(pc.h6)), h24: r1(num(pc.h24)) };
  c.v24 = Math.round(num(vol.h24) || 0); c.v1 = Math.round(num(vol.h1) || 0);
  c.b1 = (tx.h1 && tx.h1.buys) | 0; c.s1 = (tx.h1 && tx.h1.sells) | 0;
  c.liq = Math.round(p._liq || 0); c.dex = str(p.dexId, 30); c.pair = str(p.pairAddress, 60);
  if (!c.t0 && num(p.pairCreatedAt)) c.t0 = num(p.pairCreatedAt);
  const info = (p.info && typeof p.info === 'object') ? p.info : {};
  const di = str(info.imageUrl, 400);
  if (!c.i && di) c.i = di; else if (di && di !== c.i) c.i2 = di;
  if (!c.n) c.n = str(p.baseToken.name, 40);
  if (!c.s) c.s = str(p.baseToken.symbol, 14);
  for (const s of (Array.isArray(info.socials) ? info.socials : [])) {
    if (!s || typeof s !== 'object') continue;
    if (!c.x && /twitter|^x$/i.test(str(s.type, 20))) c.x = str(s.url, 200);
    if (!c.tg && /telegram/i.test(str(s.type, 20))) c.tg = str(s.url, 200);
  }
  if (!c.w && Array.isArray(info.websites) && info.websites[0]) c.w = str(info.websites[0].url, 200);
  c.ds = 1;
  return c;
}

// why a coin can't be trusted (or '' when it's fine)
function why(c, now) {
  if (!c.mc || c.mc <= 0) return 'nomc';
  const age = c.t0 ? now - c.t0 : 0;
  if (c.ds) {
    const curve = c.dex === 'pumpfun';
    if (!curve && c.mc > 1e6 && c.liq > 0 && c.mc / c.liq > 150) return 'liq';
    if (!curve && c.mc > 2e5 && c.liq < 1500) return 'liq';
    // a $1M+ coin that trades less than 6% of its cap in a day, without pump.fun's verified badge
    if (!c.ver && c.mc >= 1e6 && (c.v24 || 0) / c.mc < 0.06) return 'vol';
    if (age > DAY && (c.v24 || 0) < 50) return 'dead';
    return '';
  }
  // no Dexscreener data: only trust bonding-curve numbers (they come from the curve itself)
  if (c.done && c.mc > 3e6 && !c.ver) return 'nods';
  if (age > DAY && c.lt && now - c.lt > DAY) return 'dead';
  return '';
}

function slim(c) {
  const o = { m: c.m, n: c.n, s: c.s, i: c.i, mc: Math.round(c.mc), t0: Math.round(c.t0 || 0) };
  if (c.i2) o.i2 = c.i2;
  if (c.ath) o.ath = Math.round(c.ath);
  if (c.done) o.done = 1;
  if (c.ver) o.ver = 1;
  if (c.ch) o.ch = c.ch;
  for (const k of ['v24', 'v1', 'b1', 's1', 'liq']) if (c[k]) o[k] = c[k];
  for (const k of ['dex', 'pair', 'x', 'tg', 'w']) if (c[k]) o[k] = String(c[k]).slice(0, 200);
  if (c.rp) o.rp = c.rp;
  if (c.live) o.live = 1;
  return o;
}

async function fromDexOnly(deadline) {
  const lists = await Promise.all([
    getJson(`${DS}/token-boosts/top/v1`, 4000).catch(() => []),
    getJson(`${DS}/token-boosts/latest/v1`, 4000).catch(() => []),
    getJson(`${DS}/token-profiles/latest/v1`, 4000).catch(() => [])
  ]);
  const set = new Set(SEED);
  for (const l of lists) for (const t of (Array.isArray(l) ? l : [])) {
    if (t && t.chainId === 'solana' && /pump$/.test(t.tokenAddress || '')) set.add(t.tokenAddress);
  }
  const mints = [...set].slice(0, 240);
  const pairs = await dexPairs(mints, deadline);
  const out = [];
  for (const m of mints) {
    const p = pairs[m]; if (!p) continue;
    try { out.push(enrich({ m, n: '', s: '', i: '', mc: 0, ath: 0, t0: 0, done: p.dexId !== 'pumpfun', x: '', tg: '', w: '' }, p)); } catch (e) { }
  }
  return out;
}

// keep every floor stocked: the busiest coins per floor, the newest in the lobby
function pickFloors(coins, now) {
  const by = new Map();
  for (const c of coins) { const f = floorKey(c, now); if (!by.has(f)) by.set(f, []); by.get(f).push(c); }
  const out = [];
  for (const [f, list] of by) {
    if (f === 'L') list.sort((a, b) => (b.t0 || 0) - (a.t0 || 0));
    else if (f === 'B') list.sort((a, b) => b.mc - a.mc);
    else list.sort((a, b) => (b.v24 || 0) - (a.v24 || 0) || b.mc - a.mc);
    out.push(...list.slice(0, f === 'L' ? PER_LOBBY : f === 'B' ? PER_BASE : PER_FLOOR));
  }
  out.sort((a, b) => b.mc - a.mc);
  return out.slice(0, MAX_OUT);
}

async function build() {
  const t0 = Date.now();
  const { pages, ok } = await pumpAll(t0 + 5500);
  const map = new Map(); const skip = { ban: 0, name: 0 };
  for (const pg of pages) for (const raw of pg) {
    try {
      if (!raw || typeof raw.mint !== 'string' || !B58.test(raw.mint) || map.has(raw.mint)) continue;
      const c = fromPump(raw);
      if (c.ban || c.nsfw) { skip.ban++; continue; }
      if (badName(c)) { skip.name++; continue; }
      map.set(c.m, c);
    } catch (e) { /* skip one bad record, keep the rest */ }
  }
  let coins = [...map.values()];
  let src = 'pump.fun + dexscreener';
  const deadline = t0 + 11500;
  if (coins.length) {
    const pairs = await dexPairs(coins.map(c => c.m), deadline);
    coins = coins.map(c => { try { return enrich(c, pairs[c.m]); } catch (e) { return c; } });
  } else {
    coins = (await fromDexOnly(deadline)).filter(c => !badName(c));
    src = 'dexscreener';
  }
  const now = Date.now();
  coins = coins.filter(c => {
    const w = why(c, now); if (w) { skip[w] = (skip[w] || 0) + 1; return false; }
    // pump.fun sometimes reports absurd all-time highs; never show an ATH below the current cap
    if (!(c.ath > 0) || c.ath > 1e10) c.ath = 0;
    if (c.ath && c.ath < c.mc) c.ath = c.mc;
    return true;
  });
  const kept = pickFloors(coins, now);
  return { src, pages: ok, found: map.size, skip, out: kept.map(slim), ms: Date.now() - t0 };
}

module.exports = async (req, res) => {
  try {
    const r = await build();
    if (!r.out.length) { res.setHeader('Cache-Control', 'no-store'); return res.status(502).json({ ok: false, error: 'No live data from pump.fun or Dexscreener right now.' }); }
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const skipped = Object.values(r.skip).reduce((a, b) => a + b, 0);
    return res.status(200).send(JSON.stringify({ ok: true, t: Date.now(), ms: r.ms, src: r.src, pages: r.pages, found: r.found, skipped, why: r.skip, n: r.out.length, coins: r.out }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 160) });
  }
};
module.exports.build = build;
