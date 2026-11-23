// ============================================================
// main/ipc.js
// Everything the window can ask the main process to do: library, folders, subtitle and audio files and tracks.
// ============================================================

const path = require('path');
const fsp = require('fs/promises');
const { app, ipcMain, dialog } = require('electron');
const { SUB, loadCfg, saveCfg, isInsideFolder } = require('./config');
const { scan } = require('./library');
const { setupLibraryWatcher } = require('./watcher');
const { embeddedSubs } = require('./subtitles');
const {
  listAudio,
  extractAudio,
  cancelAudio,
  audioCacheRoot,
  audioLabel
} = require('./audio');
const { granted } = require('./media-protocol');
const { getMainWindow } = require('./window');

function registerIpc() {

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
    const result = await dialog.showOpenDialog(getMainWindow(), {
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
    const result = await dialog.showOpenDialog(getMainWindow(), {
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

  // Audio tracks inside a video.
  const inLibrary = async filePath => {
    if (typeof filePath !== 'string') return null;

    const resolved = path.resolve(filePath);
    const config = await loadCfg();

    return config.folders.some(folder => isInsideFolder(resolved, folder))
      ? resolved
      : null;
  };

  ipcMain.handle('audio:list', async (_event, filePath) => {
    const file = await inLibrary(filePath);

    if (!file) return { streams: [] };

    try {
      const info = await listAudio(file);

      return {
        streams: info.streams.map(st => ({ ...st, label: audioLabel(st) })),
        missing: info.missing
      };
    } catch {
      return { streams: [] };
    }
  });

  ipcMain.handle('audio:extract', async (event, filePath, n) => {
    const file = await inLibrary(filePath);

    if (!file || !Number.isInteger(n) || n < 0 || n > 63) {
      return { error: 'bad-request' };
    }

    try {
      const result = await extractAudio(file, n, audioCacheRoot(), pct => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('audio:progress', { n, pct });
        }
      });

      if (!result.file) return { error: result.error || 'failed' };

      const resolved = path.resolve(result.file);

      granted.add(resolved);

      return { url: 'media://local/' + encodeURIComponent(resolved) };
    } catch (error) {
      console.error('Audio extraction failed:', error);

      return { error: 'failed' };
    }
  });

  ipcMain.handle('audio:cancel', async (_event, filePath, n) => {
    const file = await inLibrary(filePath);

    if (file) cancelAudio(file, n);
  });

}

module.exports = { registerIpc };
