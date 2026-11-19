const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  Menu,
  shell
} = require('electron');

app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');

const path = require('path');
const fsp = require('fs/promises');
const { createReadStream } = require('fs');
const { Readable } = require('stream');
const chokidar = require('chokidar');

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

// Supported subtitle formats.
const SUB = new Set(['.srt', '.vtt']);

// Audio formats the player can load from outside the library folders.
const AUDIO = {
  '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.mka': 'audio/webm', '.webm': 'audio/webm'
};

// Files the user picked manually through a dialog.
const granted = new Set();

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

  const win = new BrowserWindow({
    width: 1400,
    height: 860,

    minWidth: 900,
    minHeight: 600,

    backgroundColor: '#0c0c10',
    title: 'ReelNest',

    autoHideMenuBar: true,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),

      contextIsolation: true,
      nodeIntegration: false
    },

    icon: path.join(__dirname, 'build', 'icon.png'),
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

      const allowed =
        granted.has(filePath) ||
        config.folders.some(folder => isInsideFolder(filePath, folder));

      if (!allowed) {
        return new Response('Forbidden', { status: 403 });
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = granted.has(filePath) ? AUDIO[ext] : VIDEO[ext];

      if (!mime) {
        return new Response('Unsupported media type', { status: 415 });
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

  // Read subtitle files.
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
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a subtitle file',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }]
    });

    if (r.canceled || !r.filePaths[0]) return null;

    try {
      return {
        name: path.basename(r.filePaths[0]),
        text: await fsp.readFile(r.filePaths[0], 'utf8')
      };
    } catch {
      return null;
    }
  });

  // Pick an external audio file.
  ipcMain.handle('audio:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an audio file',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'aac', 'm4a', 'ogg', 'opus', 'wav', 'flac', 'mka'] }]
    });

    if (r.canceled || !r.filePaths[0]) return null;

    const p = path.resolve(r.filePaths[0]);
    granted.add(p);

    return {
      name: path.basename(p),
      url: 'media://local/' + encodeURIComponent(p)
    };
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