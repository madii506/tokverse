// Same-origin image proxy for coin logos, so the browser can pixelate them on a canvas.
// Coin images live on dozens of hosts (IPFS gateways, pump.fun, X, launch-bot CDNs...), so any public
// https host is allowed, but never an IP address, a private/local name or a host that resolves to a
// private network. Every redirect hop is re-checked, bodies are streamed with a hard size cap, and only
// raster images are served (no SVG).
const dns = require('dns').promises;
const net = require('net');
const LOCAL = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/i;
const GATEWAYS = ['https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/'];
const MAX = 3 * 1024 * 1024;
const IPFS_PATH = /^\/ipfs\/([A-Za-z0-9]{40,100}(?:\/[^?#]*)?)/;

function okUrl(u) {
  const h = u.hostname;
  return u.protocol === 'https:' && (u.port === '' || u.port === '443') && !u.username && !u.password &&
    h.length < 254 && h.includes('.') && !h.startsWith('[') && !net.isIP(h) && !LOCAL.test(h) && /^[a-z0-9.-]+$/i.test(h);
}
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
}
const DNS_OK = new Map();
async function publicHost(h) {
  const hit = DNS_OK.get(h); if (hit && Date.now() - hit.t < 600000) return hit.ok;
  let ok = false;
  try { const r = await dns.lookup(h, { all: true }); ok = r.length > 0 && r.every(a => !privateIp(a.address)); } catch (e) { ok = false; }
  if (DNS_OK.size > 2000) DNS_OK.clear();
  DNS_OK.set(h, { ok, t: Date.now() }); return ok;
}
function candidates(u) {
  const out = [];
  if (okUrl(u)) out.push(u.toString());
  const m = u.pathname.match(IPFS_PATH);
  const sub = u.hostname.match(/^([a-z0-9]{50,70})\.ipfs\.(?:dweb\.link|nftstorage\.link|w3s\.link)$/);
  const cidPath = m ? m[1] : sub ? sub[1] + u.pathname.replace(/^\/$/, '') : null;
  if (cidPath) for (const g of GATEWAYS) { const c = g + cidPath; if (!out.includes(c)) out.push(c); }
  return out.slice(0, 4);
}

async function grab(url, deadline) {
  let cur = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!okUrl(cur) || !(await publicHost(cur.hostname))) throw new Error('host not allowed');
    const left = deadline - Date.now(); if (left < 500) throw new Error('out of time');
    const c = new AbortController(); const t = setTimeout(() => c.abort(), Math.min(4500, left));
    try {
      const r = await fetch(cur.toString(), { signal: c.signal, redirect: 'manual', headers: { 'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8', 'User-Agent': 'Mozilla/5.0 (compatible; TOKVERSE/1.0)' } });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location'); if (!loc) throw new Error('bad redirect');
        cur = new URL(loc, cur); continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(type)) throw new Error('not an image');
      if (+(r.headers.get('content-length') || 0) > MAX) throw new Error('too big');
      const chunks = []; let size = 0;
      if (r.body && r.body.getReader) {
        const rd = r.body.getReader();
        for (;;) {
          const { done, value } = await rd.read(); if (done) break;
          size += value.length; if (size > MAX) { try { rd.cancel(); } catch (e) { } throw new Error('too big'); }
          chunks.push(Buffer.from(value));
        }
      } else { const b = Buffer.from(await r.arrayBuffer()); if (b.length > MAX) throw new Error('too big'); chunks.push(b); }
      return { type, buf: Buffer.concat(chunks) };
    } finally { clearTimeout(t); }
  }
  throw new Error('too many redirects');
}

module.exports = async (req, res) => {
  // only serve this site's own pages (keeps the proxy from being used as a public image host)
  const site = String(req.headers['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).end('same-origin only');
  const raw = String((req.query && req.query.u) || '');
  let u;
  try { u = new URL(raw); } catch (e) { return res.status(400).end('bad url'); }
  const list = candidates(u);
  if (!list.length) return res.status(403).end('host not allowed');
  const deadline = Date.now() + 9000;
  for (const c of list) {
    if (deadline - Date.now() < 800) break;
    try {
      const { type, buf } = await grab(c, deadline);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      return res.status(200).end(buf);
    } catch (e) { /* try the next source */ }
  }
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  return res.status(502).end('image unavailable');
};
