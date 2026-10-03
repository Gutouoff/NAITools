import { contextBridge, ipcRenderer } from "electron";
import type { PromptWindowEdit, PromptWindowSnapshot } from "../src/prompt-window-contract";

contextBridge.exposeInMainWorld("promptWindowPopup", {
  edit: (change: PromptWindowEdit) => ipcRenderer.send("prompt-window:edit", change),
  request: () => ipcRenderer.send("prompt-window:request"),
  onSnapshot: (callback: (snapshot: PromptWindowSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: PromptWindowSnapshot) => callback(snapshot);
    ipcRenderer.on("prompt-window:snapshot", listener);
    return () => ipcRenderer.removeListener("prompt-window:snapshot", listener);
  },
});
