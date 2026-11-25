// ============================================================
// cards.js
// Building blocks of the library pages: movie/show cards, carousel rows and the big hero banner.
// ============================================================

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
  thumbBlob(it, 960).then(b => b && setAmbient(b));

  const [p, i] = h.querySelectorAll('button');

  p.onclick = () => playTarget(x);
  i.onclick = () => openDetail(x);

  return h;
}

const hasProgress = x =>
  (x.kind === 'show' ? x.eps : [x])
    .some(e => pct(e) > 1 && pct(e) < 95);
