const {
  contextBridge,
  ipcRenderer
} = require('electron');

contextBridge.exposeInMainWorld('api', {

  pickSubtitle: () => ipcRenderer.invoke('sub:pick'),

  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  
  embeddedSubs: filePath => ipcRenderer.invoke('subs:embedded', filePath),

  openAppLink: (app) => ipcRenderer.invoke("external:open-app", app),
  

  // Get all library items.
  getLibrary: () =>
    ipcRenderer.invoke('lib:get'),

  // Add a library folder.
  addFolder: () =>
    ipcRenderer.invoke('lib:add'),

  // Remove a library folder.
  removeFolder: folder =>
    ipcRenderer.invoke('lib:remove', folder),

  // Read subtitle file.
  readText: filePath =>
    ipcRenderer.invoke('text:read', filePath),

  // Listen for automatic library updates.
  onLibraryUpdated: callback => {
    if (typeof callback !== 'function') return () => { };

    const listener = (_event, library) => {
      callback(library);
    };

    ipcRenderer.on('lib:updated', listener);

    // Return cleanup function.
    return () => {
      ipcRenderer.removeListener('lib:updated', listener);
    };
  }

});