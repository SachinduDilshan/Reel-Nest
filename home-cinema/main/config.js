// ============================================================
// main/config.js
// Settings shared by every part: supported file types, allowed websites, the saved library folders.
// ============================================================

const path = require('path');
const fsp = require('fs/promises');
const { app } = require('electron');

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

const WATCHED_EXT = new Set([...Object.keys(VIDEO), ...SUB]);

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

module.exports = {
  VIDEO,
  AUDIO,
  SUB,
  EXTERNAL_HOSTS,
  WATCHED_EXT,
  isInsideFolder,
  loadCfg,
  saveCfg
};
