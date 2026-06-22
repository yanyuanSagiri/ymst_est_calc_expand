const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  runFormation: (userData) => ipcRenderer.invoke("run-formation", userData),
  stopFormation: () => ipcRenderer.invoke("stop-formation"),
  onFormationResult: (callback) =>
    ipcRenderer.on("formation-result", (_event, data) => callback(data)),
  removeFormationResultListener: () =>
    ipcRenderer.removeAllListeners("formation-result"),
});
