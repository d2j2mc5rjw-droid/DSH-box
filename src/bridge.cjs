const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshBox', {
  version: ipcRenderer.sendSync('dsh-box:version'),
  checkUpdate: () => ipcRenderer.invoke('dsh-box:check-update'),
  openReleases: () => ipcRenderer.invoke('dsh-box:open-releases'),
})
