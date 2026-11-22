// ============================================================
// modals.js
// Pop-up windows: title details with the episode list, and the library folders window.
// ============================================================

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
