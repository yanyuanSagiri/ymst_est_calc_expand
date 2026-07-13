/* global require */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  runFormation: (userData, options) =>
    ipcRenderer.invoke("run-formation", userData, options),
  stopFormation: () => ipcRenderer.invoke("stop-formation"),
  pauseFormation: () => ipcRenderer.invoke("pause-formation"),
  resumeFormation: () => ipcRenderer.invoke("resume-formation"),
  finishFormationInput: () => ipcRenderer.invoke("finish-formation-input"),
  onFormationResult: (callback) =>
    ipcRenderer.on("formation-result", (_event, data) => callback(data)),
  removeFormationResultListener: () =>
    ipcRenderer.removeAllListeners("formation-result"),
});
