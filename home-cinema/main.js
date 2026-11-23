// ============================================================
// main.js  (entry point)
// Starts the app and wires the parts in the main/ folder together.
//
//   main/config.js          supported file types, saved library folders
//   main/library.js         scans folders for videos
//   main/ffmpeg.js          finds and runs ffmpeg
//   main/subtitles.js       subtitles stored inside videos
//   main/audio.js           audio tracks inside videos
//   main/cache.js           deletes old cached files
//   main/watcher.js         refreshes the library when files change
//   main/media-protocol.js  media:// addresses used by the player
//   main/window.js          the app window
//   main/ipc.js             requests from the window (library, files, tracks)
// ============================================================

const path = require('path');
const { app, BrowserWindow } = require('electron');

// Lets the player switch between audio tracks inside a video.
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');

// Must be loaded before the app is ready (it registers the media:// scheme).
const { registerMediaProtocol } = require('./main/media-protocol');

const { registerIpc } = require('./main/ipc');
const { createWindow } = require('./main/window');
const { setupLibraryWatcher, stopLibraryWatcher } = require('./main/watcher');
const { audioCacheRoot, cancelAllAudio } = require('./main/audio');
const { pruneCache } = require('./main/cache');

app.whenReady().then(async () => {
  registerMediaProtocol();
  registerIpc();

  // Start watching previously selected folders.
  await setupLibraryWatcher();

  // Create application window.
  createWindow();

  // Housekeeping a little after startup: clear stale cached files.
  setTimeout(() => {
    pruneCache(path.join(app.getPath('userData'), 'subs-cache'));
    pruneCache(audioCacheRoot(), 14);     // audio files are larger
  }, 15000);

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) {
      createWindow();
    }
  });
});

// Clean up when all windows are closed.
app.on('window-all-closed', async () => {
  // Stop any audio preparation that is still running.
  cancelAllAudio();

  await stopLibraryWatcher();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
