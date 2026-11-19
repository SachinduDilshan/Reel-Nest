const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  Menu,
  shell
} = require('electron');

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { createReadStream } = require('fs');
const { Readable } = require('stream');
const crypto = require('crypto');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

// Lets the player switch between audio tracks inside a video.
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');

// Register the media protocol before app initialization.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

// Supported video formats.
const VIDEO = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo'
};

// Audio formats that can be loaded manually from anywhere on the laptop.
const AUDIO = {
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.mka': 'audio/webm',
  '.webm': 'audio/webm'
};

// Files the user picked manually through a dialog.
const granted = new Set();

// Supported subtitle formats.
const SUB = new Set(['.srt', '.vtt']);

const cfgFile = () =>
  path.join(app.getPath('userData'), 'library.json');

// Approved external websites.
const EXTERNAL_HOSTS = new Set([
  'open.spotify.com',
  'youtube.com',
  'www.youtube.com'
]);

let mainWindow = null;
let libraryWatcher = null;

let refreshTimer = null;
let watcherSetupPromise = Promise.resolve();

// Check whether a path belongs to a selected library folder.
function isInsideFolder(filePath, folderPath) {
  const relative = path.relative(
    path.resolve(folderPath),
    path.resolve(filePath)
  );

  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

// Load saved library configuration.
async function loadCfg() {
  try {
    const data = await fsp.readFile(cfgFile(), 'utf8');
    const config = JSON.parse(data);

    return {
      folders: Array.isArray(config.folders)
        ? config.folders.filter(
            folder => typeof folder === 'string'
          )
        : []
    };
  } catch {
    return { folders: [] };
  }
}

// Save library configuration.
async function saveCfg(config) {
  await fsp.writeFile(
    cfgFile(),
    JSON.stringify(config, null, 2),
    'utf8'
  );
}

// Recursively scan folders for videos.
async function walk(dir, out) {
  let entries;

  try {
    entries = await fsp.readdir(dir, {
      withFileTypes: true
    });
  } catch {
    return;
  }

  const subs = entries
    .filter(entry =>
      entry.isFile() &&
      SUB.has(path.extname(entry.name).toLowerCase())
    )
    .map(entry => entry.name);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) {
        await walk(fullPath, out);
      }

      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();

    if (!VIDEO[ext]) continue;

    try {
      const stats = await fsp.stat(fullPath);

      const base = path.basename(entry.name, ext).toLowerCase();

      out.push({
        id: fullPath,

        url:
          'media://local/' +
          encodeURIComponent(fullPath),

        file: entry.name,
        folder: path.basename(dir),
        size: stats.size,
        added: stats.mtimeMs,

        subs: subs
          .filter(sub =>
            sub.toLowerCase().startsWith(base)
          )
          .map(sub => path.join(dir, sub))
      });
    } catch {
      // Skip inaccessible files.
    }
  }
}

// Scan all selected library folders.
async function scan() {
  const config = await loadCfg();
  const items = [];

  for (const folder of config.folders) {
    await walk(folder, items);
  }

  return {
    folders: config.folders,
    items
  };
}

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

/* ---------------------------------
   AUTOMATIC LIBRARY WATCHER
---------------------------------- */

// Notify renderer after a library change.
// Debouncing prevents multiple refreshes for one operation.
function scheduleLibraryRefresh() {
  clearTimeout(refreshTimer);

  refreshTimer = setTimeout(async () => {
    try {
      const library = await scan();

      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send(
          'lib:updated',
          library
        );
      }
    } catch (error) {
      console.error('Automatic library refresh failed:', error);
    }
  }, 1000);
}

// Reconfigure the watcher whenever folders are added or removed.
function setupLibraryWatcher() {
  watcherSetupPromise = watcherSetupPromise.then(async () => {
    if (libraryWatcher) {
      await libraryWatcher.close();
      libraryWatcher = null;
    }

    const config = await loadCfg();

    if (!config.folders.length) return;

    libraryWatcher = chokidar.watch(config.folders, {
      persistent: true,
      ignoreInitial: true,

      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 200
      },

      ignored: /(^|[\/\\])\../,

      ignorePermissionErrors: true
    });

    libraryWatcher.on('add', scheduleLibraryRefresh);
    libraryWatcher.on('change', scheduleLibraryRefresh);
    libraryWatcher.on('unlink', scheduleLibraryRefresh);
    libraryWatcher.on('addDir', scheduleLibraryRefresh);
    libraryWatcher.on('unlinkDir', scheduleLibraryRefresh);

    libraryWatcher.on('error', error => {
      console.error('Library watcher error:', error);
    });

    console.log('Library folder watcher initialized.');
  });

  return watcherSetupPromise;
}

/* ---------------------------------
   WINDOW
---------------------------------- */

function createWindow() {
  Menu.setApplicationMenu(null);

  // Use build/icon.png as the window icon when it exists.
  const iconPath = path.join(__dirname, 'build', 'icon.png');

  const win = new BrowserWindow({
    width: 1400,
    height: 860,

    minWidth: 900,
    minHeight: 600,

    backgroundColor: '#0c0c10',
    title: 'ReelNest',

    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),

    autoHideMenuBar: true,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),

      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;

  win.loadFile(path.join(__dirname, 'index.html'));

  // Open approved external websites in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);

      const allowed =
        parsedUrl.protocol === 'https:' &&
        EXTERNAL_HOSTS.has(parsedUrl.hostname);

      if (allowed) {
        shell.openExternal(parsedUrl.href);
      }
    } catch {
      console.error('Invalid external URL:', url);
    }

    return { action: 'deny' };
  });

  // Prevent navigation away from the local application.
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    const currentUrl = win.webContents.getURL();

    if (navigationUrl !== currentUrl) {
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
}

/* ---------------------------------
   APPLICATION INITIALIZATION
---------------------------------- */

app.whenReady().then(async () => {

  // Register media protocol.
  protocol.handle('media', async request => {
    try {
      const mediaUrl = new URL(request.url);

      if (mediaUrl.hostname !== 'local') {
        return new Response('Forbidden', {
          status: 403
        });
      }

      const filePath = path.resolve(
        decodeURIComponent(mediaUrl.pathname.slice(1))
      );

      const config = await loadCfg();

      // Library files, plus audio files the user picked manually.
      const isGranted = granted.has(filePath);

      const allowed =
        isGranted ||
        config.folders.some(folder =>
          isInsideFolder(filePath, folder)
        );

      if (!allowed) {
        return new Response('Forbidden', {
          status: 403
        });
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = isGranted ? AUDIO[ext] : VIDEO[ext];

      if (!mime) {
        return new Response('Unsupported media type', {
          status: 415
        });
      }

      const stats = await fsp.stat(filePath);

      if (!stats.isFile()) {
        return new Response('Not found', {
          status: 404
        });
      }

      const size = stats.size;

      const headers = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      };

      if (size === 0) {
        headers['Content-Length'] = '0';

        return new Response(null, {
          status: 200,
          headers
        });
      }

      let start = 0;
      let end = size - 1;
      let status = 200;

      // Support seeking and partial video loading.
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

        if (!match || (!match[1] && !match[2])) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${size}`
            }
          });
        }

        if (match[1]) {
          start = Number(match[1]);

          if (match[2]) {
            end = Math.min(Number(match[2]), size - 1);
          }
        } else {
          const suffixLength = Number(match[2]);

          if (suffixLength <= 0) {
            return new Response(null, {
              status: 416,
              headers: {
                'Content-Range': `bytes */${size}`
              }
            });
          }

          start = Math.max(size - suffixLength, 0);
        }

        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start >= size ||
          start > end
        ) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${size}`
            }
          });
        }

        status = 206;

        headers['Content-Range'] =
          `bytes ${start}-${end}/${size}`;
      }

      headers['Content-Length'] = String(
        end - start + 1
      );

      const stream = createReadStream(filePath, {
        start,
        end
      });

      return new Response(
        Readable.toWeb(stream),
        {
          status,
          headers
        }
      );

    } catch (error) {
      console.error('Media protocol error:', error);

      return new Response('Not found', {
        status: 404
      });
    }
  });

  /* ---------- IPC HANDLERS ---------- */

  // Get library.
  ipcMain.handle('lib:get', scan);

  // Add folder.
  ipcMain.handle('lib:add', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose a folder with your videos'
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const config = await loadCfg();
    const selectedFolder = path.resolve(result.filePaths[0]);

    if (!config.folders.includes(selectedFolder)) {
      config.folders.push(selectedFolder);
    }

    await saveCfg(config);

    await setupLibraryWatcher();

    return scan();
  });

  // Remove folder.
  ipcMain.handle('lib:remove', async (_event, folder) => {
    if (typeof folder !== 'string') {
      return scan();
    }

    const config = await loadCfg();
    const selectedFolder = path.resolve(folder);

    config.folders = config.folders.filter(
      existing =>
        path.resolve(existing) !== selectedFolder
    );

    await saveCfg(config);

    await setupLibraryWatcher();

    return scan();
  });

  // Read subtitle files that sit next to a video.
  ipcMain.handle('text:read', async (_event, filePath) => {
    if (typeof filePath !== 'string') {
      return '';
    }

    const config = await loadCfg();
    const resolvedPath = path.resolve(filePath);

    const allowed = config.folders.some(folder =>
      isInsideFolder(resolvedPath, folder)
    );

    if (!allowed) return '';

    if (!SUB.has(path.extname(resolvedPath).toLowerCase())) {
      return '';
    }

    try {
      return await fsp.readFile(resolvedPath, 'utf8');
    } catch {
      return '';
    }
  });

  // Pick a subtitle file from anywhere on the laptop.
  ipcMain.handle('sub:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a subtitle file',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }]
    });

    if (result.canceled || !result.filePaths[0]) return null;

    try {
      return {
        name: path.basename(result.filePaths[0]),
        text: await fsp.readFile(result.filePaths[0], 'utf8')
      };
    } catch {
      return null;
    }
  });

  // Pick an external audio file.
  ipcMain.handle('audio:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an audio file',
      properties: ['openFile'],
      filters: [{
        name: 'Audio',
        extensions: ['mp3', 'aac', 'm4a', 'ogg', 'opus', 'wav', 'flac', 'mka']
      }]
    });

    if (result.canceled || !result.filePaths[0]) return null;

    const picked = path.resolve(result.filePaths[0]);

    granted.add(picked);

    return {
      name: path.basename(picked),
      url: 'media://local/' + encodeURIComponent(picked)
    };
  });

  // Subtitles stored inside the video file (e.g. MKV).
  ipcMain.handle('subs:embedded', async (_event, filePath) => {
    if (typeof filePath !== 'string') {
      return { tracks: [], skipped: 0 };
    }

    const resolved = path.resolve(filePath);
    const config = await loadCfg();

    if (!config.folders.some(folder => isInsideFolder(resolved, folder))) {
      return { tracks: [], skipped: 0 };
    }

    try {
      return await embeddedSubs(
        resolved,
        path.join(app.getPath('userData'), 'subs-cache')
      );
    } catch (error) {
      console.error('Embedded subtitle extraction failed:', error);

      return { tracks: [], skipped: 0 };
    }
  });

  // Start watching previously selected folders.
  await setupLibraryWatcher();

  // Create application window.
  createWindow();

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) {
      createWindow();
    }
  });
});

// Clean up when all windows are closed.
app.on('window-all-closed', async () => {
  clearTimeout(refreshTimer);

  if (libraryWatcher) {
    await libraryWatcher.close();
    libraryWatcher = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});