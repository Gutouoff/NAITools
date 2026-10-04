// Renderer-only smoke tests. Synthetic IPC never enters user storage or providers.
import assert from "node:assert/strict";
import { imageFixture } from "./langbai-image-fixture.mjs";
const plainImage = imageFixture(); const metadataImage = imageFixture(true);
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const origin=(process.argv.includes("--origin") ? process.argv[process.argv.indexOf("--origin")+1] : process.env.LANGBAI_SMOKE_ORIGIN)||"http://127.0.0.1:1420";
const defaults=JSON.parse(readFileSync(new URL("../crates/studio-core/src/langbai-defaults.json",import.meta.url),"utf8"));
const csp=JSON.parse(readFileSync(new URL("../src-tauri/tauri.langbai.conf.json",import.meta.url),"utf8")).app.security.csp;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const external=[];const errors=[];const missingAssets=[];
await context.route("**/*",async route=>{
 const request=route.request();const url=request.url();
 if(!url.startsWith(origin+"/")&&!url.startsWith("data:")&&!url.startsWith("blob:"+origin+"/")) {external.push(url);return route.abort();}
 if(request.resourceType()==="document") {
  const response=await route.fetch();return route.fulfill({response,headers:{...response.headers(),"content-security-policy":csp}});
 }
 await route.continue();
});
try {
 const preview=await context.newPage();
 await preview.goto(origin+"/");
 await preview.getByText(/原版界面迁移预览未连接 Rust 宿主/).first().waitFor();
 assert.equal(await preview.locator(".title-bar").count(),0,"Browser must not fabricate successful settings boot");
 await preview.close();
 async function createFixture(failure=false) {
  const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  page.on("response",response=>{if(response.status()>=400)missingAssets.push(response.url());});
  await page.addInitScript(({defaults,failure,plainImage,metadataImage})=>{
   window.__LANGBAI_TEST_PICK__ = plainImage.image; window.__LANGBAI_TEST_META__ = metadataImage.image;
   window.__LANGBAI_TEST_SNAPSHOT__ = null;
   window.isTauri=true;window.__LANGBAI_TEST_CALLS__=[];window.__LANGBAI_TEST_SETTINGS__={...defaults,hasOnboarded:true};
   window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
    window.__LANGBAI_TEST_CALLS__.push({command,args});
    if(command==="langbai_settings_get") {
     if(failure)throw {code:"storage_access_denied",message:"无法打开或写入本地数据；请求不会自动重试。",retryable:false};
     return structuredClone(window.__LANGBAI_TEST_SETTINGS__);
    }
    if(command==="langbai_setting_set") {window.__LANGBAI_TEST_SETTINGS__[args.key]=args.value;return args.value;}
    if(command==="credentials_status")return false;
    if(command==="langbai_window_action")return;
    if(command==="langbai_image_pick")return window.__LANGBAI_TEST_PICK__;
    if(command==="langbai_image_read")return args.reference === metadataImage.image.filePath ? metadataImage.image : plainImage.image;
    if(command==="langbai_workbench_clear")return;
    if(command==="langbai_metadata_read") {
     const snapshot = args.reference === metadataImage.image.filePath ? metadataImage.snapshot : plainImage.snapshot;
     if(args.persist)window.__LANGBAI_TEST_SNAPSHOT__ = snapshot;
     return snapshot;
    }
    if(command==="langbai_metadata_save") {window.__LANGBAI_TEST_SNAPSHOT__=args.snapshot;return;}
    if(command==="langbai_metadata_load")return window.__LANGBAI_TEST_SNAPSHOT__;
    throw Error("Unexpected native command: "+command);
   }};
  },{defaults,failure,plainImage,metadataImage});
  await page.goto(origin+"/");return page;
 }
 const failed=await createFixture(true);
 await failed.getByText("无法打开或写入本地数据；请求不会自动重试。",{exact:true}).first().waitFor();
 assert.equal(await failed.locator(".title-bar").count(),0);
 await failed.close();
 const start=performance.now();const page=await createFixture();
 await page.locator(".title-bar").waitFor();
 console.log("Synthetic renderer startup ms:",Math.round(performance.now()-start),"(not native startup acceptance)");
 assert.match(await page.locator(".window-title").innerText(),/NAITools/);
 assert.doesNotMatch(await page.locator(".window-title").innerText(),/Langbai NovelAI Studio/);
 await page.waitForFunction(()=>{const e=document.querySelector(".title-icon");return e?.complete&&e.naturalWidth>0;});
 assert.ok(await page.locator(".title-icon").evaluate(e=>e.complete&&e.naturalWidth>0),"Original icon resolves from staging entrypoint");
 if(process.env.LANGBAI_SMOKE_DIAGNOSTIC) {
  console.log(await page.locator("body").innerText());
  console.log(await page.locator("textarea").evaluateAll(es=>es.map(e=>({placeholder:e.placeholder,label:e.getAttribute("aria-label"),class:e.className}))));
 }
 // Verify the captured original handlers, not a rewritten approximation.
 const workspace=page.locator(".workspace");
 const railWidth=async edge=>Number.parseInt(await workspace.evaluate((e,key)=>e.style.getPropertyValue(key),"--ws-"+edge),10);
 async function drag(locator,dx,dy=0) {
  await locator.scrollIntoViewIfNeeded();
  const box=await locator.boundingBox();assert.ok(box,"Resize target must be visible");
  // Use the central grip, away from the original reset button near the top.
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();
 }
 for(const edge of ["left","right"]) {
  const before=await railWidth(edge);const splitter=page.locator(".ws-resizer."+edge);
  await drag(splitter,edge==="left"?80:-80);
  await page.waitForFunction(({edge,before})=>Number.parseInt(document.querySelector(".workspace").style.getPropertyValue("--ws-"+edge),10)>before,{edge,before});
  assert.equal(await page.evaluate(edge=>Number(localStorage.getItem("langbai.ws."+edge)),edge),await railWidth(edge),"Rail width persists on release");
 }
 await page.locator(".ws-resizer.left").dblclick();
 assert.equal(await railWidth("left"),240);assert.equal(await railWidth("right"),240);
 await page.getByRole("button",{name:"单框编辑",exact:true}).click();
 const editor=page.locator(".prompt-editor").filter({has:page.locator(".prompt-resize-handle")}).first();
 const prompt=editor.locator("textarea").first();
 await prompt.fill("1girl, blue hair, test prompt");
 const handle=editor.locator(".prompt-resize-handle");
 await handle.focus();await handle.press("ArrowDown");
 assert.equal(await handle.getAttribute("aria-valuenow"),"260");
 await handle.press("Home");assert.equal(await handle.getAttribute("aria-valuenow"),"240");
 await drag(handle,0,70);
 assert.ok(Number(await handle.getAttribute("aria-valuenow"))>240,"Prompt pointer drag changes original editor height");
 await handle.dblclick();assert.equal(await handle.getAttribute("aria-valuenow"),"240");
 await page.getByRole("button",{name:"图生图",exact:true}).click();
 assert.ok(await page.getByRole("button",{name:"图生图",exact:true}).evaluate(e=>e.classList.contains("active")),"Image-to-image mode selected");
 assert.equal(await page.getByRole("button",{name:"文生图",exact:true}).evaluate(e=>e.classList.contains("active")),false);
 await page.getByRole("button",{name:"文生图",exact:true}).click();
 assert.equal(await page.getByRole("button",{name:"图生图",exact:true}).evaluate(e=>e.classList.contains("active")),false);
 await page.getByRole("button",{name:"单框编辑",exact:true}).click();
 assert.equal(await prompt.inputValue(),"1girl, blue hair, test prompt","Mode switch preserves original prompt state");
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.locator(".settings-nav").waitFor();
 if(process.env.LANGBAI_SMOKE_DIAGNOSTIC)console.log("Settings navigation:",await page.locator(".settings-nav").innerText());
 // Input must remain editable before any credential service is connected.
 const secret=page.locator('.settings-content input[type="password"]').first();
 await secret.fill("synthetic-not-a-real-credential");assert.equal(await secret.inputValue(),"synthetic-not-a-real-credential");
 await page.locator(".settings-nav button").filter({hasText:"外观"}).click();
 await page.locator(".settings-content").getByText("主题",{exact:true}).first().waitFor();
 const appearance=page.locator(".settings-content");
 await appearance.getByRole("button",{name:/^主题/}).click();
 await page.getByRole("option",{name:"深色",exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.classList.contains("theme-dark"));
 assert.equal(await page.evaluate(()=>window.__LANGBAI_TEST_SETTINGS__.theme),"dark","Original theme control reaches the explicit setting command");
 await page.locator(".modal.settings-modal header button").click();

 // Original workbench buttons must actually display imported images. Metadata
 // comes from the unchanged parser, not from a synthetic native metadata DTO.
 await page.getByRole("button",{name:"图生图",exact:true}).click();
 const upload = page.locator(".wb-upload:visible").first();
 await upload.getByRole("button",{name:"加载图片...",exact:true}).click();
 await page.waitForFunction(()=>{const e=document.querySelector(".wb-thumb");return e?.complete&&e.naturalWidth===64;});
 assert.equal(await page.evaluate(()=>document.querySelector(".wb-thumb").naturalHeight),48);
 const plainResult = await page.evaluate(async()=>window.naiDesktop.loadImageFromPath("naitools://imports/fixture-plain.png"));
 assert.equal("metadata" in plainResult,false,"Absent metadata must stay absent");
 await page.evaluate(()=>{window.__LANGBAI_TEST_PICK__=window.__LANGBAI_TEST_META__;});
 await upload.getByRole("button",{name:"重新加载",exact:true}).click();
 // Restoring V4.5 metadata legitimately opens the original V5 notice.
 // Dismiss through its original keep-current-model action, not a storage override.
 await page.locator(".v5-migration-notice").waitFor();
 await page.locator(".v5-migration-notice footer button").first().click();
 await page.locator(".v5-migration-notice").waitFor({state:"hidden"});
 const extracted = await page.evaluate(async()=>window.naiDesktop.loadImageFromPath("naitools://imports/fixture-meta.png"));
 assert.equal(extracted.metadata.imported.positivePrompt,"artist:fixture, 1girl, blue hair");
 assert.equal(extracted.metadata.imported.seed,42);
 const selectedImage = await upload.locator(".wb-thumb").getAttribute("src");
 const snapshotRoundTrip = await page.evaluate(async()=>{
  await window.naiDesktop.saveMetadataSnapshotFromPath("naitools://imports/fixture-meta.png");
  return window.naiDesktop.loadMetadataSnapshot();
 });
 assert.equal(snapshotRoundTrip.snapshot.base64,metadataImage.snapshot.base64,"Snapshot preserves original metadata bytes");
 await page.evaluate(async()=>window.naiDesktop.readMetadataSnapshotFromPath("naitools://imports/fixture-plain.png"));
 assert.equal(await upload.locator(".wb-thumb").getAttribute("src"),selectedImage,"Metadata reads cannot replace the workbench");
 await upload.getByRole("button",{name:"清除",exact:true}).click();
 await upload.getByRole("button",{name:"加载图片...",exact:true}).waitFor();
 await page.getByRole("button",{name:"文生图",exact:true}).click();

 // The native boundary is still incomplete. Calling a paid method must fail
 // locally, never return images or execute an unknown Rust command.
 const rejection=await page.evaluate(async()=>{
  try {await window.naiDesktop.generate({},{});return "unexpected success";}catch(e){return {code:e.code,message:e.message};}
 });
 assert.equal(rejection.code,"langbai_api_unavailable");
 assert.match(rejection.message,/未发送付费请求/);
 assert.equal(await page.evaluate(()=>window.__LANGBAI_TEST_CALLS__.some(c=>/generation|vibe|encode/.test(c.command))),false);
 if(process.env.LANGBAI_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.LANGBAI_SMOKE_SCREENSHOT,fullPage:true,animations:"disabled"});
 assert.deepEqual(external,[],"No external requests");assert.deepEqual(missingAssets,[],"No broken original assets");assert.deepEqual(errors,[],"No renderer crash");
 console.log("Langbai renderer smoke passed: explicit boot failures, original main screen, valid icon, splitters, prompt resizing, exclusive modes, settings navigation, full image display, original metadata parsing/snapshots and no paid side effects.");
} finally {await browser.close();}
