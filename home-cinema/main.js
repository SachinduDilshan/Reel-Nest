const { app, BrowserWindow, ipcMain, dialog, protocol, Menu } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const { createReadStream } = require('fs');
const { Readable } = require('stream');

// "media://" serves local files to the player with proper Range support (seeking) and CORS (thumbnails).
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

const VIDEO = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4',
  '.mkv': 'video/webm', '.webm': 'video/webm', '.ogv': 'video/ogg', '.avi': 'video/x-msvideo'
};
const SUB = new Set(['.srt', '.vtt']);
const cfgFile = () => path.join(app.getPath('userData'), 'library.json');

async function loadCfg() {
  try { return JSON.parse(await fsp.readFile(cfgFile(), 'utf8')); } catch { return { folders: [] }; }
}
const saveCfg = (c) => fsp.writeFile(cfgFile(), JSON.stringify(c));

async function walk(dir, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  const subs = entries.filter(e => e.isFile() && SUB.has(path.extname(e.name).toLowerCase())).map(e => e.name);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) await walk(full, out);
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    if (!VIDEO[ext]) continue;
    const base = path.basename(e.name, ext).toLowerCase();
    const st = await fsp.stat(full);
    out.push({
      id: full,
      url: 'media://local/' + encodeURIComponent(full),
      file: e.name,
      folder: path.basename(dir),
      size: st.size,
      added: st.mtimeMs,
      subs: subs.filter(s => s.toLowerCase().startsWith(base)).map(s => path.join(dir, s))
    });
  }
}

async function scan() {
  const cfg = await loadCfg();
  const items = [];
  for (const f of cfg.folders) await walk(f, items);
  return { folders: cfg.folders, items };
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#0c0c10', title: 'Home Cinema', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  protocol.handle('media', async (req) => {
    try {
      const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const cfg = await loadCfg();
      const ext = path.extname(p).toLowerCase();
      if (!VIDEO[ext] || !cfg.folders.some(f => p.startsWith(f))) return new Response('Forbidden', { status: 403 });
      const size = (await fsp.stat(p)).size;
      let start = 0, end = size - 1, status = 200;
      const headers = {
        'Content-Type': VIDEO[ext], 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*'
      };
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
      if (m && (m[1] || m[2])) {
        if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], size - 1); }
        else start = Math.max(size - +m[2], 0);
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
      headers['Content-Length'] = String(end - start + 1);
      return new Response(Readable.toWeb(createReadStream(p, { start, end })), { status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  ipcMain.handle('lib:get', scan);
  ipcMain.handle('lib:add', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Choose a folder with your videos' });
    if (r.canceled || !r.filePaths[0]) return null;
    const cfg = await loadCfg();
    if (!cfg.folders.includes(r.filePaths[0])) cfg.folders.push(r.filePaths[0]);
    await saveCfg(cfg);
    return scan();
  });
  ipcMain.handle('lib:remove', async (_e, folder) => {
    const cfg = await loadCfg();
    cfg.folders = cfg.folders.filter(f => f !== folder);
    await saveCfg(cfg);
    return scan();
  });
  ipcMain.handle('text:read', async (_e, p) => {
    const cfg = await loadCfg();
    if (!SUB.has(path.extname(p).toLowerCase()) || !cfg.folders.some(f => p.startsWith(f))) return '';
    try { return await fsp.readFile(p, 'utf8'); } catch { return ''; }
  });

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
