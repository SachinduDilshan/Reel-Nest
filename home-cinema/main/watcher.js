// ============================================================
// main/watcher.js
// Watches the library folders and tells the window when videos are added or removed.
// ============================================================

const path = require('path');
const chokidar = require('chokidar');
const { WATCHED_EXT, loadCfg } = require('./config');
const { scan } = require('./library');
const { getMainWindow } = require('./window');

let libraryWatcher = null;

let refreshTimer = null;
let watcherSetupPromise = Promise.resolve();

// Notify renderer after a library change.
// Debouncing prevents multiple refreshes for one operation.
function scheduleLibraryRefresh() {
  clearTimeout(refreshTimer);

  refreshTimer = setTimeout(async () => {
    try {
      const library = await scan();

      const win = getMainWindow();

      if (
        win &&
        !win.isDestroyed() &&
        !win.webContents.isDestroyed()
      ) {
        win.webContents.send(
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

      // Only video and subtitle files are watched (fewer handles, less memory).
      ignored: (watchedPath, stats) => {
        const name = path.basename(watchedPath);

        if (name.length > 1 && name.startsWith('.')) return true;

        if (stats && stats.isFile()) {
          return !WATCHED_EXT.has(path.extname(watchedPath).toLowerCase());
        }

        return false;
      },

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

// Stops watching (used when the app closes).
async function stopLibraryWatcher() {
  clearTimeout(refreshTimer);

  if (libraryWatcher) {
    await libraryWatcher.close();
    libraryWatcher = null;
  }
}

module.exports = { setupLibraryWatcher, stopLibraryWatcher };
