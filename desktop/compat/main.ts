import { invoke, isTauri } from "@tauri-apps/api/core";
import { createLangbaiBridge } from "./desktop-bridge";
import { DesktopError } from "../src/platform/types";
// Browser builds do not silently load mock accounts, storage or provider results.
// Integration tests may inject Tauri IPC before this entrypoint runs.
const nativeInvoke:typeof invoke=isTauri()?invoke:async()=>{
 throw new DesktopError("native_unavailable","原版界面迁移预览未连接 Rust 宿主，无法读取本地设置；不会发送付费请求。",false);
};
const bridge=createLangbaiBridge(nativeInvoke);
window.naiDesktop=bridge.api;
window.addEventListener("pagehide",()=>bridge.dispose(),{once:true});
// Electron's -webkit-app-region does not provide Tauri native dragging. Keep
// original chrome markup and attach only the replacement native window service.
function titleTarget(event:MouseEvent):boolean {
 return event.target instanceof Element && !!event.target.closest(".title-bar") && !event.target.closest("button,input,a,.window-controls");
}
document.addEventListener("mousedown",event=>{
 if(event.button===0 && event.detail===1 && titleTarget(event)) void bridge.startDragging().catch(console.error);
});
document.addEventListener("dblclick",event=>{
 if(titleTarget(event)) void bridge.api.maximize().catch(console.error);
});
void import("../langbai/src/main").catch(error=>{
 console.error("Langbai renderer failed to load",error);
 const root=document.getElementById("root");
 if(root)root.textContent="界面加载失败；请保留本地数据并检查程序日志。";
});
