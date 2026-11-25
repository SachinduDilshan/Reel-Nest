// ============================================================
// audio.js
// Audio tracks: language switching (prepared by ffmpeg), your own audio file, sync with the video, volume and mute.
// ============================================================

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

const updateMuteIcon = () =>
  $('#mute').classList.toggle('off', (ext ? A.muted : v.muted) || v.volume === 0);

v.addEventListener('volumechange', updateMuteIcon);
A.addEventListener('volumechange', updateMuteIcon);

const toggleMute = () => {
  if (ext) A.muted = !A.muted;
  else v.muted = !v.muted;
};
