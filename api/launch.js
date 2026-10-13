// TOKVERSE launch proxy. The browser can't call pump.fun's IPFS or PumpPortal directly (CORS),
// so this function forwards two requests. It never sees a private key: the browser makes the
// mint keypair, and the user's wallet signs.
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
async function timed(url, opt, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, Object.assign({}, opt, { signal: c.signal })); }
  catch (e) { throw new Error(e && e.name === 'AbortError' ? 'The launch service took too long. Try again in a minute.' : 'Could not reach the launch service.'); }
  finally { clearTimeout(t); }
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  // only this site's own pages may use the proxy
  const site = String((req.headers && req.headers['sec-fetch-site']) || '');
  const origin = String((req.headers && req.headers.origin) || ''), host = String((req.headers && req.headers.host) || '');
  if ((site && site !== 'same-origin') || (origin && host && origin.replace(/^https?:\/\//, '') !== host)) return res.status(403).json({ error: 'Launches only work from the TOKVERSE site.' });
  const op = (req.query && req.query.op) || '';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  try {
    if (op === 'ipfs') {
      const image = String(body.image || '');
      const m = image.match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return res.status(400).json({ error: 'The image has to be a PNG, JPG, GIF or WEBP.' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 2500000) return res.status(400).json({ error: 'The image is over 2.5 MB.' });
      const name = String(body.name || '').trim().slice(0, 32);
      const symbol = String(body.symbol || '').trim().replace(/^\$/, '').toUpperCase().slice(0, 10);
      if (!name || !/^[A-Z0-9]{1,10}$/.test(symbol)) return res.status(400).json({ error: 'Add a name and a ticker (letters and numbers).' });
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: m[1] }), 'image.' + m[1].split('/')[1].replace('jpeg', 'jpg'));
      fd.append('name', name);
      fd.append('symbol', symbol);
      fd.append('description', String(body.description || '').slice(0, 500));
      fd.append('twitter', String(body.twitter || '').slice(0, 200));
      fd.append('telegram', '');
      fd.append('website', String(body.website || '').slice(0, 200));
      fd.append('showName', 'true');
      const r = await timed('https://pump.fun/api/ipfs', { method: 'POST', body: fd }, 20000);
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch (e) {}
      if (!r.ok || !j || !j.metadataUri) return res.status(502).json({ error: 'pump.fun did not accept the metadata (' + r.status + '). Try again in a minute.' });
      return res.status(200).json({ uri: j.metadataUri, name, symbol });
    }
    if (op === 'tx') {
      const publicKey = String(body.publicKey || ''), mint = String(body.mint || ''), uri = String(body.uri || '');
      const name = String(body.name || '').trim().slice(0, 32);
      const symbol = String(body.symbol || '').trim().replace(/^\$/, '').toUpperCase().slice(0, 10);
      const amount = Math.max(0.001, Math.min(5, Number(body.amount) || 0.01));
      if (!B58.test(publicKey) || !B58.test(mint)) return res.status(400).json({ error: 'Bad wallet or mint address.' });
      if (!/^https:\/\//.test(uri) || !name || !symbol) return res.status(400).json({ error: 'Missing metadata.' });
      const r = await timed('https://pumpportal.fun/api/trade-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey, action: 'create', tokenMetadata: { name, symbol, uri }, mint, denominatedInSol: 'true', amount, slippage: 10, priorityFee: 0.0005, pool: 'pump' })
      }, 15000);
      if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'PumpPortal said: ' + t.slice(0, 160) }); }
      const tx = Buffer.from(await r.arrayBuffer()).toString('base64');
      return res.status(200).json({ tx });
    }
    return res.status(400).json({ error: 'Unknown op.' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) });
  }
};
