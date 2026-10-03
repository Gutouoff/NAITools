import { BrowserWindow, ipcMain } from "electron";
import type { PromptWindowSnapshot } from "../../src/prompt-window-contract";
import { isPromptWindowEdit, isPromptWindowSnapshot } from "../../src/prompt-window-contract";

export function registerPromptWindowIpc(
  getMainWindow: () => BrowserWindow | null,
  preloadPath: string,
  rendererPath: string,
  devUrl?: string,
) {
  let popup: BrowserWindow | null = null;
  let latest: PromptWindowSnapshot | null = null;
  const fromMain = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.senderFrame === event.sender.mainFrame && event.sender === getMainWindow()?.webContents;
  const fromPopup = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.senderFrame === event.sender.mainFrame && !!popup && !popup.isDestroyed() && event.sender === popup.webContents;

  ipcMain.handle("prompt-window:open", async event => {
    if (!fromMain(event)) return;
    if (popup && !popup.isDestroyed()) { popup.show(); popup.focus(); return; }
    const owner = getMainWindow();
    if (!owner) return;
    const window = new BrowserWindow({
      parent: owner,
      width: 1120,
      height: 670,
      minWidth: 640,
      minHeight: 360,
      title: "提示词编辑",
      backgroundColor: "#f0eff9",
      autoHideMenuBar: true,
      webPreferences: { preload: preloadPath, nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false },
    });
    popup = window;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (navigation, target) => {
      if (target !== window.webContents.getURL()) navigation.preventDefault();
    });
    window.on("closed", () => { if (popup === window) popup = null; });
    owner.once("closed", () => { if (!window.isDestroyed()) window.close(); });
    try {
      if (devUrl) {
        const url = new URL(devUrl);
        url.searchParams.set("view", "prompt");
        await window.loadURL(url.toString());
      } else {
        await window.loadFile(rendererPath, { query: { view: "prompt" } });
      }
      if (latest && !window.isDestroyed()) window.webContents.send("prompt-window:snapshot", latest);
    } catch (error) {
      if (!window.isDestroyed()) window.close();
      throw error;
    }
  });

  ipcMain.on("prompt-window:publish", (event, snapshot: unknown) => {
    if (!fromMain(event) || !isPromptWindowSnapshot(snapshot)) return;
    latest = snapshot;
    if (popup && !popup.isDestroyed()) popup.webContents.send("prompt-window:snapshot", snapshot);
  });
  ipcMain.on("prompt-window:request", event => {
    if (fromPopup(event) && latest) event.sender.send("prompt-window:snapshot", latest);
  });
  ipcMain.on("prompt-window:edit", (event, edit: unknown) => {
    if (!fromPopup(event) || !isPromptWindowEdit(edit)) return;
    const owner = getMainWindow();
    if (owner && !owner.isDestroyed()) owner.webContents.send("prompt-window:edit", edit);
  });
}
