// Sandboxed preload: exposes ONLY the typed functions below as `window.geneExplorer`. No Node APIs reach the renderer.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GeneExplorerApi, type MenuCommand } from '../src/shared/types';

const api: GeneExplorerApi = {
  fetchJson: (requestId, spec) => ipcRenderer.invoke(IPC.fetchJson, requestId, spec),
  fetchText: (requestId, spec) => ipcRenderer.invoke(IPC.fetchText, requestId, spec),
  cancel: (requestId) => ipcRenderer.invoke(IPC.cancel, requestId),
  cacheInfo: () => ipcRenderer.invoke(IPC.cacheInfo),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
  saveFile: (spec) => ipcRenderer.invoke(IPC.saveFile, spec),
  printPdf: (suggestedName) => ipcRenderer.invoke(IPC.printPdf, suggestedName),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  onMenuCommand: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, command: MenuCommand) => handler(command);
    ipcRenderer.on(IPC.menuCommand, listener);
    return () => ipcRenderer.removeListener(IPC.menuCommand, listener);
  },
};

contextBridge.exposeInMainWorld('geneExplorer', api);
