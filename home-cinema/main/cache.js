// ============================================================
// main/cache.js
// Housekeeping: deletes cached files that have not been used for a long time.
// ============================================================

const path = require('path');
const fsp = require('fs/promises');

// Removes cached files (extracted subtitles, prepared audio) that haven't been used for a long time.
async function pruneCache(cacheRoot, maxAgeDays = 60) {
  let names;

  try {
    names = await fsp.readdir(cacheRoot);
  } catch {
    return;
  }

  const limit = Date.now() - maxAgeDays * 24 * 3600 * 1000;

  for (const name of names) {
    const dir = path.join(cacheRoot, name);

    try {
      const st = await fsp.stat(dir);

      if (st.isDirectory() && st.mtimeMs < limit) {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    } catch {}
  }
}

module.exports = { pruneCache };
