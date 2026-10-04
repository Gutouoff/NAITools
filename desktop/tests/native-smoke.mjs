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
  const metadata = await page.evaluate(async()=> {
    try {const values=await window.__TAURI_INTERNALS__.invoke("connections_list",{checkCredentials:false});return {shape:Array.isArray(values),secretRequested:values.some(v=>v.hasToken!==null)};}
    catch(e){return {errorCode:e.code};}
  });
  assert.ok(metadata.shape || metadata.errorCode === "storage_unavailable", "Connection IPC must be permitted, even if storage is unavailable");
  if(metadata.shape)assert.equal(metadata.secretRequested,false);
  const presetRead = await page.evaluate(async()=> {
    try {return {shape:Array.isArray(await window.__TAURI_INTERNALS__.invoke("drawing_presets_list"))};}
    catch(e){return {errorCode:e.code};}
  });
  assert.ok(presetRead.shape || presetRead.errorCode === "storage_unavailable", "Preset listing IPC must have native permission");
  const invalidMetadata = await page.evaluate(async()=> {
    try {await window.__TAURI_INTERNALS__.invoke("artifact_metadata",{id:"../../invalid"});return null;}
    catch(e){return e.code;}
  });
  assert.ok(["invalid_input","storage_unavailable"].includes(invalidMetadata), "Metadata IPC must be permitted, without accepting unsafe artifact paths");
  const invalidPreset = await page.evaluate(async()=> {
    const preset={id:"validation-only",name:"",draft:{prompt:"local-only",negativePrompt:"",promptDocument:null},model:"nai-diffusion-4-5-full",width:512,height:512,steps:1,guidance:5,sampler:"k_euler",seed:null,strength:0.7,noise:0};
    try {await window.__TAURI_INTERNALS__.invoke("drawing_preset_save",{preset});return null;}
    catch(e){return e.code;}
  });
  assert.equal(invalidPreset,"invalid_input");
  const invalidDelete = await page.evaluate(async()=> {
    try {await window.__TAURI_INTERNALS__.invoke("drawing_preset_delete",{id:"../../invalid"});return null;}
    catch(e){return e.code;}
  });
  // Opening the store can fail before delete validation; neither outcome deletes user data.
  assert.ok(["invalid_input","storage_unavailable"].includes(invalidDelete));
  const invalidProfile = {id:"invalid-test",name:"validation-only",kind:"official",baseUrl:"https://wrong.example",generationPath:"/ai/generate-image",encodePath:"/ai/encode-vibe",generationUsd:null,encodingUsd:null};
  const profileError = await page.evaluate(async profile=>{try{await window.__TAURI_INTERNALS__.invoke("connection_save",{profile});return null;}catch(e){return e.code;}},invalidProfile);
  assert.equal(profileError,"connection_invalid");
  const handle = page.getByRole("separator", {name:"调整提示词与预览宽度",exact:true});
  const beforeWidth=await handle.getAttribute("aria-valuenow");
  await handle.focus();await handle.press("ArrowRight");
  assert.ok(Number(await handle.getAttribute("aria-valuenow")) > Number(beforeWidth));await handle.dblclick();
  const promptHeight=page.getByRole("separator",{name:"调整正向输入区高度",exact:true});
  const beforeHeight=Number(await promptHeight.getAttribute("aria-valuenow"));
  await promptHeight.focus();await promptHeight.press("ArrowDown");assert.equal(Number(await promptHeight.getAttribute("aria-valuenow")),beforeHeight+20);await promptHeight.dblclick();
  if(process.env.NATIVE_WORKBENCH_SCREENSHOT)await page.screenshot({path:process.env.NATIVE_WORKBENCH_SCREENSHOT,fullPage:true});
  await page.getByLabel("正向提示词").fill("local native UI smoke only");
  assert.equal(await page.getByRole("button",{name:"生成图像",exact:true}).isEnabled(),true);
  // Validation occurs before credentials or transport initialization. Must reject.
  const input=JSON.parse(readFileSync(new URL("../contracts/generation-v1.fixture.json",import.meta.url),"utf8")).input;
  input.confirmPaid=false;
  input.draft.promptDocument={mode:"raw",raw:"native smoke body",stylePrompt:"artist:synthetic",blocks:[]};
  input.draft.prompt="artist:synthetic,\nnative smoke body";
  const refusal=await page.evaluate(async input=>{try{await window.__TAURI_INTERNALS__.invoke("generation_submit",{input});return null;}catch(e){return {code:e.code,message:e.message};}},input);
  assert.equal(refusal.code,"confirmation_required");
  assert.equal(await page.getByRole("button",{name:"设置",exact:true}).count(),1);
  assert.equal(await page.getByRole("button",{name:"连接与任务",exact:true}).count(),0);
  await page.getByLabel("画师串",{exact:true}).fill("artist:synthetic");
  assert.equal(await page.getByText("图生图（i2i）",{exact:true}).count(),0);
  assert.equal(await page.locator(".connection-toolbar select").count(),0);
  // Read only the history shape; never print prompts or images.
  const historyShape=await page.evaluate(async()=>{
      try {
        const h=await window.__TAURI_INTERNALS__.invoke("history_list",{query:{limit:1,before:null}});
        return {itemsArray:Array.isArray(h.items)};
      } catch(e) {
        return {itemsArray:false,errorCode:typeof e?.code==="string"?e.code:"unexpected_ipc_error"};
      }
    });
  assert.ok(historyShape.itemsArray || historyShape.errorCode === "storage_unavailable", "History IPC must be permitted, even if storage is unavailable");
  console.log(`INFO: native storage: connection=${metadata.shape ? "available" : metadata.errorCode}; presets=${presetRead.shape ? "available" : presetRead.errorCode}; history=${historyShape.itemsArray ? "available" : historyShape.errorCode}.`);
  if(process.env.NATIVE_SMOKE_STORAGE==="1") assert.equal(historyShape.itemsArray,true,`Native storage smoke failed: ${historyShape.errorCode||"invalid_history_shape"}`);
  await page.getByRole("button",{name:"关于",exact:true}).click();
  await page.getByRole("heading",{name:"NAITools"}).waitFor();
  await page.getByText("运行诊断",{exact:true}).click();
  assert.equal(await page.getByText("tauri",{exact:true}).count(),1);
  if(process.env.NATIVE_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.NATIVE_SMOKE_SCREENSHOT});
  // Catch delayed white-screen/exit regressions, not just first render.
  await page.waitForTimeout(5000);
  assert.equal((await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("desktop_bootstrap"))).runtime,"tauri");
  assert.deepEqual(errors,[]);
  console.log("PASS: release WebView2 render, IPC 2 native handshake, local prompt/resize editing, connection/preset/metadata ACL and validation and unconfirmed-generation rejection. No credential reads or paid submissions; not a performance benchmark.");
}finally{await browser.close();}
