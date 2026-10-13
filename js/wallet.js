// Wallet + Launch Lab. The user's wallet signs everything; keys never leave the browser.
import { $, esc, short, toast } from './util.js';

const RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const WAL = { pk: null, prov: null, name: '', sol: null, held: new Set() };
const subs = new Set();
export const onWallet = f => subs.add(f);
const emit = () => subs.forEach(f => { try { f(WAL); } catch (e) { } });

let W3 = null;
export function web3() {
  if (W3) return W3;
  W3 = new Promise((ok, no) => {
    if (window.solanaWeb3) return ok(window.solanaWeb3);
    const sc = document.createElement('script'); sc.src = '/vendor/web3.min.js'; sc.async = true;
    sc.onload = () => window.solanaWeb3 ? ok(window.solanaWeb3) : no(new Error('Solana library failed to load.'));
    sc.onerror = () => { W3 = null; no(new Error('Could not load the Solana library.')); };
    document.head.appendChild(sc);
  });
  return W3;
}
export function walletList() {
  const L = [], ph = window.phantom && window.phantom.solana;
  if (ph && ph.isPhantom) L.push(['Phantom', ph]);
  if (window.solflare && window.solflare.isSolflare) L.push(['Solflare', window.solflare]);
  if (window.backpack && window.backpack.isBackpack) L.push(['Backpack', window.backpack]);
  if (!L.length && window.solana && window.solana.connect) L.push(['Wallet', window.solana]);
  return L;
}
export async function rpc(method, params) {
  let last;
  for (const u of RPCS) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json(); if (j && 'result' in j) return j.result; last = j && j.error;
    } catch (e) { last = e; }
  }
  throw new Error((last && last.message) || 'Solana RPC did not answer.');
}
async function refreshBal() {
  if (!WAL.pk) return;
  try { const r = await rpc('getBalance', [WAL.pk, { commitment: 'confirmed' }]); WAL.sol = r.value / 1e9; } catch (e) { WAL.sol = null; }
  emit();
}
// which mints does this wallet hold (non-zero)? used to mark "your keys" in the tower
async function refreshHeld() {
  if (!WAL.pk) return;
  const held = new Set();
  for (const prog of [TOKEN, TOKEN22]) {
    try {
      const r = await rpc('getTokenAccountsByOwner', [WAL.pk, { programId: prog }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      for (const a of (r && r.value) || []) {
        const inf = a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info;
        if (inf && inf.tokenAmount && +inf.tokenAmount.amount > 0) held.add(inf.mint);
      }
    } catch (e) { }
  }
  WAL.held = held; emit();
}
async function connectWith(name, p, note) {
  try {
    const r = await p.connect(); const pk = (r && r.publicKey) || p.publicKey;
    if (!pk) throw new Error('The wallet did not share an address.');
    WAL.pk = pk.toString(); WAL.prov = p; WAL.name = name; WAL.sol = null; WAL.held = new Set();
    emit(); refreshBal(); refreshHeld();
    try { p.on && p.on('accountChanged', k => { if (k) { WAL.pk = k.toString(); WAL.held = new Set(); emit(); refreshBal(); refreshHeld(); } else disconnect(); }); } catch (e) { }
    toast('Connected ' + short(WAL.pk));
  } catch (e) { const msg = e && e.code === 4001 ? 'Connection cancelled in the wallet.' : (e.message || 'Could not connect.'); if (note) note(msg, true); else toast(msg, 3500); }
}
export async function connect(pickBox, note) {
  const L = walletList();
  if (!L.length) {
    if (pickBox) { pickBox.hidden = false; pickBox.innerHTML = '<span class="note">No Solana wallet found in this browser.</span><a class="btn w sm" href="https://phantom.com/download" target="_blank" rel="noopener">GET PHANTOM</a><a class="btn w sm" href="https://solflare.com/download" target="_blank" rel="noopener">GET SOLFLARE</a>'; }
    else toast('No Solana wallet found in this browser.');
    return;
  }
  if (L.length === 1 || !pickBox) return connectWith(L[0][0], L[0][1], note);
  pickBox.hidden = false;
  pickBox.innerHTML = L.map((x, i) => `<button class="btn w sm" type="button" data-wi="${i}">${esc(x[0].toUpperCase())}</button>`).join('');
  pickBox.onclick = e => { const b = e.target.closest('[data-wi]'); if (b) { const x = L[+b.dataset.wi]; pickBox.hidden = true; connectWith(x[0], x[1], note); } };
}
export async function disconnect() {
  try { WAL.prov && WAL.prov.disconnect && await WAL.prov.disconnect(); } catch (e) { }
  WAL.pk = null; WAL.prov = null; WAL.name = ''; WAL.sol = null; WAL.held = new Set(); emit();
}
export { refreshHeld };

/* ------------------------------------------------------------------ launch */
const B64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
async function api(op, body) {
  const r = await fetch('/api/launch?op=' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (e) { }
  if (!r.ok) throw new Error(j.error || ('Launch service error ' + r.status));
  return j;
}
async function confirmSig(sig, ms = 75000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]); const st = r && r.value && r.value[0];
      if (st && st.err) throw new Error('The transaction failed on-chain.');
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return true;
    } catch (e) { if (/failed on-chain/.test(e.message)) throw e; }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Not confirmed yet. Check Solscan before trying again.');
}
async function sendRaw(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return rpc('sendTransaction', [btoa(s), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]);
}
export const STEPS = ['Upload image + metadata to IPFS', 'Build the launch transaction', 'Sign in your wallet', 'Send it to Solana', 'Confirmed on-chain'];
export async function launch(form, onStep, onSent) {
  let at = 0; onStep(at);
  const meta = await api('ipfs', { image: form.image, name: form.name, symbol: form.symbol, description: form.description, twitter: form.twitter, website: form.website });
  onStep(++at);
  const sw = await web3(); const mint = sw.Keypair.generate();
  const { tx } = await api('tx', { publicKey: WAL.pk, mint: mint.publicKey.toBase58(), name: meta.name, symbol: meta.symbol, uri: meta.uri, amount: form.amount });
  const vtx = sw.VersionedTransaction.deserialize(B64(tx));
  // sanity checks before the wallet sees it: you pay, and only you + the new mint sign
  const keys = vtx.message.staticAccountKeys.map(k => k.toBase58()); const nSig = vtx.message.header.numRequiredSignatures;
  if (keys[0] !== WAL.pk) throw new Error('The launch transaction has the wrong fee payer. Nothing was signed.');
  const signers = keys.slice(0, nSig);
  if (nSig !== 2 || !signers.includes(mint.publicKey.toBase58())) throw new Error('The launch transaction asks for unexpected signers. Nothing was signed.');
  onStep(++at);
  const signed = await WAL.prov.signTransaction(vtx); signed.sign([mint]);
  onStep(++at);
  const ca = mint.publicKey.toBase58();
  const sig = await sendRaw(signed.serialize());
  if (onSent) onSent({ ca, sig, name: meta.name, symbol: meta.symbol });
  onStep(++at);
  await confirmSig(sig);
  onStep(STEPS.length);
  refreshBal();
  return { ca, sig, name: meta.name, symbol: meta.symbol };
}
