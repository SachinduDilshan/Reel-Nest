// ============================================================
// main/audio.js
// Audio tracks inside a video: lists them and prepares one as its own file so the player can switch language safely.
// ============================================================

const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app } = require('electron');
const { FFMPEG, runFfmpeg, langName } = require('./ffmpeg');

// Reads ffmpeg's "-i" report and lists the audio streams in order.
function parseAudioStreams(report) {
  const out = [];
  let curStream = null;

  for (const line of report.split(/\r?\n/)) {
    const m = /^\s*Stream #\d+:\d+(?:\[[^\]]*\])?(?:\((\w+)\))?: (\w+): (.*)$/.exec(line);

    if (m) {
      if (m[2] === 'Audio') {
        const info = m[3];
        const layout = /,\s*(mono|stereo|\d(?:\.\d)?(?:\([^)]*\))?)\s*,/.exec(info);

        curStream = {
          n: out.length,                        // index for -map 0:a:n
          lang: m[1] || '',
          codec: info.split(/[\s,(]/)[0],
          channels: layout ? layout[1].replace(/\(.*\)/, '') : '',
          def: /\(default\)/.test(info),
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

async function listAudio(file) {
  const info = await runFfmpeg(['-hide_banner', '-i', file], 30000);
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info.err);

  return {
    streams: parseAudioStreams(info.err),
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    missing: info.missing
  };
}

const audioJobs = new Map();     // output file -> { proc, promise }

// Writes one audio track of a video to its own file (cached), so the player
// can play it next to the video without touching the video's own audio.
// AAC and MP3 are copied (fast); other formats are converted to AAC.
async function extractAudio(file, n, cacheRoot, onProgress) {
  const st = await fsp.stat(file);

  const key = crypto
    .createHash('sha1')
    .update(`${file}|${st.size}|${st.mtimeMs}`)
    .digest('hex');

  const dir = path.join(cacheRoot, key);
  const info = await listAudio(file);

  if (info.missing) return { error: 'missing' };

  const stream = info.streams[n];

  if (!stream) return { error: 'no-such-track' };

  const isMp3 = stream.codec === 'mp3';
  const out = path.join(dir, `a${n}${isMp3 ? '.mp3' : '.m4a'}`);

  // Already prepared earlier?
  try {
    await fsp.access(out);
    fsp.utimes(dir, new Date(), new Date()).catch(() => {});

    return { file: out };
  } catch {}

  if (audioJobs.has(out)) return audioJobs.get(out).promise;

  await fsp.mkdir(dir, { recursive: true });

  const tmp = out + '.partial';

  const codec =
    stream.codec === 'aac' || isMp3
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'];

  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-progress', 'pipe:1', '-nostats',
    '-i', file,
    '-map', `0:a:${n}`, '-vn', '-sn', '-dn',
    ...codec,
    ...(isMp3 ? [] : ['-movflags', '+faststart']),
    '-f', isMp3 ? 'mp3' : 'mp4',
    tmp
  ];

  const job = { proc: null, promise: null, file, n, cancelled: false };

  job.promise = new Promise(resolve => {
    let proc;

    try {
      proc = spawn(FFMPEG, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      resolve({ error: 'missing' });
      return;
    }

    job.proc = proc;

    let finished = false;
    const timer = setTimeout(() => proc.kill(), 20 * 60 * 1000);

    const finish = async (code, spawnFailed) => {
      if (finished) return;

      finished = true;
      clearTimeout(timer);
      audioJobs.delete(out);

      if (spawnFailed) {
        resolve({ error: 'missing' });
        return;
      }

      if (code === 0) {
        try {
          await fsp.rename(tmp, out);
          resolve({ file: out });
          return;
        } catch {}
      }

      await fsp.rm(tmp, { force: true }).catch(() => {});

      resolve({ error: job.cancelled ? 'cancelled' : 'failed' });
    };

    proc.stdout.on('data', data => {
      const m = /out_time_us=(\d+)/g;
      let last = null;
      let x;

      while ((x = m.exec(data.toString())) !== null) last = x[1];

      if (last && info.duration && onProgress) {
        onProgress(Math.min(99, Math.round(Number(last) / 1e6 / info.duration * 100)));
      }
    });

    proc.on('error', () => finish(null, true));
    proc.on('close', code => finish(code, false));
  });

  audioJobs.set(out, job);

  return job.promise;
}

function cancelAudio(file, n) {
  for (const job of audioJobs.values()) {
    if (job.file === file && job.n === n) {
      job.cancelled = true;

      if (job.proc) job.proc.kill();
    }
  }
}

const audioCacheRoot = () => path.join(app.getPath('userData'), 'audio-cache');

function audioLabel(stream) {
  const name = langName(stream.lang) || `Track ${stream.n + 1}`;

  return stream.title && stream.title.toLowerCase() !== name.toLowerCase()
    ? `${name} – ${stream.title}`
    : name;
}

// Stops every audio preparation that is still running (used when the app closes).
function cancelAllAudio() {
  for (const job of audioJobs.values()) {
    job.cancelled = true;

    if (job.proc) job.proc.kill();
  }
}

module.exports = {
  listAudio,
  extractAudio,
  cancelAudio,
  cancelAllAudio,
  audioCacheRoot,
  audioLabel
};
