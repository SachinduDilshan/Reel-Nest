// ============================================================
// utils.js
// Small helpers used everywhere: DOM shortcuts, text escaping, time and size formatting.
// ============================================================

const $ = s => document.querySelector(s),
  $$ = s => [...document.querySelectorAll(s)];

const el = (t, c, h) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (h != null) e.innerHTML = h;
  return e;
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}[c]));

const pad = n => String(n).padStart(2, '0');

const fmtT = s => {
  s = Math.floor(s || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const x = s % 60;

  return h
    ? `${h}:${pad(m)}:${pad(x)}`
    : `${m}:${pad(x)}`;
};

const fmtD = s => {
  const m = Math.round(s / 60);

  return m >= 60
    ? `${Math.floor(m / 60)}h ${m % 60}m`
    : `${m}m`;
};

const fmtSize = b =>
  b > 1e9
    ? (b / 1e9).toFixed(1) + ' GB'
    : Math.round(b / 1e6) + ' MB';
