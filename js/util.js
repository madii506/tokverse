export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function trim0(s) { return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
export function money(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + trim0((v / 1e9).toFixed(a >= 1e10 ? 1 : 2)) + 'B';
  if (a >= 1e6) return '$' + trim0((v / 1e6).toFixed(a >= 1e7 ? 1 : 2)) + 'M';
  if (a >= 1e3) return '$' + trim0((v / 1e3).toFixed(a >= 1e4 ? 0 : 1)) + 'K';
  return '$' + Math.round(v);
}
export function pct(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + trim0(a.toFixed(a < 10 ? 1 : 0)) + '%';
}
export function ago(ms) {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
export const short = a => a ? String(a).slice(0, 4) + '…' + String(a).slice(-4) : '';
export function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const sleep = ms => new Promise(r => setTimeout(r, ms));
let tt = 0;
export function toast(msg, ms = 2200) {
  const t = $('#toast'); if (!t) return;
  t.onclick = null; t.style.pointerEvents = 'none'; t.style.cursor = '';
  t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), ms);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; }
  }
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
export const safeUrl = u => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');
export function xUrl(v) {
  v = String(v || '').trim(); if (!v) return '';
  if (/^https:\/\/(x|twitter)\.com\//i.test(v)) return v;
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(v)) return 'https://x.com/' + v.replace(/^@/, '');
  return safeUrl(v);
}
export function tgUrl(v) {
  v = String(v || '').trim(); if (!v) return '';
  if (/^https:\/\/t\.me\//i.test(v)) return v;
  if (/^@?[A-Za-z0-9_]{4,32}$/.test(v)) return 'https://t.me/' + v.replace(/^@/, '');
  return safeUrl(v);
}
