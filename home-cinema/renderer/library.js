// ============================================================
// library.js
// Turns file names into titles, seasons and episodes, and groups them into movies and shows.
// ============================================================

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
