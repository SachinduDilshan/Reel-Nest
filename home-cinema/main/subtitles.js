// ============================================================
// main/subtitles.js
// Subtitles stored inside a video file: finds them with ffmpeg, extracts them as WebVTT and caches them.
// ============================================================

const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { runFfmpeg, langName } = require('./ffmpeg');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Image-based subtitle formats can't be converted to text.
const BITMAP_SUBS = /pgs|dvd_subtitle|dvb_subtitle|xsub/i;

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

  // Subtitle files are stored compressed (about 5x smaller on disk).
  const readVtt = async n => {
    try {
      const zipped = await fsp.readFile(path.join(dir, `s${n}.vtt.gz`));
      return (await gunzip(zipped)).toString('utf8');
    } catch {}

    try {
      return await fsp.readFile(path.join(dir, `s${n}.vtt`), 'utf8');
    } catch {
      return '';
    }
  };

  const readTracks = async list => {
    const tracks = [];

    for (const s of list) {
      const text = await readVtt(s.n);

      if (text.trim().length > 10) {
        tracks.push({ label: subLabel(s), text, def: s.def });
      }
    }

    return tracks;
  };

  // Already extracted earlier? Use the cache.
  try {
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));

    // Mark as recently used so old entries can be cleaned up later.
    fsp.utimes(dir, new Date(), new Date()).catch(() => {});

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

  // Compress the extracted files and remove the originals.
  for (const s of text) {
    const file = path.join(dir, `s${s.n}.vtt`);

    try {
      await fsp.writeFile(file + '.gz', await gzip(await fsp.readFile(file)));
      await fsp.unlink(file);
    } catch {}
  }

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

module.exports = { embeddedSubs };
