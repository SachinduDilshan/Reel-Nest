// ============================================================
// subtitles.js
// Subtitle tracks: clean-up of duplicated/split lines, loading files and embedded tracks, delay, selecting.
// ============================================================

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
