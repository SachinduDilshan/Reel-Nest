// ============================================================
// main/library.js
// Scans the library folders for videos (and the subtitle files next to them).
// ============================================================

const path = require('path');
const fsp = require('fs/promises');
const { VIDEO, SUB, loadCfg } = require('./config');

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

module.exports = { scan };
