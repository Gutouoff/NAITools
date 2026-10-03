import type { NaiDesktopApi } from "./types";
import type { PromptMainWindowApi, PromptPopupWindowApi } from "./prompt-window-contract";

declare global {
  interface Window {
    naiDesktop: NaiDesktopApi;
    promptWindowMain?: PromptMainWindowApi;
    promptWindowPopup?: PromptPopupWindowApi;
  }
}

export {};
