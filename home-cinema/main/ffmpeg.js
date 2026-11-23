// ============================================================
// main/ffmpeg.js
// Finds ffmpeg and runs it. Also turns language codes into names (deu -> German).
// ============================================================

const { spawn } = require('child_process');

let FFMPEG = 'ffmpeg';

try {
  // Bundled ffmpeg (npm install ffmpeg-static). Falls back to a system ffmpeg.
  FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
} catch {}

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

module.exports = { FFMPEG, runFfmpeg, langName };
