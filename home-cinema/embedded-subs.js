/* ---------------------------------
   EMBEDDED SUBTITLES (via ffmpeg)
---------------------------------- */

let FFMPEG = 'ffmpeg';

try {
  // Bundled ffmpeg (npm install ffmpeg-static). Falls back to a system ffmpeg.
  FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
} catch {}

// Image-based subtitle formats can't be converted to text.
const BITMAP_SUBS = /pgs|dvd_subtitle|dvb_subtitle|xsub/i;

const LANG_B2 = {
  fre: 'fr', ger: 'de', chi: 'zh', dut: 'nl', gre: 'el', cze: 'cs',
  per: 'fa', rum: 'ro', slo: 'sk', may: 'ms', ice: 'is', wel: 'cy'
};

function langName(code) {
  if (!code || code === 'und') return '';

  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
      .of(LANG_B2[code] || code) || code;
  } catch {
    return code;
  }
}

function runFfmpeg(args, timeout) {
  return new Promise(resolve => {
    const chunks = [];
    let proc;
    let done = false;
    let missing = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ err: Buffer.concat(chunks).toString(), missing });
    };

    const timer = setTimeout(() => proc && proc.kill(), timeout);

    try {
      proc = spawn(FFMPEG, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
    } catch {
      missing = true;
      return finish();
    }

    proc.stderr.on('data', d => chunks.push(d));
    proc.on('error', () => { missing = true; finish(); });
    proc.on('close', finish);
  });
}

// Reads ffmpeg's "-i" report and lists the subtitle streams in order.
function parseSubStreams(report) {
  const out = [];
  let curStream = null;

  for (const line of report.split(/\r?\n/)) {
    const m = /^\s*Stream #\d+:\d+(?:\[[^\]]*\])?(?:\((\w+)\))?: (\w+): (.*)$/.exec(line);

    if (m) {
      if (m[2] === 'Subtitle') {
        curStream = {
          n: out.length,                       // index for -map 0:s:n
          lang: m[1] || '',
          codec: m[3].split(/[\s,(]/)[0],
          def: /\(default\)/.test(m[3]),
          forced: /\(forced\)/.test(m[3]),
          title: ''
        };

        out.push(curStream);
      } else {
        curStream = null;
      }

      continue;
    }

    if (/^\s*Chapter #/.test(line)) curStream = null;

    if (curStream) {
      const t = /^\s+title\s*:\s*(.+)$/.exec(line);
      if (t) curStream.title = t[1].trim();
    }
  }

  return out;
}

function subLabel(s) {
  const name = langName(s.lang) || `Track ${s.n + 1}`;
  const parts = [name];

  if (s.title && s.title.toLowerCase() !== name.toLowerCase()) {
    parts.push(s.title);
  }

  return parts.join(' – ') + (s.forced ? ' (forced)' : '') + ' (embedded)';
}

async function extractSubs(file, cacheRoot) {
  const st = await fsp.stat(file);

  const key = crypto
    .createHash('sha1')
    .update(`${file}|${st.size}|${st.mtimeMs}`)
    .digest('hex');

  const dir = path.join(cacheRoot, key);
  const manifestPath = path.join(dir, 'manifest.json');

  const readTracks = async list => {
    const tracks = [];

    for (const s of list) {
      try {
        const text = await fsp.readFile(path.join(dir, `s${s.n}.vtt`), 'utf8');

        if (text.trim().length > 10) {
          tracks.push({ label: subLabel(s), text, def: s.def });
        }
      } catch {}
    }

    return tracks;
  };

  // Already extracted earlier? Use the cache.
  try {
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));

    return {
      tracks: await readTracks(manifest.tracks),
      skipped: manifest.skipped
    };
  } catch {}

  const info = await runFfmpeg(['-hide_banner', '-i', file], 30000);

  if (info.missing) return { tracks: [], skipped: 0, missing: true };

  const all = parseSubStreams(info.err);
  const text = all.filter(s => !BITMAP_SUBS.test(s.codec));
  const skipped = all.length - text.length;

  if (!text.length) return { tracks: [], skipped };

  await fsp.mkdir(dir, { recursive: true });

  // One pass over the file writes every text subtitle track as WebVTT.
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', file];

  text.forEach(s => {
    args.push('-map', `0:s:${s.n}`, '-f', 'webvtt', path.join(dir, `s${s.n}.vtt`));
  });

  await runFfmpeg(args, 10 * 60 * 1000);

  const tracks = await readTracks(text);

  // Only cache a complete result.
  if (tracks.length === text.length) {
    await fsp.writeFile(manifestPath, JSON.stringify({ skipped, tracks: text }));
  }

  return { tracks, skipped };
}

const subJobs = new Map();

function embeddedSubs(file, cacheRoot) {
  if (!subJobs.has(file)) {
    subJobs.set(
      file,
      extractSubs(file, cacheRoot).finally(() => subJobs.delete(file))
    );
  }

  return subJobs.get(file);
}
