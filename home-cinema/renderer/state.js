// ============================================================
// state.js
// Library state (items, movies, shows, current page) and watch progress saved in localStorage.
// ============================================================

let items = [];
let movies = [];
let shows = [];
let folders = [];
let featured = null;
let view = 'home';
let query = '';

const prog = JSON.parse(
  localStorage.getItem('prog') || '{}'
);

const saveProg = () => {
  try {
    localStorage.setItem('prog', JSON.stringify(prog));
  } catch {}
};

const pct = it => {
  const p = prog[it.id];

  return p && p.d
    ? Math.min(100, p.t / p.d * 100)
    : 0;
};
