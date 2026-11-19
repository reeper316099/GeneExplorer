"use strict";

// electron/preload.ts
var import_electron = require("electron");

// src/shared/types.ts
var IPC = {
  fetchJson: "net:fetchJson",
  fetchText: "net:fetchText",
  cancel: "net:cancel",
  cacheInfo: "cache:info",
  clearCache: "cache:clear",
  saveFile: "file:save",
  printPdf: "file:printPdf",
  openExternal: "shell:openExternal",
  getAppInfo: "app:info",
  menuCommand: "menu:command"
};

// electron/preload.ts
var api = {
  fetchJson: (requestId, spec) => import_electron.ipcRenderer.invoke(IPC.fetchJson, requestId, spec),
  fetchText: (requestId, spec) => import_electron.ipcRenderer.invoke(IPC.fetchText, requestId, spec),
  cancel: (requestId) => import_electron.ipcRenderer.invoke(IPC.cancel, requestId),
  cacheInfo: () => import_electron.ipcRenderer.invoke(IPC.cacheInfo),
  clearCache: () => import_electron.ipcRenderer.invoke(IPC.clearCache),
  saveFile: (spec) => import_electron.ipcRenderer.invoke(IPC.saveFile, spec),
  printPdf: (suggestedName) => import_electron.ipcRenderer.invoke(IPC.printPdf, suggestedName),
  openExternal: (url) => import_electron.ipcRenderer.invoke(IPC.openExternal, url),
  getAppInfo: () => import_electron.ipcRenderer.invoke(IPC.getAppInfo),
  onMenuCommand: (handler) => {
    const listener = (_event, command) => handler(command);
    import_electron.ipcRenderer.on(IPC.menuCommand, listener);
    return () => import_electron.ipcRenderer.removeListener(IPC.menuCommand, listener);
  }
};
import_electron.contextBridge.exposeInMainWorld("geneExplorer", api);
//# sourceMappingURL=preload.cjs.map
