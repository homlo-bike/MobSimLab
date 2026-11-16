import { contextBridge, ipcRenderer } from "electron";

/**
 * The bridge for the app's own onboarding and settings page only (never loaded for MobSimLab's web pages or a
 * server's pages). Each call is a fixed message; the main process checks the sender.
 */
contextBridge.exposeInMainWorld("mobsimlab", {
  state: () => ipcRenderer.invoke("desktop:state"),
  useLocal: () => ipcRenderer.invoke("desktop:use-local"),
  connect: (url: string) => ipcRenderer.invoke("desktop:connect", String(url)),
  setAgents: (on: boolean) => ipcRenderer.invoke("desktop:set-agents", Boolean(on)),
  retry: () => ipcRenderer.invoke("desktop:retry"),
  openLogs: () => ipcRenderer.invoke("desktop:open-logs"),
  close: () => ipcRenderer.invoke("desktop:close-settings"),
  onStatus: (f: (text: string) => void) => {
    ipcRenderer.on("desktop:status", (_e, text: string) => f(String(text)));
  },
});
