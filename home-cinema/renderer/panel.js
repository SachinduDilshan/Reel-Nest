// ============================================================
// panel.js
// The Subtitles / Audio / Style panel in the player: its tabs, lists, search and buttons.
// ============================================================

const menuOpen = () => !$('#tmenu').classList.contains('hidden');
const closeMenu = () => $('#tmenu').classList.add('hidden');
const fmtOff = d => (d >= 0 ? '+' : '') + d.toFixed(1) + 's';
const updateBtn = () => {
  $('#cc').classList.toggle('on', ccIdx >= 0 || !!ext);
  $('#cc .lbl').textContent = subsBusy ? 'Loading subs…' : 'Subs & Audio';
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
