// ============================================================
// player.js
// Playback: play/close, progress saving, controls, seek bar, keyboard shortcuts, next episode.
// ============================================================

const nextEp = () => {
  const i = queue.indexOf(cur);

  return i >= 0
    ? queue[i + 1]
    : null;
};

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
