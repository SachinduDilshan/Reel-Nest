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

/* ---------- filename parsing ---------- */

const QUAL = /\b(480p|576p|720p|1080p|2160p|4k|uhd|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|hdrip|dvdrip|hdtv|x264|x265|h264|h265|hevc|aac|ac3|dts|10bit|yify|yts|rarbg)\b.*$/i;

const clean = s =>
  s
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(QUAL, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-(\[]+$/, '')
    .replace(/^[\s\-]+/, '')
    .trim();

function parse(it) {
  const n = it.file
    .replace(/\.[^.]+$/, '')
    .replace(/[._]+/g, ' ');

  const m =
    n.match(/\bS(\d{1,2})\s?E(\d{1,3})\b/i) ||
    n.match(/\b(\d{1,2})x(\d{2,3})\b/i);

  if (m) {
    it.kind = 'tv';
    it.season = +m[1];
    it.ep = +m[2];

    it.show = clean(n.slice(0, m.index)) || clean(it.folder);

    it.title =
      clean(n.slice(m.index + m[0].length)) ||
      `Episode ${it.ep}`;

  } else {
    const y = n.match(/\b((?:19|20)\d{2})\b/);

    it.kind = 'movie';
    it.year = y ? y[1] : '';

    it.title = clean(y ? n.slice(0, y.index) : n) || n;
  }

  return it;
}

/* ---------- library building ---------- */

function build(list) {
  items = list.map(parse);

  movies = items
    .filter(i => i.kind === 'movie')
    .sort((a, b) => a.title.localeCompare(b.title));

  const map = new Map();

  items
    .filter(i => i.kind === 'tv')
    .forEach(i => {
      const k = i.show.toLowerCase();

      if (!map.has(k)) {
        map.set(k, {
          kind: 'show',
          name: i.show,
          eps: []
        });
      }

      map.get(k).eps.push(i);
    });

  shows = [...map.values()]
    .map(s => {
      s.eps.sort((a, b) =>
        a.season - b.season || a.ep - b.ep
      );

      s.eps.forEach(e => e.ref = s);

      s.cover = s.eps[0];

      s.added = Math.max(
        ...s.eps.map(e => e.added)
      );

      return s;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const pool = [...movies, ...shows];

  featured = pool.length
    ? pool[Math.floor(Math.random() * pool.length)]
    : null;
}

/* ---------- thumbnails ---------- */

// Frames are captured from the videos themselves and cached offline in
// IndexedDB as small JPEG files (blobs). Only the thumbnails near the screen
// are kept in memory; the rest are released and reloaded from disk on demand.

const idb = new Promise(res => {
  const r = indexedDB.open('hc2', 1);

  r.onupgradeneeded = () =>
    r.result.createObjectStore('t');

  r.onsuccess = () => res(r.result);
  r.onerror = () => res(null);
});

// One-time removal of the old (much larger) base64 thumbnail cache.
try {
  if (!localStorage.getItem('hcCleaned')) {
    indexedDB.deleteDatabase('hc');
    localStorage.setItem('hcCleaned', '1');
  }
} catch {}

const idbGet = async k => {
  const d = await idb;

  if (!d) return;

  return new Promise(r => {
    const q = d.transaction('t').objectStore('t').get(k);

    q.onsuccess = () => r(q.result);
    q.onerror = () => r();
  });
};

const idbSet = async (k, v) => {
  const d = await idb;

  if (d) {
    d.transaction('t', 'readwrite')
      .objectStore('t')
      .put(v, k);
  }
};

// Deletes cached thumbnails of videos that are no longer in the library.
async function pruneThumbs(validIds) {
  const d = await idb;

  if (!d) return;

  const req = d.transaction('t', 'readwrite')
    .objectStore('t')
    .openCursor();

  req.onsuccess = () => {
    const c = req.result;

    if (!c) return;

    const key = String(c.key);
    const id = key.slice(key.indexOf(':') + 1);

    if (!validIds.has(id)) c.delete();

    c.continue();
  };
}

const grab = (it, w) => new Promise(res => {
  const v = document.createElement('video');

  v.muted = true;
  v.preload = 'metadata';
  v.crossOrigin = 'anonymous';

  const done = r => {
    clearTimeout(t);
    v.removeAttribute('src');
    v.load();
    res(r);
  };

  const t = setTimeout(() => done(null), 10000);

  v.onerror = () => done(null);

  v.onloadedmetadata = () => {
    v.currentTime = Math.min(v.duration * 0.15, 600) || 1;
  };

  v.onseeked = () => {
    try {
      const h = Math.round(w * 9 / 16);
      const c = document.createElement('canvas');

      c.width = w;
      c.height = h;

      const vr = v.videoWidth / v.videoHeight;
      const cr = w / h;

      let sw = v.videoWidth;
      let sh = v.videoHeight;
      let sx = 0;
      let sy = 0;

      if (vr > cr) {
        sw = sh * cr;
        sx = (v.videoWidth - sw) / 2;
      } else {
        sh = sw / cr;
        sy = (v.videoHeight - sh) / 2;
      }

      c.getContext('2d').drawImage(
        v,
        sx, sy,
        sw, sh,
        0, 0,
        w, h
      );

      const d = v.duration;

      c.toBlob(blob => {
        c.width = c.height = 0;          // free the canvas memory right away
        done(blob ? { blob, d } : null);
      }, 'image/jpeg', 0.72);

    } catch {
      done(null);
    }
  };

  v.src = it.url;
});

let chain = Promise.resolve();

const pending = new Map();     // thumbnails being prepared right now
const failed = new Set();      // files that can't give a frame (don't retry)

// Resolves to the JPEG blob of a thumbnail (creating and caching it if needed).
function thumbBlob(it, w = 480) {
  const k = w + ':' + it.id;

  if (failed.has(k)) return Promise.resolve(null);

  if (!pending.has(k)) {
    pending.set(k, (async () => {
      let r = await idbGet(k);

      if (!r || !r.blob) {
        // Capture one at a time so the app never decodes several videos at once.
        chain = chain
          .then(() => grab(it, w))
          .catch(() => null);

        r = await chain;

        if (r) idbSet(k, r);
        else failed.add(k);
      }

      if (r && r.d) it.dur = r.d;

      return r ? r.blob : null;
    })().finally(() => pending.delete(k)));
  }

  return pending.get(k);
}

const imgUrls = new WeakMap();

function setImg(img, blob) {
  clearImg(img);

  const url = URL.createObjectURL(blob);

  imgUrls.set(img, url);
  img.src = url;
  img.classList.add('in');
}

// Releases the picture (and its decoded pixels) held by an <img>.
function clearImg(img) {
  const url = imgUrls.get(img);

  if (!url) return;

  img.classList.remove('in');
  img.removeAttribute('src');

  URL.revokeObjectURL(url);
  imgUrls.delete(img);
}

// Hero / detail pictures: loaded once when shown.
function loadImg(img, it, w) {
  thumbBlob(it, w).then(blob => {
    if (blob && img.isConnected) setImg(img, blob);
  });
}

// Cards: load when near the screen, release when scrolled far away.
const io = new IntersectionObserver(es => {
  es.forEach(e => {
    const img = e.target;
    const d = img._d;

    if (!d) return;

    d.vis = e.isIntersecting;

    if (!d.vis) {
      clearImg(img);
      return;
    }

    if (imgUrls.has(img) || d.busy) return;

    d.busy = true;

    thumbBlob(d.it, d.w).then(blob => {
      d.busy = false;

      if (blob && d.vis && img.isConnected) setImg(img, blob);
    });
  });
}, {
  rootMargin: '400px'
});

const lazy = (img, it, w = 480) => {
  img._d = { it, w, vis: false, busy: false };
  io.observe(img);
};

// Call before removing a part of the page so its pictures are freed.
function releaseImgs(root) {
  root.querySelectorAll('img').forEach(img => {
    io.unobserve(img);
    clearImg(img);
  });
}

/* ---------- UI building blocks ---------- */

const epLabel = e =>
  `${e.show} · S${e.season} E${e.ep}`;

function card(x) {
  const it = x.kind === 'show' ? x.cover : x;

  const title =
    x.kind === 'show'
      ? x.name
      : x.kind === 'tv'
        ? epLabel(x)
        : x.title;

  const sub =
    x.kind === 'show'
      ? `${x.eps.length} episode${x.eps.length > 1 ? 's' : ''}`
      : x.kind === 'tv'
        ? x.title
        : (x.year || '');

  const c = el(
    'div',
    'card',
    `<div class="ph">
      <div class="fb">${esc(title)}</div>
      <img alt="">
      ${x.kind !== 'show' && pct(x) > 1
        ? `<i class="pb"><u style="width:${pct(x)}%"></u></i>`
        : ''}
    </div>
    <div class="ct">${esc(title)}</div>
    <div class="cs">${esc(sub)}</div>`
  );

  lazy(c.querySelector('img'), it);

  c.onclick = () =>
    x.kind === 'tv'
      ? play(x, x.ref.eps)
      : openDetail(x);

  return c;
}

function row(title, list) {
  if (!list.length) return null;

  const r = el(
    'section',
    'row',
    `<h2>${esc(title)}</h2>
    <div class="sw">
      <button class="ar l">‹</button>
      <div class="scr"></div>
      <button class="ar r">›</button>
    </div>`
  );

  const s = r.querySelector('.scr');

  list.forEach(x => s.append(card(x)));

  r.querySelector('.l').onclick = () =>
    s.scrollBy({ left: -s.clientWidth * 0.8 });

  r.querySelector('.r').onclick = () =>
    s.scrollBy({ left: s.clientWidth * 0.8 });

  return r;
}

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

function heroEl(x) {
  const it = x.kind === 'show' ? x.cover : x;

  const label =
    x.kind === 'show' ? x.name : x.title;

  const meta =
    x.kind === 'show'
      ? `TV series, ${x.eps.length} episodes`
      : (x.year ? `Movie, ${x.year}` : 'Movie');

  const h = el(
    'section',
    'hero',
    `<img alt="">
    <div class="hc">
      <h1>${esc(label)}</h1>
      <div class="meta">${esc(meta)}</div>
      <div class="btns">
        <button class="red big">
          ${hasProgress(x) ? 'Resume' : 'Play'}
        </button>
        <button class="big">More info</button>
      </div>
    </div>`
  );

  loadImg(h.querySelector('img'), it, 960);

  const [p, i] = h.querySelectorAll('button');

  p.onclick = () => playTarget(x);
  i.onclick = () => openDetail(x);

  return h;
}

const hasProgress = x =>
  (x.kind === 'show' ? x.eps : [x])
    .some(e => pct(e) > 1 && pct(e) < 95);

function playTarget(x) {
  if (x.kind !== 'show') {
    return play(x, []);
  }

  const last = x.eps
    .filter(e => prog[e.id])
    .sort((a, b) => prog[b.id].u - prog[a.id].u)[0];

  let t = x.eps[0];

  if (last) {
    t = pct(last) > 95
      ? (x.eps[x.eps.indexOf(last) + 1] || x.eps[0])
      : last;
  }

  play(t, x.eps);
}

/* ---------- pages ---------- */

function render() {
  const m = $('#main');

  releaseImgs(m);

  m.innerHTML = '';

  if (!items.length) {
    m.append(el(
      'div',
      'empty',
      `<h1>Your library is empty</h1>
      <p>Choose a folder that contains your movies and series.
      Subfolders are included, and .srt or .vtt subtitles with
      the same name are picked up automatically.</p>
      <button class="red big" id="add2">Add folder</button>`
    ));

    $('#add2').onclick = addFolder;

    return;
  }

  const q = query.trim().toLowerCase();

  if (q) {
    const res = [
      ...movies.filter(i =>
        i.title.toLowerCase().includes(q)
      ),
      ...shows.filter(s =>
        s.name.toLowerCase().includes(q)
      )
    ];

    m.append(
      res.length
        ? grid(`Results for “${query}”`, res)
        : el(
            'div',
            'empty',
            `<h1>No matches</h1>
            <p>Nothing in your library matches “${esc(query)}”.</p>`
          )
    );

    return;
  }

  if (view === 'movies') {
    return m.append(
      movies.length
        ? grid('Movies', movies)
        : el(
            'div',
            'empty',
            '<h1>No movies yet</h1><p>Files without an S01E01 style number are treated as movies.</p>'
          )
    );
  }

  if (view === 'tv') {
    return m.append(
      shows.length
        ? grid('TV Shows', shows)
        : el(
            'div',
            'empty',
            '<h1>No TV shows yet</h1><p>Name episodes like Show.Name.S01E03.mkv and they will be grouped by series.</p>'
          )
    );
  }

  m.append(heroEl(featured));

  const cont = items
    .filter(i => pct(i) > 1 && pct(i) < 95)
    .sort((a, b) => prog[b.id].u - prog[a.id].u)
    .slice(0, 15);

  const recent = [...movies, ...shows]
    .sort((a, b) => b.added - a.added)
    .slice(0, 20);

  [
    row('Continue watching', cont),
    row('Recently added', recent),
    row('Movies', movies),
    row('TV shows', shows)
  ].forEach(r => r && m.append(r));
}

/* ---------- detail modal ---------- */

function closeModal() {
  releaseImgs($('#modal'));

  $('#modal').classList.add('hidden');
  $('#modal').innerHTML = '';
}

function openDetail(x) {
  const it = x.kind === 'show' ? x.cover : x;
  const isShow = x.kind === 'show';

  const meta = isShow
    ? `${x.eps.length} episodes`
    : [x.year, fmtSize(x.size)].filter(Boolean).join(' · ');

  const md = $('#modal');

  md.classList.remove('hidden');

  md.innerHTML = `
    <div class="box">
      <button class="x">✕</button>
      <div class="mh">
        <img alt="">
        <div class="mt">
          <h1>${esc(isShow ? x.name : x.title)}</h1>
          <div class="meta">${esc(meta)}</div>
          <button class="red big">
            ${hasProgress(x) ? 'Resume' : 'Play'}
          </button>
        </div>
      </div>
      <div class="mb"></div>
    </div>`;

  loadImg(md.querySelector('img'), it, 960);

  md.onclick = e => {
    if (e.target === md) closeModal();
  };

  md.querySelector('.x').onclick = closeModal;

  md.querySelector('.red').onclick = () => {
    closeModal();
    playTarget(x);
  };

  const body = md.querySelector('.mb');

  if (!isShow) {
    body.innerHTML = `
      <div class="cs">
        ${esc(x.file)}
        ${x.subs.length
          ? ` · ${x.subs.length} subtitle file${x.subs.length > 1 ? 's' : ''}`
          : ''}
      </div>`;

    return;
  }

  const seasons = [
    ...new Set(x.eps.map(e => e.season))
  ];

  body.innerHTML = `
    <select>
      ${seasons.map(s =>
        `<option value="${s}">Season ${s}</option>`
      ).join('')}
    </select>
    <div class="eps"></div>`;

  const list = body.querySelector('.eps');

  const paint = s => {
    list.innerHTML = '';

    x.eps
      .filter(e => e.season === s)
      .forEach(e => {
        const r = el(
          'div',
          'ep',
          `<b>${e.ep}</b>
          <div class="ph"><img alt=""></div>
          <div class="ei">
            <div>${esc(e.title)}</div>
            <small>${e.dur ? fmtD(e.dur) : ''}</small>
            ${pct(e) > 1
              ? `<i class="pb"><u style="width:${pct(e)}%"></u></i>`
              : ''}
          </div>`
        );

        lazy(r.querySelector('img'), e, 320);

        r.onclick = () => {
          closeModal();
          play(e, x.eps);
        };

        list.append(r);
      });
  };

  body.querySelector('select').onchange = e =>
    paint(+e.target.value);

  paint(seasons[0]);
}

/* ---------- folders modal ---------- */

function foldersModal() {
  const md = $('#modal');

  md.classList.remove('hidden');

  md.innerHTML = `
    <div class="box sm">
      <button class="x">✕</button>
      <h2>Library folders</h2>

      ${folders.length
        ? folders.map((f, i) =>
            `<div class="fl">
              <span>${esc(f)}</span>
              <button data-i="${i}">Remove</button>
            </div>`
          ).join('')
        : '<p class="cs">No folders added yet.</p>'}

      <div style="margin-top:16px">
        <button class="red" id="add3">Add folder</button>
      </div>
    </div>`;

  md.onclick = e => {
    if (e.target === md) closeModal();
  };

  md.querySelector('.x').onclick = closeModal;

  md.querySelector('#add3').onclick = () => {
    closeModal();
    addFolder();
  };

  md.querySelectorAll('[data-i]').forEach(b => {
    b.onclick = async () => {
      await load(
        await api.removeFolder(folders[b.dataset.i])
      );

      foldersModal();
    };
  });
}

/* ---------- player ---------- */

const v = $('#v');
const P = $('#player');

// Optional external audio track (played in sync with the muted video).
const A = new Audio();
A.preload = 'auto';

let cur = null;
let queue = [];
let hideT;
let lastSave = 0;

let subList = [];     // [{ label, el }] loaded subtitle tracks
let ccIdx = -1;       // active subtitle index, -1 = off
let subDelay = 0;     // seconds
let ext = null;       // { name } while an external audio file is active
let audioDelay = 0;   // seconds (positive = audio plays later)
let audioStreams = [];   // audio tracks inside the video file (from ffmpeg)
let audioBusy = null;    // { n, id, pct } while a track is being prepared
let note = '';
let noteT;
let subsBusy = false;    // reading subtitles embedded in the video file
let subsInfo = '';       // short status text shown in the menu
let subTouched = false;  // user picked a subtitle manually (disables auto-select)

// Subtitle appearance (remembered between sessions).
const DEFAULT_STYLE = { size: 100, color: 'white', bg: 'box' };

const COLORS = {
  white: '#ffffff',
  yellow: '#ffe14d',
  cyan: '#7df3ff',
  green: '#8dff8d'
};

const subStyle = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('subStyle') || '{}');
    const legacy = parseInt(localStorage.getItem('subSize'), 10);
    const size = s.size || legacy;

    return {
      size: size >= 40 && size <= 250 ? size : DEFAULT_STYLE.size,
      color: COLORS[s.color] ? s.color : DEFAULT_STYLE.color,
      bg: ['box', 'shadow', 'none'].includes(s.bg) ? s.bg : DEFAULT_STYLE.bg
    };
  } catch {
    return { ...DEFAULT_STYLE };
  }
})();

const cueStyle = document.createElement('style');
document.head.append(cueStyle);

function cueLook() {
  return {
    color: COLORS[subStyle.color],
    background: subStyle.bg === 'box' ? 'rgba(0,0,0,.72)' : 'transparent',
    shadow: subStyle.bg === 'shadow'
      ? '0 0 3px #000, 0 0 6px #000, 1px 1px 2px #000, -1px -1px 2px #000'
      : 'none'
  };
}

function applySubStyle() {
  const c = cueLook();

  // vh keeps the text proportional in a window and in fullscreen.
  cueStyle.textContent =
    `#v::cue { font-size: ${(2.6 * subStyle.size / 100).toFixed(2)}vh; ` +
    `color: ${c.color}; background: ${c.background}; text-shadow: ${c.shadow}; }`;

  try {
    localStorage.setItem('subStyle', JSON.stringify(subStyle));
  } catch {}
}

const previewCss = () => {
  const c = cueLook();

  return `font-size:${(18 * subStyle.size / 100).toFixed(1)}px;` +
    `color:${c.color};background:${c.background};text-shadow:${c.shadow}`;
};

// Updates the live preview and size controls without rebuilding the menu.
function refreshStyleUi() {
  const p = $('#subprev');
  if (p) p.style.cssText = previewCss();

  const r = $('#szr');
  if (r) r.value = subStyle.size;

  const l = $('#szv');
  if (l) l.textContent = subStyle.size + '%';
}

function setSubSize(n) {
  subStyle.size = Math.max(40, Math.min(250, Math.round(n / 5) * 5));

  applySubStyle();
  refreshStyleUi();
}

const changeSubSize = d => setSubSize(subStyle.size + d);

applySubStyle();

const menuOpen = () => !$('#tmenu').classList.contains('hidden');
const closeMenu = () => $('#tmenu').classList.add('hidden');
const fmtOff = d => (d >= 0 ? '+' : '') + d.toFixed(1) + 's';
const updateBtn = () => {
  $('#cc').classList.toggle('on', ccIdx >= 0 || !!ext);
  $('#cc').textContent = subsBusy ? 'Loading subs…' : 'Subs & Audio';
};

const nextEp = () => {
  const i = queue.indexOf(cur);

  return i >= 0
    ? queue[i + 1]
    : null;
};

/* ----- subtitles ----- */

function toVtt(t) {
  t = t.replace(/^\uFEFF/, '').replace(/\r/g, '');

  if (!/^WEBVTT/.test(t)) {
    t = 'WEBVTT\n\n' +
      t.replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2');
  }

  return t;
}

/* ----- subtitle clean-up ----- */

// Fixes common subtitle problems before they are shown:
//  - the same line repeated (duplicate layers / "growing" lines)
//  - lines split into separate overlapping cues, which the player stacks
//    with big gaps between them
//  - blank lines and stray spaces inside a cue
const vttTime = sec => {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms % 3600000 / 60000);
  const s = Math.floor(ms % 60000 / 1000);

  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(ms % 1000).padStart(3, '0')}`;
};

const parseTs = str => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(str);

  return m
    ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000
    : NaN;
};

const cleanLines = t =>
  t
    .replace(/\{\\[^}]*\}/g, '')          // leftover ASS style codes
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .split('\n')
    .map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean);

// Joins the lines of cues that are on screen at the same time.
function mergeLines(list) {
  const texts = list.map(c => c.lines.join('\n'));
  const lines = [];

  list.forEach((c, i) => {
    // Skip a cue that repeats another one, or is the start of a longer one.
    const dup = texts.some((o, j) =>
      j !== i && (o === texts[i] ? j < i : o.startsWith(texts[i]))
    );

    if (dup) return;
    if (c.lines.every(l => lines.includes(l))) return;

    lines.push(...c.lines);
  });

  return lines.join('\n');
}

function cleanVtt(src) {
  const blocks = src
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);

  const keep = [];     // STYLE / REGION blocks stay as they are
  const cues = [];
  let last = null;

  blocks.forEach(block => {
    const lines = block.split('\n');
    const ti = lines.findIndex(l => l.includes('-->'));

    if (ti >= 0) {
      const m = /^\s*(\S+)\s*-->\s*(\S+)(.*)$/.exec(lines[ti]);
      const s = m ? parseTs(m[1]) : NaN;
      const e = m ? parseTs(m[2]) : NaN;

      if (isNaN(s) || isNaN(e)) {
        last = null;
        return;
      }

      last = {
        s,
        e,
        settings: m[3].trim(),
        lines: cleanLines(lines.slice(ti + 1).join('\n')),
        idx: cues.length
      };

      cues.push(last);
    }

    else if (/^(STYLE|REGION)\b/.test(block)) {
      keep.push(block.trim());
      last = null;
    }

    else if (/^(WEBVTT|NOTE)\b/.test(block)) {
      last = null;
    }

    // Text after a blank line inside a cue (some converters write that).
    else if (last) {
      last.lines.push(...cleanLines(block));
    }
  });

  const valid = cues.filter(c => c.lines.length && c.e > c.s);
  const plain = valid.filter(c => !c.settings);
  const special = valid.filter(c => c.settings);   // positioned cues: untouched

  const times = [...new Set(plain.flatMap(c => [c.s, c.e]))].sort((a, b) => a - b);
  const order = [...plain].sort((a, b) => a.s - b.s || a.idx - b.idx);

  const out = [];
  let next = 0;
  let active = [];

  for (let i = 0; i < times.length - 1; i++) {
    const t = times[i];
    const u = times[i + 1];

    while (next < order.length && order[next].s <= t) active.push(order[next++]);

    active = active.filter(c => c.e > t);

    if (!active.length || u - t < 0.06) continue;

    const text = mergeLines([...active].sort((a, b) => a.idx - b.idx));
    const prev = out[out.length - 1];

    if (prev && prev.text === text && Math.abs(prev.e - t) < 0.001) prev.e = u;
    else out.push({ s: t, e: u, text, settings: '' });
  }

  const all = [
    ...out,
    ...special.map(c => ({ s: c.s, e: c.e, text: c.lines.join('\n'), settings: c.settings }))
  ].sort((a, b) => a.s - b.s);

  return (
    'WEBVTT\n\n' +
    (keep.length ? keep.join('\n\n') + '\n\n' : '') +
    all
      .map(c => `${vttTime(c.s)} --> ${vttTime(c.e)}${c.settings ? ' ' + c.settings : ''}\n${c.text}`)
      .join('\n\n') +
    '\n'
  );
}

function addSub(rawLabel, text) {
  const embedded = / \(embedded\)$/.test(rawLabel);
  const label = rawLabel.replace(/ \(embedded\)$/, '');

  const tr = document.createElement('track');

  tr.kind = 'subtitles';
  tr.label = label;

  // The text is cleaned and attached only when this track is first selected,
  // so loading a video with many languages stays instant.

  // Cues only exist once the track has loaded, so re-apply the delay then.
  tr.addEventListener('load', () => applyDelay(tr.track));

  v.append(tr);
  tr.track.mode = 'disabled';

  subList.push({ label, src: embedded ? 'Embedded' : 'File', el: tr, raw: text });

  return subList.length - 1;
}

function applyDelay(track) {
  if (!track || !track.cues) return;

  const d = subDelay - (track._shift || 0);

  if (!d) return;

  for (const c of track.cues) {
    c.startTime += d;
    c.endTime += d;
  }

  track._shift = subDelay;
}

function selectSub(idx, auto = false) {
  if (!auto) {
    subTouched = true;

    // Remember the language so the next video starts with it.
    try {
      localStorage.setItem(
        'subPref',
        idx < 0 ? 'off' : baseLang(subList[idx].label)
      );
    } catch {}
  }

  ccIdx = idx;

  if (idx >= 0) prepareSub(subList[idx]);

  subList.forEach((s, i) => {
    s.el.track.mode = i === idx ? 'showing' : 'disabled';
  });

  if (idx >= 0) applyDelay(subList[idx].el.track);

  updateBtn();
  if (menuOpen()) renderMenu();
}

// Prepares a subtitle track the first time it is needed.
function prepareSub(s) {
  if (s.raw == null) return;

  s.el.src = URL.createObjectURL(
    new Blob([cleanVtt(toVtt(s.raw))], { type: 'text/vtt' })
  );

  s.raw = null;
}

function cycleCC() {
  if (!subList.length) {
    flash('No subtitles loaded. Use “Load subtitle file…” below.', 'subs');
    return;
  }

  selectSub(ccIdx + 1 >= subList.length ? -1 : ccIdx + 1);
}

async function loadSubs(it) {
  for (const p of it.subs) {
    const text = await api.readText(p);

    if (cur !== it) return;      // user switched videos meanwhile
    if (!text) continue;

    addSub(p.split(/[\\/]/).pop(), text);
  }

  if (menuOpen()) renderMenu();
}

// Subtitles stored inside the video file (e.g. MKV). The browser can't show
// these, so the main process extracts them with ffmpeg and caches the result.
async function loadEmbedded(it) {
  subsBusy = true;
  subsInfo = '';
  updateBtn();
  if (menuOpen()) renderMenu();

  let r;

  try {
    r = await api.embeddedSubs(it.id);
  } catch {
    r = { tracks: [], skipped: 0 };
  }

  if (cur !== it) return;

  subsBusy = false;

  const first = subList.length;

  r.tracks.forEach(t => addSub(t.label, t.text));

  if (r.missing) {
    subsInfo = 'Embedded subtitles need ffmpeg. Run “npm install ffmpeg-static” in the project folder and restart.';
  } else if (r.skipped) {
    subsInfo = `${r.skipped} image-based subtitle track${r.skipped > 1 ? 's' : ''} (PGS/DVD) in this file can’t be shown.`;
  } else if (!subList.length) {
    subsInfo = 'No subtitles found in this file.';
  }

  // Pick a track automatically: the language used last time, otherwise the
  // file's default track (like most players do).
  if (!subTouched && ccIdx < 0 && r.tracks.length) {
    const pref = localStorage.getItem('subPref');
    let pick = -1;

    if (pref !== 'off') {
      if (pref) {
        const same = r.tracks
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => baseLang(t.label) === pref);

        const best =
          same.find(({ t }) => !/sign|forced|song/i.test(t.label)) || same[0];

        if (best) pick = best.i;
      }

      if (pick < 0) {
        const d = r.tracks.findIndex(t => t.def);
        pick = d >= 0 ? d : (r.tracks.length === 1 ? 0 : -1);
      }
    }

    if (pick >= 0) selectSub(first + pick, true);
  }

  updateBtn();
  if (menuOpen()) renderMenu();
}

async function pickSub() {
  const r = await api.pickSubtitle();

  if (!r || !r.text) return;

  selectSub(addSub(r.name, r.text));
}

/* ----- audio ----- */

const syncA = () => {
  A.currentTime = Math.max(0, v.currentTime - audioDelay);
};

function clearExt() {
  if (!ext && !A.getAttribute('src')) return;

  ext = null;
  audioDelay = 0;

  A.pause();
  A.removeAttribute('src');
  A.load();
  A.muted = false;

  v.muted = false;

  updateBtn();
}

// Plays an extra audio file next to the (muted) video.
function startExt(name, url, stream = null) {
  ext = { name, stream };

  A.src = url;
  A.volume = v.volume;
  A.playbackRate = v.playbackRate;
  A.muted = false;

  A.onloadedmetadata = () => {
    syncA();
    if (!v.paused) A.play().catch(() => {});
  };

  v.muted = true;   // silence the original audio

  updateBtn();
  renderMenu();
}

async function pickAudio() {
  const r = await api.pickAudio();

  if (!r) return;

  startExt(r.name, r.url);
}

A.onerror = () => {
  if (!ext) return;

  clearExt();

  flash('That audio can’t be played. For your own files, try MP3, AAC, M4A, OGG, FLAC or WAV.', 'audio');
};

// Which track the video plays by itself (we never change this one).
function nativeAudio() {
  const at = v.audioTracks ? [...v.audioTracks] : [];
  const on = at.findIndex(t => t.enabled);

  if (on >= 0 && on < audioStreams.length) return on;

  const d = audioStreams.findIndex(s => s.def);

  return d >= 0 ? d : 0;
}

async function loadAudioList(it) {
  let r;

  try {
    r = await api.audioList(it.id);
  } catch {
    r = { streams: [] };
  }

  if (cur !== it) return;

  audioStreams = r.streams || [];

  if (menuOpen()) renderMenu();
}

// Switching language: the chosen track is prepared as its own audio file and
// played next to the video. The video's own audio is never switched, because
// switching it inside the player can freeze playback.
async function selectAudioStream(n) {
  const it = cur;

  if (!it || audioBusy) return;

  // The track the video plays by itself: just un-mute it.
  if (n === nativeAudio()) {
    clearExt();
    renderMenu();
    return;
  }

  if (ext && ext.stream === n) return;

  const job = { n, id: it.id, pct: 0 };

  audioBusy = job;
  renderMenu();

  let r;

  try {
    r = await api.extractAudio(it.id, n);
  } catch {
    r = { error: 'failed' };
  }

  // The video changed or was closed meanwhile: forget this result.
  if (audioBusy !== job) return;

  audioBusy = null;

  if (cur !== it) return;

  if (!r.url) {
    if (r.error !== 'cancelled') {
      flash(
        r.error === 'missing'
          ? 'Switching audio needs ffmpeg. Run “npm install ffmpeg-static” in the project folder and restart.'
          : 'Could not prepare that audio track.',
        'audio'
      );
    } else {
      renderMenu();
    }

    return;
  }

  const s = audioStreams[n];

  startExt(s ? s.label : `Track ${n + 1}`, r.url, n);
}

api.onAudioProgress(p => {
  if (!audioBusy || p.n !== audioBusy.n) return;

  audioBusy.pct = p.pct;

  const tag = document.querySelector(`#tmenu [data-a="a:${p.n}"] .tag`);

  if (tag) tag.textContent = `Preparing… ${p.pct}%`;
});

const setVol = x => {
  v.volume = x;
  A.volume = x;
  $('#vol').value = x;
};

const toggleMute = () => {
  if (ext) A.muted = !A.muted;
  else v.muted = !v.muted;
};

/* ----- subtitles & audio panel ----- */

let menuTab = 'subs';     // 'subs' | 'audio' | 'style'
let subQuery = '';

function openMenu(tab) {
  if (tab) menuTab = tab;

  subQuery = '';

  $('#tmenu').classList.remove('hidden');
  renderMenu({ reveal: true });
}

function flash(text, tab) {
  note = text;

  if (!menuOpen()) openMenu(tab);
  else renderMenu();

  clearTimeout(noteT);

  noteT = setTimeout(() => {
    note = '';
    if (menuOpen()) renderMenu();
  }, 5000);

  showCtl();
}

const baseLang = label =>
  label
    .replace(/\s*\((embedded|forced)\)/g, '')
    .split(' – ')[0]
    .trim()
    .toLowerCase();

const mrow = (act, label, on, tag) =>
  `<button class="mi${on ? ' on' : ''}" data-a="${act}" role="menuitemradio" aria-checked="${on}">
    <i class="dot"></i>
    <span class="mn">${esc(label)}</span>
    ${tag ? `<em class="tag">${tag}</em>` : ''}
  </button>`;

const stepper = (kind, val) => `
  <div class="step">
    <button data-a="${kind}:-0.5">−0.5</button>
    <button data-a="${kind}:-0.1">−0.1</button>
    <b>${fmtOff(val)}</b>
    <button data-a="${kind}:0.1">+0.1</button>
    <button data-a="${kind}:0.5">+0.5</button>
    <button class="rst" data-a="${kind}:reset">Reset</button>
  </div>`;

function subsListHtml() {
  const q = subQuery.trim().toLowerCase();

  const rows = subList
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !q || s.label.toLowerCase().includes(q))
    .sort((a, b) =>
      (a.s.src === b.s.src ? 0 : a.s.src === 'File' ? -1 : 1) ||
      a.s.label.localeCompare(b.s.label)
    )
    .map(({ s, i }) => mrow('s:' + i, s.label, ccIdx === i, s.src))
    .join('');

  if (rows) return rows;

  return `<p class="mempty">${
    subsBusy
      ? 'Reading subtitles from the video…'
      : q
        ? `No language matches “${esc(subQuery)}”.`
        : esc(subsInfo || 'No subtitles found for this video.')
  }</p>`;
}

function subsBody() {
  const status = subList.length
    ? (subsBusy ? 'Reading more subtitles from the video…' : subsInfo)
    : '';

  return `
    ${mrow('s:-1', 'Off', ccIdx < 0, '')}
    ${subList.length > 6
      ? `<div class="msearch"><input id="subq" type="search" placeholder="Search language…" value="${esc(subQuery)}" autocomplete="off" spellcheck="false"></div>`
      : ''}
    <div class="mlist">${subsListHtml()}</div>
    <div class="mfoot">
      ${status ? `<p class="mstat">${esc(status)}</p>` : ''}
      <button class="mbtn" data-a="s:add">Load subtitle file…</button>
    </div>`;
}

function audioBody() {
  const nat = nativeAudio();

  const rows = audioStreams.length > 1
    ? audioStreams.map(st => {
        const active = ext ? ext.stream === st.n : st.n === nat;
        const busy = audioBusy && audioBusy.n === st.n;

        const tag = busy
          ? `Preparing… ${audioBusy.pct}%`
          : esc(st.channels || '');

        return mrow('a:' + st.n, st.label, active, tag);
      }).join('')
    : mrow('a:orig', 'Original audio', !ext, '');

  return `
    <div class="mlist">
      ${rows}
      ${ext && ext.stream == null ? mrow('a:ext', ext.name, true, 'File') : ''}
    </div>
    ${ext
      ? `<div class="field"><label>Audio delay</label>${stepper('ad', audioDelay)}</div>`
      : ''}
    <div class="mfoot">
      ${audioBusy
        ? '<p class="mstat">Preparing this track (first time only). The video keeps playing meanwhile.</p>'
        : ''}
      <button class="mbtn" data-a="a:add">Load audio file…</button>
    </div>`;
}

function styleBody() {
  const swatches = Object.entries(COLORS).map(([k, hex]) =>
    `<button class="cswatch${subStyle.color === k ? ' on' : ''}" data-a="col:${k}" style="--c:${hex}" aria-label="${k}" title="${k[0].toUpperCase() + k.slice(1)}"></button>`
  ).join('');

  const seg = [['box', 'Box'], ['shadow', 'Shadow'], ['none', 'None']].map(([k, l]) =>
    `<button class="${subStyle.bg === k ? 'on' : ''}" data-a="bg:${k}">${l}</button>`
  ).join('');

  return `
    <div class="mscroll">
      <div class="prev"><span id="subprev" style="${previewCss()}">This is how your subtitles look</span></div>

      <div class="field">
        <label>Size</label>
        <div class="sizerow">
          <button data-a="sz:-10" aria-label="Smaller">−</button>
          <input id="szr" type="range" min="40" max="250" step="5" value="${subStyle.size}">
          <button data-a="sz:10" aria-label="Larger">+</button>
          <b id="szv">${subStyle.size}%</b>
        </div>
      </div>

      <div class="field"><label>Colour</label><div class="swatches">${swatches}</div></div>
      <div class="field"><label>Background</label><div class="seg">${seg}</div></div>
      <div class="field"><label>Subtitle delay</label>${stepper('sd', subDelay)}</div>
    </div>
    <div class="mfoot">
      <p class="mstat">Tip: press [ or ] in the player to change the size.</p>
      <button class="mbtn ghost" data-a="st:reset">Reset appearance</button>
    </div>`;
}

function renderMenu(opts = {}) {
  const m = $('#tmenu');
  const old = m.querySelector('.mlist');
  const keep = old ? old.scrollTop : 0;

  const tab = (id, label, badge) =>
    `<button class="mtab${menuTab === id ? ' on' : ''}" role="tab" aria-selected="${menuTab === id}" data-a="tab:${id}">${label}${badge ? `<small>${badge}</small>` : ''}</button>`;

  const body =
    menuTab === 'audio' ? audioBody()
    : menuTab === 'style' ? styleBody()
    : subsBody();

  m.innerHTML = `
    <div class="mhead">
      <div class="mtabs" role="tablist">
        ${tab('subs', 'Subtitles', subList.length || '')}
        ${tab('audio', 'Audio', '')}
        ${tab('style', 'Style', '')}
      </div>
      <button class="mclose" data-a="close" aria-label="Close">✕</button>
    </div>
    <div class="mbody">${body}</div>
    ${note ? `<p class="tnote">${esc(note)}</p>` : ''}`;

  const list = m.querySelector('.mlist');

  if (list) {
    const on = list.querySelector('.on');

    if (opts.reveal && on) {
      list.scrollTop = on.offsetTop - list.clientHeight / 2 + on.offsetHeight / 2;
    } else {
      list.scrollTop = keep;
    }
  }
}

$('#tmenu').addEventListener('input', e => {
  if (e.target.id === 'subq') {
    subQuery = e.target.value;
    $('#tmenu .mlist').innerHTML = subsListHtml();
  } else if (e.target.id === 'szr') {
    setSubSize(+e.target.value);
  }
});

$('#tmenu').onclick = e => {
  const b = e.target.closest('[data-a]');

  if (!b) return;

  const [k, val] = b.dataset.a.split(':');

  const step = (current, d) =>
    d === 'reset' ? 0 : Math.round((current + +d) * 10) / 10;

  if (k === 'tab') {
    menuTab = val;
    renderMenu({ reveal: true });
  }

  else if (k === 'close') {
    closeMenu();
  }

  else if (k === 's') {
    if (val === 'add') pickSub();
    else selectSub(+val);
  }

  else if (k === 'sz') {
    setSubSize(subStyle.size + +val);
  }

  else if (k === 'col') {
    subStyle.color = val;
    applySubStyle();
    renderMenu();
  }

  else if (k === 'bg') {
    subStyle.bg = val;
    applySubStyle();
    renderMenu();
  }

  else if (k === 'st') {
    Object.assign(subStyle, DEFAULT_STYLE);
    applySubStyle();
    renderMenu();
  }

  else if (k === 'sd') {
    subDelay = step(subDelay, val);
    subList.forEach(s => applyDelay(s.el.track));
    renderMenu();
  }

  else if (k === 'a') {
    if (val === 'add') pickAudio();
    else if (val === 'orig') { clearExt(); renderMenu(); }
    else if (val !== 'ext') selectAudioStream(+val);
  }

  else if (k === 'ad') {
    audioDelay = step(audioDelay, val);
    syncA();
    renderMenu();
  }

  showCtl();
};

$('#cc').onclick = () => {
  if (menuOpen()) closeMenu();
  else openMenu();

  showCtl();
};

function resetTracks() {
  // Hide the old cues first. Removing a track that is still "showing" can
  // leave its last subtitle line stuck on the screen (even on the next movie).
  [...v.textTracks].forEach(t => {
    t.mode = 'disabled';
  });

  $$('#v track').forEach(t => {
    URL.revokeObjectURL(t.src);
    t.remove();
  });

  // Make the player redraw its subtitle area so nothing old stays visible.
  const nudge = document.createElement('track');

  nudge.kind = 'subtitles';
  nudge.src = URL.createObjectURL(new Blob(['WEBVTT\n\n'], { type: 'text/vtt' }));

  v.append(nudge);
  nudge.track.mode = 'showing';

  setTimeout(() => {
    nudge.track.mode = 'disabled';
    URL.revokeObjectURL(nudge.src);
    nudge.remove();
  }, 60);

  // Stop preparing an audio track for the previous video.
  if (audioBusy) api.cancelAudio(audioBusy.id, audioBusy.n);

  audioBusy = null;
  audioStreams = [];

  subList = [];
  ccIdx = -1;
  subDelay = 0;
  note = '';
  subsBusy = false;
  subsInfo = '';
  subTouched = false;

  clearExt();
  closeMenu();
  updateBtn();
}

/* ----- playback ----- */

async function play(it, q = []) {
  cur = it;
  queue = q;

  resetTracks();

  P.classList.remove('hidden');
  $('#perr').classList.add('hidden');

  $('#ptitle').textContent =
    it.kind === 'tv'
      ? `${epLabel(it)}  ${it.title}`
      : it.title + (it.year ? ` (${it.year})` : '');

  $('#nxt').style.display =
    nextEp() ? '' : 'none';

  const p = prog[it.id];

  v.src = it.url;

  v.onloadedmetadata = () => {
    if (p && p.t > 30 && p.t < v.duration * 0.95) {
      v.currentTime = p.t;
    }
  };

  v.play().catch(() => {});

  showCtl();

  loadSubs(it);
  loadEmbedded(it);
  loadAudioList(it);
}

function save() {
  if (!cur || !v.duration) return;

  lastSave = Date.now();

  prog[cur.id] = {
    t: v.currentTime,
    d: v.duration,
    u: Date.now()
  };

  saveProg();
}

function closePlayer() {
  save();

  v.pause();
  v.removeAttribute('src');
  v.load();

  resetTracks();

  if (document.fullscreenElement) {
    document.exitFullscreen();
  }

  P.classList.add('hidden');

  cur = null;

  render();
}

function showCtl() {
  P.classList.add('ui');

  clearTimeout(hideT);

  hideT = setTimeout(() => {
    if (!v.paused && !menuOpen()) {
      P.classList.remove('ui');
    }
  }, 3000);
}

const toggle = () =>
  v.paused ? v.play() : v.pause();

const seekBy = s => {
  v.currentTime = Math.max(
    0,
    Math.min(
      v.duration || 0,
      v.currentTime + s
    )
  );
};

const goNext = () => {
  const n = nextEp();

  if (n) {
    save();
    play(n, queue);
  }
};

const toggleFs = () =>
  document.fullscreenElement
    ? document.exitFullscreen()
    : P.requestFullscreen();

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

v.ontimeupdate = () => {
  $('#fill').style.width =
    (v.currentTime / v.duration * 100 || 0) + '%';

  $('#time').textContent =
    `${fmtT(v.currentTime)} / ${fmtT(v.duration)}`;

  // Keep external audio locked to the video.
  if (ext && !A.paused &&
      Math.abs(A.currentTime - (v.currentTime - audioDelay)) > 0.35) {
    syncA();
  }

  if (Date.now() - lastSave > 5000) {
    save();
  }
};

v.onplay = v.onpause = () => {
  $('#pp').textContent = v.paused ? '▶' : '⏸';
  showCtl();
};

// External audio follows the video.
v.addEventListener('play', () => { if (ext) A.play().catch(() => {}); });
v.addEventListener('pause', () => A.pause());
v.addEventListener('waiting', () => A.pause());
v.addEventListener('playing', () => {
  if (ext) {
    syncA();
    A.play().catch(() => {});
  }
});
v.addEventListener('seeked', () => { if (ext) syncA(); });
v.addEventListener('ratechange', () => { A.playbackRate = v.playbackRate; });

v.onended = () => {
  save();

  nextEp()
    ? goNext()
    : closePlayer();
};

v.onerror = () => {
  const e = $('#perr');

  e.classList.remove('hidden');

  e.innerHTML = `
    <b>This file can’t be played</b>
    <p class="cs" style="margin-top:6px">
      Its video or audio format (for example HEVC/H.265,
      DTS or AC3) isn’t supported by the built-in player.
      Re-encoding it to H.264 + AAC (MP4) will fix it.
    </p>`;
};

v.onclick = () => {
  if (menuOpen()) closeMenu();
  else toggle();
};

v.ondblclick = toggleFs;

P.onmousemove = showCtl;

$('#pp').onclick = toggle;
$('#b10').onclick = () => seekBy(-10);
$('#f10').onclick = () => seekBy(10);

$('#back').onclick = closePlayer;
$('#nxt').onclick = goNext;
$('#fs').onclick = toggleFs;

$('#mute').onclick = toggleMute;

$('#vol').oninput = e => {
  setVol(+e.target.value);

  // The original audio stays muted while an external audio file is active.
  if (ext) A.muted = false;
  else v.muted = false;
};

$('#spd').onclick = () => {
  const i =
    (SPEEDS.indexOf(v.playbackRate) + 1) %
    SPEEDS.length;

  v.playbackRate = SPEEDS[i];

  $('#spd').textContent =
    SPEEDS[i] + '×';
};

$('#seek').onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();

  v.currentTime =
    (e.clientX - r.left) / r.width * v.duration;
};

document.addEventListener('keydown', e => {
  // Typing in a search box, or moving a slider, must not trigger shortcuts.
  if (e.target.matches && e.target.matches('#q, #subq')) {
    if (e.key === 'Escape' && e.target.id === 'subq') {
      e.target.blur();
      closeMenu();
    }

    return;
  }

  if (e.target.type === 'range' && e.key.startsWith('Arrow')) return;


  if (P.classList.contains('hidden')) {
    if (e.key === 'Escape') closeModal();
    return;
  }

  const k = e.key.toLowerCase();

  if (k === 'escape' && menuOpen()) {
    closeMenu();
    e.preventDefault();
    return;
  }

  let used = true;

  if (k === ' ' || k === 'k') toggle();
  else if (k === 'arrowright') seekBy(5);
  else if (k === 'arrowleft') seekBy(-5);
  else if (k === 'l') seekBy(10);
  else if (k === 'j') seekBy(-10);

  else if (k === 'arrowup') setVol(Math.min(1, v.volume + 0.1));
  else if (k === 'arrowdown') setVol(Math.max(0, v.volume - 0.1));

  else if (k === 'f') toggleFs();
  else if (k === 'm') toggleMute();
  else if (k === 'n') goNext();
  else if (k === 'c') cycleCC();
  else if (k === '[') changeSubSize(-10);
  else if (k === ']') changeSubSize(10);

  else if (k === 'escape') {
    if (!document.fullscreenElement) closePlayer();
  }

  else used = false;

  if (used) {
    e.preventDefault();
    showCtl();
  }
});

/* ---------- boot ---------- */

async function load(r) {
  if (!r) return;

  folders = r.folders;
  build(r.items);
  render();

  // Once per session: drop cached thumbnails of videos that no longer exist.
  if (!pruned && items.length) {
    pruned = true;

    const ids = new Set(items.map(i => i.id));

    setTimeout(() => pruneThumbs(ids), 10000);
  }
}

let pruned = false;

async function addFolder() {
  const r = await api.addFolder();

  if (r) {
    $('#main').innerHTML = `
      <div class="empty">
        <p>Scanning your library…</p>
      </div>`;

    await load(r);
  }
}

// Navigation.
$$('#nav nav a').forEach(a => {
  a.onclick = () => {
    view = a.dataset.v;
    query = '';

    $('#q').value = '';

    $$('#nav nav a').forEach(x =>
      x.classList.toggle('on', x === a)
    );

    render();
    scrollTo(0, 0);
  };
});

// Search.
let qt;

$('#q').oninput = e => {
  clearTimeout(qt);

  qt = setTimeout(() => {
    query = e.target.value;
    render();
  }, 200);
};

// Buttons.
$('#add').onclick = addFolder;
$('#folders').onclick = foldersModal;

// Navigation background on scroll.
addEventListener('scroll', () => {
  $('#nav').classList.toggle('solid', scrollY > 40);
});

// Initial library load.
$('#main').innerHTML = `
  <div class="empty">
    <p>Scanning your library…</p>
  </div>`;

api.getLibrary().then(load);


/* ---------------------------------
   AUTOMATIC LIBRARY REFRESH
---------------------------------- */

api.onLibraryUpdated(library => {
  if (!library) return;

  // Remember the previous featured item.
  const previousFeatured = featured;

  // Update folder list.
  folders = library.folders;

  // Rebuild movies and TV shows.
  build(library.items);

  // Keep the previous featured item when it still exists.
  if (previousFeatured) {
    const previousId =
      previousFeatured.kind === 'show'
        ? null
        : previousFeatured.id;

    const previousName =
      previousFeatured.kind === 'show'
        ? previousFeatured.name
        : null;

    const matchingItem = previousId
      ? movies.find(m => m.id === previousId)
      : shows.find(s =>
          s.name.toLowerCase() ===
          previousName.toLowerCase()
        );

    if (matchingItem) {
      featured = matchingItem;
    }
  }

  // Re-render the current page.
  // Current view and search query are preserved.
  render();

  console.log('Library automatically refreshed.');
});