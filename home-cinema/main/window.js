// ============================================================
// main/window.js
// The app window: creates it, opens allowed links in the browser, blocks navigation away from the app.
// ============================================================

const path = require('path');
const fs = require('fs');
const { BrowserWindow, Menu, shell } = require('electron');
const { EXTERNAL_HOSTS } = require('./config');

// The project folder (this file lives in <project>/main).
const ROOT = path.join(__dirname, '..');

let mainWindow = null;

const getMainWindow = () => mainWindow;

function createWindow() {
  Menu.setApplicationMenu(null);

  // Use build/icon.png as the window icon when it exists.
  const iconPath = path.join(ROOT, 'build', 'icon.png');

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
      preload: path.join(ROOT, 'preload.js'),

      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow = win;

  win.loadFile(path.join(ROOT, 'index.html'));

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

module.exports = { createWindow, getMainWindow };
