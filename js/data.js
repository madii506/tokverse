// Live coins -> floors. Floor 1 starts at $5K, each floor is ~28% more, floor 40 ends at $100M.
export const F0 = 5000, FTOP = 1e8, NF = 40, RR = Math.pow(FTOP / F0, 1 / NF);
export const FLOORS = ['PH', ...Array.from({ length: NF }, (_, i) => String(NF - i)), 'L'];

export function floorNum(mc) {
  if (!(mc > 0)) return 'L';
  if (mc >= FTOP) return 'PH';
  if (mc < F0) return 'L';
  return String(Math.min(NF, 1 + Math.floor(Math.log(mc / F0) / Math.log(RR))));
}
// laid off: down 90%+ from an all-time high above $100K, and now under $250K
export function floorOf(c, now = Date.now()) {
  if (c.ath >= 1e5 && c.mc < c.ath * 0.1 && c.mc < 2.5e5) return 'B';
  if (c.t0 && now - c.t0 < 10 * 60000) return 'L';
  return floorNum(c.mc);
}
export function range(f) {
  if (f === 'PH') return [FTOP, Infinity];
  if (f === 'L') return [0, F0];
  if (f === 'B') return null;
  const n = +f; return [F0 * Math.pow(RR, n - 1), F0 * Math.pow(RR, n)];
}
export const rank = f => f === 'B' ? -1 : f === 'L' ? 0 : f === 'PH' ? NF + 1 : +f;
export const label = f => f === 'PH' ? 'PH' : f === 'L' ? 'L' : f === 'B' ? 'B' : f + 'F';

// where the coin was an hour ago (from its 1h price change); null if unknown
export function floor1h(c, now = Date.now()) {
  const h1 = c.ch && c.ch.h1;
  if (h1 == null || !isFinite(h1) || h1 <= -99.5) return null;
  if (c.t0 && now - c.t0 < 70 * 60000) return null;
  return floorNum(c.mc / (1 + h1 / 100));
}

const SEED = [
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',
  'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY',
  'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump', '5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp',
  '8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn', 'GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump'
];
const DS = 'https://api.dexscreener.com';
// names that never get a room (same list as /api/tower; this also covers the browser-side backup)
const DENY = [
  /n+[i1!|l]+gg+(a|er|uh|az|ah)/i, /\bnigs?\b/i, /\bf[a@4]gg?[o0]t/i, /\bkikes?\b/i, /\bjews?\b/i, /jewcat/i, /hitler/i, /\bnazi/i,
  /1488/, /\bheil\b/i, /\bkkk\b/i, /happy\s*merchant/i, /retard/i, /\brap(e|ed|es|ist)\b/i, /\bpedo/i, /\bchinks?\b/i,
  /\btrann(y|ie)/i, /holocaust/i, /\bslur\b/i, /\bisis\b/i, /school\s*shoot/i, /nidal/i
];
export const badName = c => DENY.some(re => re.test(c.n || '') || re.test(c.s || ''));
async function gj(u, ms = 7000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, { signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); }
}
const num = v => (v == null || v === '' || !isFinite(+v)) ? null : +v;
const str = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, n);
const r1 = v => v == null ? null : Math.round(v * 10) / 10;

// browser-side backup when /api/tower can't answer: Dexscreener only
async function dexFallback() {
  const lists = await Promise.all([`${DS}/token-boosts/top/v1`, `${DS}/token-boosts/latest/v1`, `${DS}/token-profiles/latest/v1`].map(u => gj(u).catch(() => [])));
  const set = new Set(SEED);
  for (const l of lists) for (const t of (Array.isArray(l) ? l : [])) if (t && t.chainId === 'solana' && /pump$/.test(t.tokenAddress || '')) set.add(t.tokenAddress);
  const mints = [...set].slice(0, 210); const best = {};
  for (let i = 0; i < mints.length; i += 30) {
    try {
      const arr = await gj(`${DS}/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`);
      for (const p of (Array.isArray(arr) ? arr : [])) { const a = p.baseToken && p.baseToken.address; const lq = (p.liquidity && +p.liquidity.usd) || 0; if (a && (!best[a] || lq > best[a]._l)) best[a] = Object.assign(p, { _l: lq }); }
    } catch (e) { }
  }
  const coins = [];
  for (const m of mints) {
    const p = best[m]; if (!p) continue;
    try {
    const mc = num(p.marketCap) || num(p.fdv) || 0, liq = Math.round(p._l || 0), curve = p.dexId === 'pumpfun';
    if (!mc || (!curve && mc > 1e6 && liq > 0 && mc / liq > 150) || (!curve && mc > 2e5 && liq < 1500)) continue;
    const v24 = (p.volume && +p.volume.h24) || 0, t0 = num(p.pairCreatedAt) || 0;
    if (mc >= 1e6 && v24 / mc < 0.06) continue; // big cap, almost no trading: usually a rigged pool
    if (t0 && Date.now() - t0 > 864e5 && v24 < 50) continue; // dead
    const pc = p.priceChange || {}, info = (p.info && typeof p.info === 'object') ? p.info : {}, so = Array.isArray(info.socials) ? info.socials : [];
    const x = str((so.find(s => s && /twitter|^x$/i.test(str(s.type, 20))) || {}).url, 200), tg = str((so.find(s => s && /telegram/i.test(str(s.type, 20))) || {}).url, 200);
    coins.push({
      m, n: str(p.baseToken.name, 40), s: str(p.baseToken.symbol, 14), i: str(info.imageUrl, 400), mc: Math.round(mc), t0: num(p.pairCreatedAt) || 0,
      done: curve ? 0 : 1, ch: { m5: r1(num(pc.m5)), h1: r1(num(pc.h1)), h6: r1(num(pc.h6)), h24: r1(num(pc.h24)) }, v24: Math.round((p.volume && p.volume.h24) || 0),
      v1: Math.round((p.volume && p.volume.h1) || 0), b1: (p.txns && p.txns.h1 && p.txns.h1.buys) | 0, s1: (p.txns && p.txns.h1 && p.txns.h1.sells) | 0, liq, dex: p.dexId, pair: p.pairAddress,
      x, tg, w: str(Array.isArray(info.websites) && info.websites[0] && info.websites[0].url, 200)
    });
    if (badName(coins[coins.length - 1])) coins.pop();
    } catch (e) { /* skip a malformed record */ }
  }
  coins.sort((a, b) => b.mc - a.mc);
  return { ok: true, t: Date.now(), src: 'dexscreener', coins };
}

export async function loadTower() {
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch('/api/tower', { cache: 'no-store', signal: c.signal }); clearTimeout(t);
    if (r.ok) { const j = await r.json(); if (j && j.ok && Array.isArray(j.coins) && j.coins.length) { j.coins = j.coins.filter(c => c && !badName(c)); return j; } }
  } catch (e) { }
  const f = await dexFallback();
  if (!f.coins.length) throw new Error('No live data right now.');
  return f;
}

// group coins by floor; returns { map: {floor: [coins]}, where: {mint: floor} }
export function place(coins, now = Date.now()) {
  const map = {}; const where = {};
  for (const f of [...FLOORS, 'B']) map[f] = [];
  for (const c of coins) { const f = floorOf(c, now); (map[f] || (map[f] = [])).push(c); where[c.m] = f; }
  for (const f in map) {
    if (f === 'L') map[f].sort((a, b) => (b.t0 || 0) - (a.t0 || 0));
    else map[f].sort((a, b) => b.mc - a.mc);
  }
  return { map, where };
}
