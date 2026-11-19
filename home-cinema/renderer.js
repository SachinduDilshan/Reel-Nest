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

const idb = new Promise(res => {
  const r = indexedDB.open('hc', 1);

  r.onupgradeneeded = () =>
    r.result.createObjectStore('t');

  r.onsuccess = () => res(r.result);
  r.onerror = () => res(null);
});

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

const grab = (it, w) => new Promise(res => {
  const v = document.createElement('video');

  v.muted = true;
  v.preload = 'auto';
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

      done({
        img: c.toDataURL('image/jpeg', 0.78),
        d: v.duration
      });

    } catch {
      done(null);
    }
  };

  v.src = it.url;
});

let chain = Promise.resolve();

const cache = new Map();

function thumb(it, w = 480) {
  const k = w + ':' + it.id;

  if (!cache.has(k)) {
    cache.set(k, (async () => {
      let r = await idbGet(k);

      if (!r) {
        chain = chain
          .then(() => grab(it, w))
          .catch(() => null);

        r = await chain;

        if (r) idbSet(k, r);
      }

      if (r) it.dur = r.d;

      return r;
    })());
  }

  return cache.get(k);
}

const io = new IntersectionObserver(es => {
  es.forEach(e => {
    if (!e.isIntersecting) return;

    io.unobserve(e.target);

    const { it, w } = e.target._d;

    thumb(it, w).then(r => {
      if (r) {
        e.target.src = r.img;
        e.target.classList.add('in');
      }
    });
  });
}, {
  rootMargin: '300px'
});

const lazy = (img, it, w = 480) => {
  img._d = { it, w };
  io.observe(img);
};

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

function grid(title, list) {
  const g = el(
    'section',
    'gridw top',
    `<h2>${esc(title)}</h2><div class="grid"></div>`
  );

  list.forEach(x =>
    g.querySelector('.grid').append(card(x))
  );

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

  thumb(it, 1280).then(r => {
    if (r) {
      const i = h.querySelector('img');
      i.src = r.img;
      i.classList.add('in');
    }
  });

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

  thumb(it, 1280).then(r => {
    if (r) {
      const i = md.querySelector('img');
      i.src = r.img;
      i.classList.add('in');
    }
  });

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

let cur = null;
let queue = [];
let ccIdx = -1;
let hideT;
let lastSave = 0;

const nextEp = () => {
  const i = queue.indexOf(cur);

  return i >= 0
    ? queue[i + 1]
    : null;
};

async function loadSubs(it) {
  $$('#v track').forEach(t => {
    URL.revokeObjectURL(t.src);
    t.remove();
  });

  ccIdx = -1;

  $('#cc').textContent = 'CC';
  $('#cc').classList.remove('on');

  $('#cc').style.display =
    it.subs.length ? '' : 'none';

  for (const p of it.subs) {
    let t = (
      await api.readText(p)
    )
      .replace(/^\uFEFF/, '')
      .replace(/\r/g, '');

    if (!t) continue;

    if (!/^WEBVTT/.test(t)) {
      t = 'WEBVTT\n\n' +
        t.replace(
          /(\d\d:\d\d:\d\d),(\d{3})/g,
          '$1.$2'
        );
    }

    const tr = document.createElement('track');

    tr.kind = 'subtitles';
    tr.label = p.split(/[\\/]/).pop();

    tr.src = URL.createObjectURL(
      new Blob([t], {
        type: 'text/vtt'
      })
    );

    v.append(tr);
  }

  setTimeout(() => {
    [...v.textTracks].forEach(t =>
      t.mode = 'disabled'
    );
  }, 50);
}

function cycleCC() {
  const ts = [...v.textTracks];

  if (!ts.length) return;

  ccIdx = ccIdx + 1 >= ts.length
    ? -1
    : ccIdx + 1;

  ts.forEach((t, i) => {
    t.mode = i === ccIdx
      ? 'showing'
      : 'disabled';
  });

  $('#cc').textContent =
    ccIdx < 0
      ? 'CC'
      : 'CC ' + (ccIdx + 1);

  $('#cc').classList.toggle(
    'on',
    ccIdx >= 0
  );
}

async function play(it, q = []) {
  cur = it;
  queue = q;

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
    if (!v.paused) {
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

  if (Date.now() - lastSave > 5000) {
    save();
  }
};

v.onplay = v.onpause = () => {
  $('#pp').textContent = v.paused ? '▶' : '⏸';
  showCtl();
};

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

v.onclick = toggle;
v.ondblclick = toggleFs;

P.onmousemove = showCtl;

$('#pp').onclick = toggle;
$('#b10').onclick = () => seekBy(-10);
$('#f10').onclick = () => seekBy(10);

$('#back').onclick = closePlayer;
$('#nxt').onclick = goNext;
$('#cc').onclick = cycleCC;
$('#fs').onclick = toggleFs;

$('#mute').onclick = () => {
  v.muted = !v.muted;
};

$('#vol').oninput = e => {
  v.volume = +e.target.value;
  v.muted = false;
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
  if (e.target.id === 'q') return;

  if (P.classList.contains('hidden')) {
    if (e.key === 'Escape') closeModal();
    return;
  }

  const k = e.key.toLowerCase();

  let used = true;

  if (k === ' ' || k === 'k') toggle();
  else if (k === 'arrowright') seekBy(5);
  else if (k === 'arrowleft') seekBy(-5);
  else if (k === 'l') seekBy(10);
  else if (k === 'j') seekBy(-10);

  else if (k === 'arrowup') {
    v.volume = Math.min(1, v.volume + 0.1);
    $('#vol').value = v.volume;
  }

  else if (k === 'arrowdown') {
    v.volume = Math.max(0, v.volume - 0.1);
    $('#vol').value = v.volume;
  }

  else if (k === 'f') toggleFs();
  else if (k === 'm') v.muted = !v.muted;
  else if (k === 'n') goNext();
  else if (k === 'c') cycleCC();

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
}

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