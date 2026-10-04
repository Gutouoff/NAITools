// Optional Windows WebView2 smoke. The caller launches the EXE with a temporary
// loopback debugging port. No credentials, persistent drafts or paid requests.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const endpoint=process.env.NATIVE_CDP_ORIGIN||"http://127.0.0.1:9225";
const deadline=Date.now()+30000;
while(true){try{const r=await fetch(`${endpoint}/json/version`,{signal:AbortSignal.timeout(1000)});if(r.ok)break;}catch{}if(Date.now()>deadline)throw new Error("WebView2 debugger did not become ready");await new Promise(r=>setTimeout(r,250));}
const browser=await chromium.connectOverCDP(endpoint);
try{
  const context=browser.contexts()[0];assert.ok(context,"WebView2 context missing");
  let page;
  while(!page){page=context.pages().find(p=>p.url().includes("tauri.localhost")||p.url().startsWith("tauri://"));if(Date.now()>deadline)throw new Error("Native app page missing");if(!page)await new Promise(r=>setTimeout(r,250));}
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.getByRole("button",{name:"工作台",exact:true}).click();
  await page.getByRole("heading",{name:"图像生成",exact:true}).waitFor();
  const boot=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("desktop_bootstrap"));
  console.log(`INFO: rendererReadyHostMs=${boot.rendererReadyHostMs}; starts at Rust main, includes test debugging overhead, not a cold-start benchmark.`);
  assert.equal(boot.runtime,"tauri");assert.equal(boot.schemaVersion,2);assert.equal(boot.naiContract.verification,"observed_subset");
  if(process.env.NATIVE_WORKBENCH_SCREENSHOT)await page.screenshot({path:process.env.NATIVE_WORKBENCH_SCREENSHOT,fullPage:true});
  await page.getByLabel("正向提示词").fill("local native UI smoke only");
  assert.equal(await page.getByRole("button",{name:"生成图像",exact:true}).isEnabled(),true);
  // Validation occurs before credentials or transport initialization. Must reject.
  const input=JSON.parse(readFileSync(new URL("../contracts/generation-v1.fixture.json",import.meta.url),"utf8")).input;
  input.confirmPaid=false;
  const refusal=await page.evaluate(async input=>{try{await window.__TAURI_INTERNALS__.invoke("generation_submit",{input});return null;}catch(e){return {code:e.code,message:e.message};}},input);
  assert.equal(refusal.code,"confirmation_required");
  if(process.env.NATIVE_SMOKE_STORAGE==="1"){
    // Read only the new app's history shape, never record prompt/image contents.
    const historyShape=await page.evaluate(async()=>{
      try {
        const h=await window.__TAURI_INTERNALS__.invoke("history_list",{query:{limit:1,before:null}});
        return {itemsArray:Array.isArray(h.items)};
      } catch(e) {
        return {itemsArray:false,errorCode:typeof e?.code==="string"?e.code:"unexpected_ipc_error"};
      }
    });
    assert.equal(historyShape.itemsArray,true,`Native storage smoke failed: ${historyShape.errorCode||"invalid_history_shape"}`);
  }
  await page.getByRole("button",{name:"关于",exact:true}).click();
  await page.getByRole("heading",{name:"NAITools"}).waitFor();
  await page.getByText("运行诊断",{exact:true}).click();
  assert.equal(await page.getByText("tauri",{exact:true}).count(),1);
  if(process.env.NATIVE_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.NATIVE_SMOKE_SCREENSHOT});
  // Catch delayed white-screen/exit regressions, not just first render.
  await page.waitForTimeout(5000);
  assert.equal((await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("desktop_bootstrap"))).runtime,"tauri");
  assert.deepEqual(errors,[]);
  console.log("PASS: release WebView2 render, IPC 2 native handshake, local prompt editing and unconfirmed-generation rejection. No credential reads or paid submissions; not a performance benchmark.");
}finally{await browser.close();}
