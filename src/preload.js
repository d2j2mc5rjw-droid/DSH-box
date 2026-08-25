const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('splash', {
  onProgress: (cb) => ipcRenderer.on('dsh:progress', (_e, data) => cb(data)),
})
