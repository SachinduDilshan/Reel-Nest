const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getLibrary: () => ipcRenderer.invoke('lib:get'),
  addFolder: () => ipcRenderer.invoke('lib:add'),
  removeFolder: (f) => ipcRenderer.invoke('lib:remove', f),
  readText: (p) => ipcRenderer.invoke('text:read', p)
});
