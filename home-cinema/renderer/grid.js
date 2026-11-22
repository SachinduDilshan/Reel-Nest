// ============================================================
// grid.js
// Sorting and filtering, and the grid page (Movies, TV Shows, search results) with its toolbar.
// ============================================================

/* ---------- sorting & filtering ---------- */

const sortPref = (() => {
  try {
    return Object.assign(
      { by: 'name', dir: 'asc', show: 'all' },
      JSON.parse(localStorage.getItem('sort') || '{}')
    );
  } catch {
    return { by: 'name', dir: 'asc', show: 'all' };
  }
})();

const saveSort = () => {
  try {
    localStorage.setItem('sort', JSON.stringify(sortPref));
  } catch {}
};

const SORTS = {
  name: 'Name',
  added: 'Date added',
  year: 'Release year',
  size: 'File size',
  watched: 'Last watched'
};

const FILTERS = {
  all: 'Everything',
  unwatched: 'Not started',
  progress: 'In progress',
  watched: 'Watched'
};

const dirLabel = () => {
  const asc = sortPref.dir === 'asc';

  if (sortPref.by === 'name') return asc ? 'A → Z' : 'Z → A';
  if (sortPref.by === 'size') return asc ? 'Smallest first' : 'Largest first';

  return asc ? 'Oldest first' : 'Newest first';
};

const epsOf = x => (x.kind === 'show' ? x.eps : [x]);

function sortValue(x, by) {
  if (by === 'name') return x.kind === 'show' ? x.name : x.title;
  if (by === 'added') return x.added;
  if (by === 'year') return x.kind === 'show' ? null : (+x.year || null);
  if (by === 'size') return epsOf(x).reduce((a, e) => a + e.size, 0);

  if (by === 'watched') {
    const t = Math.max(
      0,
      ...epsOf(x).map(e => (prog[e.id] && prog[e.id].u) || 0)
    );

    return t || null;
  }
}

function status(x) {
  const p = epsOf(x).map(pct);

  if (p.every(n => n > 95)) return 'watched';
  if (p.every(n => n <= 1)) return 'unwatched';

  return 'progress';
}

function applySort(list) {
  const { by, dir, show } = sortPref;
  const m = dir === 'asc' ? 1 : -1;

  const nameOf = x => (x.kind === 'show' ? x.name : x.title);

  const cmpName = (a, b) =>
    nameOf(a).localeCompare(nameOf(b), undefined, {
      numeric: true,
      sensitivity: 'base'
    });

  return list
    .filter(x => show === 'all' || status(x) === show)
    .sort((a, b) => {
      const A = sortValue(a, by);
      const B = sortValue(b, by);

      // Items with no value (e.g. never watched) always go last.
      if (A == null && B == null) return cmpName(a, b);
      if (A == null) return 1;
      if (B == null) return -1;

      const r = typeof A === 'string'
        ? A.localeCompare(B, undefined, { numeric: true, sensitivity: 'base' })
        : A - B;

      return r ? r * m : cmpName(a, b);
    });
}

function grid(title, list) {
  const opts = (o, cur) =>
    Object.entries(o)
      .map(([k, l]) =>
        `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`
      )
      .join('');

  const g = el(
    'section',
    'gridw top',
    `<div class="gh">
      <h2>${esc(title)}</h2>
      <div class="tools">
        <label>Sort by <select class="sb">${opts(SORTS, sortPref.by)}</select></label>
        <button class="sd" title="Reverse order"></button>
        <label>Show <select class="sf">${opts(FILTERS, sortPref.show)}</select></label>
      </div>
    </div>
    <div class="grid"></div>
    <p class="cs nomatch hidden">Nothing matches this filter.</p>`
  );

  const box = g.querySelector('.grid');
  const none = g.querySelector('.nomatch');
  const sb = g.querySelector('.sb');
  const sd = g.querySelector('.sd');
  const sf = g.querySelector('.sf');

  const fill = () => {
    const out = applySort(list);

    box.replaceChildren(...out.map(x => card(x)));
    none.classList.toggle('hidden', out.length > 0);
    sd.textContent = dirLabel();
  };

  sb.onchange = () => {
    sortPref.by = sb.value;

    // Sensible default order: names A→Z, everything else newest/largest first.
    sortPref.dir = sb.value === 'name' ? 'asc' : 'desc';

    saveSort();
    fill();
  };

  sd.onclick = () => {
    sortPref.dir = sortPref.dir === 'asc' ? 'desc' : 'asc';

    saveSort();
    fill();
  };

  sf.onchange = () => {
    sortPref.show = sf.value;

    saveSort();
    fill();
  };

  fill();

  return g;
}
