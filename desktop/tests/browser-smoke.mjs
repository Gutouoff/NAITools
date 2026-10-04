// Optional UI smoke test. Requires Playwright supplied by the developer environment.
// No browser downloads, accounts, existing browser profiles, or NovelAI requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:1420";
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const external = []; const errors = [];
await context.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.startsWith(origin + "/") || url.startsWith("data:") || url.startsWith(`blob:${origin}/`)) await route.continue();
  else { external.push(url); await route.abort(); }
});
try {
  const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin); await page.getByText("浏览器预览：本地保存、素材导入与生成不可用。", { exact: true }).waitFor();
  await page.getByLabel("正向提示词").fill("smoke-test local draft");
  async function dragHandle(page, locator, dx, dy) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {steps: 6}); await page.mouse.up();
  }
  async function resizePrompt(label, handleName) {
    const textarea = page.getByLabel(label, {exact: true});
    const before = (await textarea.boundingBox()).height;
    const handle = page.getByRole("separator", {name: handleName, exact: true});
    await dragHandle(page, handle, 0, 50);
    assert.ok((await textarea.boundingBox()).height >= before + 45, `${label} pointer resize`);
    await handle.focus(); await handle.press("ArrowUp");
    assert.ok((await textarea.boundingBox()).height <= before + 35, `${label} keyboard resize`);
    await handle.dblclick(); assert.equal((await textarea.boundingBox()).height, before);
  }
  const editorDivider = page.getByRole("separator", {name: "调整提示词与预览宽度", exact: true});
  const controlsDivider = page.getByRole("separator", {name: "调整预览与参数宽度", exact: true});
  let widths = await page.evaluate(() => ({editor: document.querySelector(".editor-column").getBoundingClientRect().width, controls: document.querySelector(".controls-column").getBoundingClientRect().width}));
  await dragHandle(page, editorDivider, 70, 0);
  assert.ok(await page.evaluate(before => document.querySelector(".editor-column").getBoundingClientRect().width >= before + 60, widths.editor));
  await dragHandle(page, controlsDivider, -45, 0);
  assert.ok(await page.evaluate(before => document.querySelector(".controls-column").getBoundingClientRect().width >= before + 35, widths.controls));
  await controlsDivider.focus(); await controlsDivider.press("ArrowLeft");
  const savedRatios = await page.evaluate(() => localStorage.getItem("naitools.workbenchWidths"));
  await page.reload(); await page.getByLabel("正向提示词").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("naitools.workbenchWidths")), savedRatios);
  await editorDivider.dblclick();
  await resizePrompt("正向提示词", "调整正向输入区高度");
  await resizePrompt("负向提示词", "调整负向输入区高度");
  await page.getByLabel("正向提示词").fill("smoke-test local draft");
  await page.getByLabel("负向提示词",{exact:true}).fill("local negative draft");
  assert.equal(await page.getByRole("button", { name: "保存草稿" }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "生成图像（仅桌面端）" }).isEnabled(), false);
  assert.equal(await page.getByLabel("导入图生图底图", {exact:true}).isEnabled(), false);
  assert.equal(await page.getByLabel("添加氛围参考", {exact:true}).isEnabled(), false);
  await page.getByRole("button", {name:"分层编辑",exact:true}).click();
  await resizePrompt("画师串", "调整画师串高度");
  await page.getByLabel("画师串",{exact:true}).fill("1.5::artist::, repeated, repeated,");
  await page.getByLabel("角色数量与身份",{exact:true}).fill("{subject}");
  await page.getByText("查看提交文本",{exact:true}).click();
  assert.equal(await page.getByTestId("compiled-prompt").textContent(), "1.5::artist::, repeated, repeated,\n{subject}");
  await page.getByRole("button",{name:"原文编辑",exact:true}).click();
  assert.equal(await page.getByLabel("正向提示词").inputValue(),"smoke-test local draft");
  await page.getByRole("button",{name:"设置",exact:true}).click();
  await page.getByRole("heading",{name:"API 配置"}).waitFor();
  assert.equal(await page.getByLabel("API Key / Persistent API Token",{exact:true}).isEnabled(),false);
  assert.equal(await page.getByRole("button",{name:"保存凭据",exact:true}).isEnabled(),false);
  await page.getByRole("button", { name: "关于", exact:true }).click();
  await page.getByRole("heading", { name: "NAITools" }).waitFor();
  await page.getByText("运行诊断", {exact:true}).click();
  assert.equal(await page.getByText("browser_preview", { exact: true }).count(), 1);
  await page.getByText("开源许可", {exact:true}).click();
  await page.getByText("Copyright (c) 2026 Langbai", {exact:false}).waitFor();
  await page.getByRole("button", { name: /历史记录/ }).click();
  await page.getByText("浏览器预览无法查询原生数据库。", { exact: true }).waitFor();
  await page.getByRole("button", { name: /工作台/ }).click();
  assert.equal(await page.getByLabel("正向提示词").inputValue(), "smoke-test local draft");
  assert.equal(await page.getByLabel("负向提示词",{exact:true}).inputValue(), "local negative draft");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.equal(await page.getByText("Rust + Tauri", {exact:true}).count(),0);
  const generateBox=await page.getByRole("button",{name:"生成图像（仅桌面端）",exact:true}).boundingBox();
  assert.ok(generateBox&&generateBox.y>=0&&generateBox.y+generateBox.height<=900,"Generate action should remain within viewport");
  await page.setViewportSize({width:1101,height:800});
  assert.ok(await page.evaluate(() => {
    const width = name => document.querySelector(name).getBoundingClientRect().width;
    return width(".editor-column") >= 260 && width(".controls-column") >= 220 && width(".result-column") >= 240 && document.documentElement.scrollWidth <= window.innerWidth;
  }), "Smallest three-column layout retains every minimum without overflow");
  await page.setViewportSize({width:1440,height:900});
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT, fullPage: true });
  await page.setViewportSize({ width: 900, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const compactBox=await page.getByRole("button",{name:"生成图像（仅桌面端）",exact:true}).boundingBox();
  assert.ok(compactBox&&compactBox.y+compactBox.height<=900,"Compact layout must retain a visible generate action");
  assert.ok(await page.evaluate(() => {
    const prompt = document.querySelector(".prompt-editor").getBoundingClientRect();
    const negative = document.querySelector(".negative-panel").getBoundingClientRect();
    const compiled = document.querySelector(".prompt-preview").getBoundingClientRect();
    return compiled.bottom <= prompt.bottom && prompt.bottom <= negative.top;
  }), "Compact editor sections must not overlap");
  await page.getByRole("button", {name:"保存草稿",exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await page.getByRole("button", {name:"保存草稿",exact:true}).isVisible());
  if(process.env.COMPACT_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.COMPACT_SMOKE_SCREENSHOT,fullPage:true});
  await page.setViewportSize({width:900,height:640});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  const minimumBox=await page.getByRole("button",{name:"生成图像（仅桌面端）",exact:true}).boundingBox();
  assert.ok(minimumBox&&minimumBox.y>=0&&minimumBox.y+minimumBox.height<=640,"Minimum PC window must retain a visible generate action");
  // Synthetic IPC only: exercise error UI without reading real credentials,
  // touching persistent data, or sending any NovelAI request.
  const mocked = await context.newPage(); mocked.on("pageerror", e => errors.push(e.message));
  await mocked.addInitScript(() => {
    window.isTauri = true; window.__SMOKE_CASE__ = "storage-failed"; window.__SMOKE_CALLS__ = [];
    const profile = {id:"default-novelai", name:"NovelAI 默认账号", kind:"official", baseUrl:"https://image.novelai.net", generationPath:"/ai/generate-image", encodePath:"/ai/encode-vibe", generationUsd:null, encodingUsd:null};
    window.__SMOKE_PROFILES__ = [profile];
    const boot = {schemaVersion:2,appVersion:"0.1.0",runtime:"tauri",storage:"isolated_sqlite_lazy",hostElapsedMs:1,rendererReadyHostMs:1,naiContract:{verification:"observed_subset",generationEnabled:true,reason:"synthetic IPC test",evidenceFile:"contracts/novelai-evidence.json"}};
    window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
      window.__SMOKE_CALLS__.push(command);
      if(command === "desktop_bootstrap" || command === "desktop_mark_ready")return boot;
      if(command === "connections_list")return window.__SMOKE_PROFILES__.map(profile => ({profile, hasToken: window.__SMOKE_CASE__ === "credentials-failed" ? null : true}));
      if(command === "connection_save"){window.__SMOKE_PROFILES__ = [...window.__SMOKE_PROFILES__.filter(p=>p.id!==args.profile.id), args.profile]; return;}
      if(command === "connection_token_set"){
        if(window.__SMOKE_TOKEN_FAIL__) throw {code:"credentials_unavailable",message:"测试：凭据保存失败。",retryable:false};
        return;
      }
      if(command === "credentials_status"){
        if(window.__SMOKE_CASE__ === "credentials-failed")throw {code:"credentials_unavailable",message:"测试：凭据读取失败。",retryable:false};
        return true;
      }
      if(command === "drawing_presets_list") return window.__SMOKE_PRESETS__??[];
      if(command === "drawing_preset_save"){window.__SMOKE_PRESETS__=[...(window.__SMOKE_PRESETS__??[]).filter(p=>p.id!==args.preset.id),args.preset];return;}
      if(command === "drawing_preset_delete"){window.__SMOKE_PRESETS__=(window.__SMOKE_PRESETS__??[]).filter(p=>p.id!==args.id);return;}
      if(command === "image_import"){window.__SMOKE_IMAGE_NUMBER__=(window.__SMOKE_IMAGE_NUMBER__??0)+1;return {id:"input-"+window.__SMOKE_IMAGE_NUMBER__,width:256,height:256,previewUrl:"data:image/png;base64,"+args.base64};}
      if(command === "history_list"){
        window.__SMOKE_HISTORY_QUERIES__ = [...(window.__SMOKE_HISTORY_QUERIES__ ?? []), args.query];
        if(args.query.before && window.__SMOKE_HISTORY_FAIL__) throw {code:"storage_unavailable",message:"测试：下一页读取失败。",retryable:false};
        const items = [
          {id:"history-03",createdAtMs:172800000,prompt:"synthetic history newest",artifactId:"history-artifact-03"},
          {id:"history-02",createdAtMs:86400000,prompt:"synthetic history middle",artifactId:"history-artifact-02"},
          {id:"history-01",createdAtMs:1,prompt:"synthetic history oldest",artifactId:"history-artifact-01"},
        ];
        return args.query.before ? {items:items.slice(1),nextCursor:null} : {items:items.slice(0,2),nextCursor:{createdAtMs:86400000,id:"history-02"}};
      }
      if(command === "artifact_read"){
        if(args.thumbnail && args.id === "history-artifact-02") throw {code:"artifact_missing",message:"测试：缩略图缺失。",retryable:false};
        return "data:image/png;base64," + window.__SMOKE_PNG__;
      }
      if(command === "artifact_metadata") return {width:256,height:256,format:"PNG",entries:args.id === "history-artifact-03" ? [{key:"Comment",value:'{"prompt":"synthetic metadata only","seed":42}'}] : []};
      if(command === "artifact_export"){
        if(window.__SMOKE_EXPORT_FAIL__) throw {code:"storage_unavailable",message:"测试：图像导出失败。",retryable:false};
        return true;
      }
      if(command === "generation_submit"&&window.__SMOKE_ALLOW_RESULT__){window.__SMOKE_SUBMITTED__=args.input;return {taskId:"mock-task",artifactId:"mock-output",seed:42,imageUrl:"data:image/png;base64,"+window.__SMOKE_PNG__};}
      if(command === "task_list"){
        if(window.__SMOKE_CASE__ === "storage-failed")throw {code:"storage_unavailable",message:"测试：存储不可用。",retryable:false};
        if(window.__SMOKE_CASE__ === "unresolved")return [{id:"test-unknown",kind:"generation",state:"outcome_unknown",createdAtMs:1,acknowledged:false,errorCode:null}];
        return [];
      }
      throw new Error(`Unexpected test IPC: ${command}`);
    }};
  });
  await mocked.goto(origin);
  await mocked.getByLabel("正向提示词").fill("synthetic IPC smoke only");
  await mocked.getByRole("button",{name:"生成图像",exact:true}).click();
  await mocked.getByRole("alert").filter({hasText:"测试：存储不可用。"}).waitFor();
  assert.equal(await mocked.getByRole("dialog").count(),0);
  await mocked.getByRole("button",{name:"设置",exact:true}).click();
  await mocked.getByText(/NovelAI 官方 · 凭据已保存/).waitFor();
  await mocked.getByRole("button",{name:"付费任务记录",exact:true}).click();
  await mocked.getByText("任务记录未读取，不能视为没有待核对任务。",{exact:true}).waitFor();
  assert.equal(await mocked.getByText("暂无任务记录。",{exact:true}).count(),0);
  await mocked.evaluate(()=>{window.__SMOKE_CASE__="credentials-failed";});
  await mocked.getByRole("button",{name:"工作台",exact:true}).click();
  await mocked.getByRole("button",{name:"设置",exact:true}).click();
  await mocked.getByText(/NovelAI 官方 · 凭据状态不可读/).waitFor();
  await mocked.getByRole("button",{name:"付费任务记录",exact:true}).click();
  await mocked.getByText("暂无任务记录。",{exact:true}).waitFor();
  await mocked.evaluate(()=>{window.__SMOKE_CASE__="unresolved";});
  await mocked.getByRole("button",{name:"工作台",exact:true}).click();
  await mocked.getByRole("button",{name:"生成图像",exact:true}).click();
  await mocked.getByRole("alert").filter({hasText:"存在未核对的付费任务"}).waitFor();
  assert.equal(await mocked.getByRole("dialog").count(),0);
  await mocked.evaluate(()=>{window.__SMOKE_CASE__="ready";});
  await mocked.getByRole("button",{name:"生成图像",exact:true}).click();
  await mocked.getByRole("dialog").waitFor();
  await mocked.getByRole("button",{name:"取消",exact:true}).click();
  assert.equal(await mocked.getByRole("dialog").count(),0);
  assert.equal(await mocked.evaluate(()=>window.__SMOKE_CALLS__.filter(c=>c==="generation_submit"||c==="vibe_encode").length),0);
  await mocked.getByRole("button", {name:"设置", exact:true}).click();
  await mocked.getByRole("button", {name:"添加第三方提供商", exact:true}).click();
  assert.equal(await mocked.getByLabel("API Key / Persistent API Token", {exact:true}).isEnabled(), true, "New unsaved profiles must allow credential entry");
  await mocked.getByLabel("API Key / Persistent API Token", {exact:true}).fill("synthetic-test-only-not-a-real-key");
  await mocked.getByLabel("配置名称", {exact:true}).fill("Synthetic relay");
  await mocked.getByLabel("服务地址", {exact:true}).fill("https://relay.example");
  await mocked.getByLabel("图像生成接口路径", {exact:true}).fill("/documented/generate");
  await mocked.getByLabel("单图预计费用（美元）", {exact:true}).fill("0.02");
  await mocked.getByRole("button", {name:"保存配置", exact:true}).click();
  await mocked.getByText("连接配置已保存。密钥请在下方单独保存。", {exact:true}).waitFor();
  await mocked.getByLabel("API Key / Persistent API Token", {exact:true}).fill("synthetic-test-only-not-a-real-key");
  await mocked.evaluate(()=>{window.__SMOKE_TOKEN_FAIL__ = true;});
  await mocked.getByRole("button", {name:"保存凭据", exact:true}).click();
  await mocked.getByRole("alert").filter({hasText:"测试：凭据保存失败。"}).waitFor();
  assert.equal(await mocked.getByLabel("API Key / Persistent API Token", {exact:true}).inputValue(), "synthetic-test-only-not-a-real-key", "Failed credential saves preserve input");
  await mocked.evaluate(()=>{window.__SMOKE_TOKEN_FAIL__ = false;});
  await mocked.getByRole("button", {name:"保存凭据", exact:true}).click();
  await mocked.getByText("配置与凭据已保存；输入框已清空。", {exact:true}).waitFor();
  assert.equal(await mocked.getByLabel("API Key / Persistent API Token", {exact:true}).inputValue(), "");
  await mocked.getByLabel("当前 API 配置", {exact:true}).selectOption({label:"Synthetic relay"});
  await mocked.getByRole("button", {name:"工作台", exact:true}).click();
  await mocked.getByRole("button", {name:"生成图像", exact:true}).click();
  await mocked.getByRole("dialog").getByText(/预计生成费 \$0.020/).waitFor();
  await mocked.getByRole("button", {name:"取消", exact:true}).click();
  assert.equal(await mocked.evaluate(()=>window.__SMOKE_CALLS__.filter(c=>c==="generation_submit"||c==="vibe_encode").length),0);
  // Production UI interactions against explicit synthetic IPC only: no server requests or real credentials.
  await mocked.getByRole("button",{name:"交换宽高",exact:true}).click();
  assert.equal(await mocked.getByLabel("宽度（px）",{exact:true}).inputValue(),"1216");
  await mocked.getByLabel("尺寸预设",{exact:true}).selectOption("小方图");
  assert.equal(await mocked.getByLabel("宽度（px）",{exact:true}).inputValue(),"512");
  await mocked.getByRole("button",{name:"固定 Seed",exact:true}).click();
  assert.equal(await mocked.getByLabel("随机种子（Seed）",{exact:true}).inputValue(),"0");
  await mocked.getByRole("button",{name:"随机 Seed",exact:true}).click();
  assert.equal(await mocked.getByLabel("随机种子（Seed）",{exact:true}).inputValue(),"");
  await mocked.locator(".drawing-presets > summary").click();
  await mocked.getByLabel("画师串",{exact:true}).fill("1.2::artist:saved::");
  await mocked.getByLabel("负向提示词",{exact:true}).fill("saved negative");
  await mocked.getByLabel("新配置名称",{exact:true}).fill("Drawing smoke preset");
  await mocked.getByRole("button",{name:"保存为新配置",exact:true}).click();
  await mocked.getByLabel("当前绘图配置",{exact:true}).locator("option",{hasText:"Drawing smoke preset"}).waitFor({state:"attached"});
  await mocked.getByLabel("正向提示词",{exact:true}).fill("changed prompt");
  await mocked.getByLabel("画师串",{exact:true}).fill("1.5::artist:current::");
  await mocked.getByLabel("负向提示词",{exact:true}).fill("current negative");
  mocked.once("dialog",d=>d.accept());
  await mocked.getByRole("button",{name:"应用绘图配置",exact:true}).click();
  assert.equal(await mocked.getByLabel("正向提示词",{exact:true}).inputValue(),"synthetic IPC smoke only");
  assert.equal(await mocked.locator(".connection-toolbar strong").textContent(), "Synthetic relay");
  assert.equal(await mocked.getByLabel("画师串",{exact:true}).inputValue(), "1.5::artist:current::");
  assert.equal(await mocked.getByLabel("负向提示词",{exact:true}).inputValue(), "current negative");
  mocked.once("dialog",d=>d.accept());
  await mocked.getByRole("button",{name:"仅应用画师串",exact:true}).click();
  assert.equal(await mocked.getByLabel("画师串",{exact:true}).inputValue(), "1.2::artist:saved::");
  assert.equal(await mocked.getByLabel("正向提示词",{exact:true}).inputValue(), "synthetic IPC smoke only");
  mocked.once("dialog",d=>d.accept());
  await mocked.getByRole("button",{name:"清空提示词",exact:true}).click();
  assert.equal(await mocked.getByLabel("正向提示词",{exact:true}).inputValue(), "");
  assert.equal(await mocked.getByLabel("画师串",{exact:true}).inputValue(), "1.2::artist:saved::");
  assert.equal(await mocked.getByLabel("负向提示词",{exact:true}).inputValue(), "current negative");
  await mocked.getByLabel("正向提示词",{exact:true}).fill("synthetic IPC smoke only");
  await mocked.getByLabel("保留画师串",{exact:true}).uncheck();
  await mocked.getByLabel("画师串",{exact:true}).fill("artist:replace-me");
  mocked.once("dialog",d=>d.accept());
  await mocked.getByRole("button",{name:"应用绘图配置",exact:true}).click();
  assert.equal(await mocked.getByLabel("画师串",{exact:true}).inputValue(), "1.2::artist:saved::");
  await mocked.getByLabel("保留画师串",{exact:true}).check();
  assert.equal(await mocked.getByRole("button",{name:"创建配置",exact:true}).count(), 0);
  assert.equal(await mocked.getByText("图生图（i2i）",{exact:true}).count(), 0);
  // API management stays inside Settings; duplicating metadata never duplicates a credential.
  await mocked.getByRole("button",{name:"API 设置",exact:true}).click();
  await mocked.getByRole("button",{name:"复制配置",exact:true}).click();
  const editor=mocked.locator(".connections-panel");
  await editor.getByLabel("配置名称",{exact:true}).waitFor();
  assert.equal(await editor.getByLabel("配置名称",{exact:true}).inputValue(),"Synthetic relay 副本");
  assert.equal(await editor.getByLabel("API Key / Persistent API Token",{exact:true}).inputValue(),"");
  assert.equal(await editor.getByRole("button",{name:"使用此配置",exact:true}).isEnabled(),false);
  await editor.getByRole("button",{name:"保存配置",exact:true}).click();
  await editor.getByText("连接配置已保存。密钥请在下方单独保存。",{exact:true}).waitFor();
  await editor.getByRole("button",{name:"使用此配置",exact:true}).click();
  assert.equal(await mocked.getByLabel("当前 API 配置",{exact:true}).locator("option:checked").textContent(),"Synthetic relay 副本");
  assert.equal(await mocked.evaluate(()=>localStorage.getItem("naitools.activeConnection")),await mocked.getByLabel("当前 API 配置",{exact:true}).inputValue());
  await mocked.getByRole("button",{name:"工作台",exact:true}).click();
  const png=await mocked.evaluate(()=>{const canvas=document.createElement("canvas");canvas.width=canvas.height=256;const c=canvas.getContext("2d");c.fillStyle="#d4ebe4";c.fillRect(0,0,256,256);window.__SMOKE_PNG__=canvas.toDataURL("image/png").split(",")[1];return window.__SMOKE_PNG__;});
  await mocked.getByLabel("导入图生图底图",{exact:true}).setInputFiles({name:"synthetic-source.png",mimeType:"image/png",buffer:Buffer.from(png,"base64")});
  await mocked.getByAltText("图生图底图",{exact:true}).waitFor();
  assert.equal(await mocked.getByLabel("启用图生图",{exact:true}).isChecked(),true);
  await mocked.getByRole("group",{name:"添加参考图拖放与粘贴区",exact:true}).evaluate((zone,base64)=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],"synthetic-vibe.png",{type:"image/png"}));zone.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));},png);
  await mocked.getByAltText("氛围参考 1",{exact:true}).waitFor();
  await mocked.getByRole("button",{name:"移除参考 1",exact:true}).click();
  await mocked.getByRole("group",{name:"添加参考图拖放与粘贴区",exact:true}).evaluate((zone,base64)=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],"synthetic-paste.png",{type:"image/png"}));zone.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:dt}));},png);
  await mocked.getByAltText("氛围参考 1",{exact:true}).waitFor();
  await mocked.getByRole("button",{name:"移除参考 1",exact:true}).click();
  await mocked.evaluate(()=>{window.__SMOKE_ALLOW_RESULT__=true;});
  await mocked.getByRole("button",{name:"生成图像",exact:true}).click();
  await mocked.getByRole("dialog").getByText(/连接：Synthetic relay 副本/).waitFor();
  await mocked.getByRole("button",{name:"确认并提交一次",exact:true}).click();
  await mocked.getByAltText("NovelAI 生成结果",{exact:true}).waitFor();
  assert.equal(await mocked.evaluate(()=>window.__SMOKE_SUBMITTED__.connectionId),await mocked.evaluate(()=>localStorage.getItem("naitools.activeConnection")));
  await mocked.getByRole("button",{name:"放大预览",exact:true}).click();
  await mocked.getByText("125%",{exact:true}).waitFor();
  const stage=mocked.locator(".image-stage");
  const stageBox=await stage.boundingBox();assert.ok(stageBox);
  await mocked.mouse.move(stageBox.x+stageBox.width/2,stageBox.y+stageBox.height/2);
  await mocked.keyboard.down("Control");await mocked.mouse.wheel(0,-120);await mocked.keyboard.up("Control");
  await mocked.getByText("138%",{exact:true}).waitFor();
  await mocked.mouse.down();await mocked.mouse.move(stageBox.x+stageBox.width/2+30,stageBox.y+stageBox.height/2+20);await mocked.mouse.up();
  assert.ok((await mocked.getByAltText("NovelAI 生成结果",{exact:true}).getAttribute("style")).includes("translate(30px, 20px)"));
  await mocked.getByRole("button",{name:"适应窗口",exact:true}).click();
  await mocked.getByRole("button",{name:"复用 Seed",exact:true}).click();
  assert.equal(await mocked.getByLabel("随机种子（Seed）",{exact:true}).inputValue(),"42");
  await mocked.getByRole("button",{name:"用作底图",exact:true}).click();
  await mocked.getByText("已将生成结果导入为图生图底图，尚未发送新请求。",{exact:true}).waitFor();
  assert.equal(await mocked.evaluate(()=>window.__SMOKE_CALLS__.filter(c=>c==="generation_submit").length),1);
  assert.equal(await mocked.evaluate(()=>window.__SMOKE_CALLS__.filter(c=>c==="vibe_encode").length),0);
  await mocked.locator(".drawing-presets > summary").click();
  await mocked.locator(".controls-column").evaluate(node=>{node.scrollTop=0;});
  if(process.env.DRAWING_SMOKE_SCREENSHOT)await mocked.screenshot({path:process.env.DRAWING_SMOKE_SCREENSHOT,fullPage:true});
  await mocked.getByRole("button",{name:"API 设置",exact:true}).click();
  await mocked.locator(".connections-panel").getByLabel("配置名称",{exact:true}).waitFor();
  await mocked.locator(".connections-panel").getByLabel("配置名称",{exact:true}).fill("Unsaved name");
  assert.equal(await mocked.getByRole("button",{name:"使用此配置",exact:true}).isEnabled(),false);
  await mocked.locator(".connections-panel").getByLabel("配置名称",{exact:true}).fill("Synthetic relay 副本");
  assert.equal(await mocked.getByRole("button",{name:"使用此配置",exact:true}).isEnabled(),true);
  if(process.env.CONNECTION_SMOKE_SCREENSHOT)await mocked.screenshot({path:process.env.CONNECTION_SMOKE_SCREENSHOT,fullPage:true});
  await mocked.getByRole("button",{name:"工作台",exact:true}).click();
  await mocked.getByRole("button", {name:"历史记录", exact:true}).click();
  await mocked.getByText("1 张缩略图读取失败；历史记录仍可浏览。", {exact:true}).waitFor();
  const records = mocked.locator(".history-card:not(.demo-card)");
  assert.equal(await records.count(), 2, "A missing thumbnail cannot hide history rows");
  await mocked.getByText("缩略图不可用", {exact:true}).waitFor();
  await records.filter({hasText:"synthetic history newest"}).click();
  await mocked.waitForFunction(() => {
    const image = document.querySelector(".detail-preview img");
    return image?.complete && image.naturalWidth === 256;
  });
  await mocked.locator(".metadata-list").getByText('{"prompt":"synthetic metadata only","seed":42}', {exact:true}).waitFor();
  await mocked.evaluate(()=>{window.__SMOKE_EXPORT_FAIL__ = true;});
  await mocked.getByRole("button", {name:"导出原始 PNG", exact:true}).click();
  await mocked.getByRole("alert").filter({hasText:"测试：图像导出失败。"}).waitFor();
  await mocked.evaluate(()=>{window.__SMOKE_HISTORY_FAIL__ = true;});
  await mocked.getByRole("button", {name:"加载更多", exact:true}).click();
  await mocked.getByRole("alert").filter({hasText:"测试：下一页读取失败。"}).waitFor();
  assert.equal(await records.count(), 2, "Failed next pages preserve loaded rows and cursor");
  await mocked.evaluate(()=>{window.__SMOKE_HISTORY_FAIL__ = false;});
  await mocked.getByRole("button", {name:"加载更多", exact:true}).click();
  await mocked.getByText("已加载 3 项", {exact:true}).waitFor();
  assert.equal(await records.count(), 3, "Appending history pages deduplicates stable IDs");
  assert.equal(await mocked.getByRole("button", {name:"加载更多", exact:true}).count(), 0);
  const queries = await mocked.evaluate(()=>window.__SMOKE_HISTORY_QUERIES__);
  assert.deepEqual(queries, [{limit:60,before:null}, {limit:60,before:{createdAtMs:86400000,id:"history-02"}}, {limit:60,before:{createdAtMs:86400000,id:"history-02"}}]);
  await records.filter({hasText:"synthetic history oldest"}).click();
  await mocked.getByText("未读取到 NovelAI 元数据。", {exact:true}).waitFor();
  assert.equal(await mocked.locator(".metadata-list").count(), 0, "Missing metadata must not retain another image's fields");
  if(process.env.HISTORY_SMOKE_SCREENSHOT) await mocked.screenshot({path:process.env.HISTORY_SMOKE_SCREENSHOT,fullPage:true});
  assert.equal(await mocked.evaluate(()=>window.__SMOKE_CALLS__.filter(c=>c==="generation_submit").length), 1);
  await mocked.close();
  // Real IndexedDB in an isolated browser context under the shipped CSP: no user data or API access.
  const library = await context.newPage();
  library.on("pageerror", e => errors.push(e.message));
  const csp = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security.csp;
  await library.route(origin + "/", async route => {
    const response = await route.fetch();
    await route.fulfill({response, headers:{...response.headers(), "content-security-policy":csp}});
  });
  await library.addInitScript(() => {
    window.__SMOKE_CSP__ = [];
    document.addEventListener("securitypolicyviolation", e => window.__SMOKE_CSP__.push(e.violatedDirective));
  });
  await library.goto(origin);
  await library.getByRole("button", {name:"参考预设库", exact:true}).click();
  await library.getByText("暂无氛围迁移文件。导入后可在此集中查看和维护。", {exact:true}).waitFor();
  const sample = readFileSync(new URL("../public/demo-history/demo-01.png", import.meta.url));
  await library.getByLabel("参考预设名称", {exact:true}).fill("Synthetic atmosphere preset");
  await library.getByLabel("参考预设备注", {exact:true}).fill("Local persistence test only");
  await library.getByLabel("导入参考预设文件", {exact:true}).setInputFiles({name:"synthetic-reference.png",mimeType:"image/png",buffer:sample});
  await library.locator(".reference-detail h3").filter({hasText:"Synthetic atmosphere preset"}).waitFor();
  await library.waitForFunction(() => {
    const image = document.querySelector(".reference-detail img");
    return image?.complete && image.naturalWidth > 0;
  });
  await library.getByRole("button", {name:"精准参考 0", exact:true}).click();
  assert.equal(await library.locator(".reference-detail").count(), 0, "Switching categories clears the unrelated detail panel");
  await library.getByLabel("导入参考预设文件", {exact:true}).setInputFiles({name:"synthetic-precise.png",mimeType:"image/png",buffer:sample});
  await library.locator(".reference-detail h3").filter({hasText:"synthetic-precise"}).waitFor();
  await library.reload();
  await library.getByRole("button", {name:"参考预设库", exact:true}).click();
  await library.getByRole("button", {name:"氛围迁移 1", exact:true}).waitFor();
  await library.getByRole("button", {name:"精准参考 1", exact:true}).waitFor();
  await library.locator(".reference-card").filter({hasText:"Synthetic atmosphere preset"}).click();
  await library.getByText("Local persistence test only", {exact:true}).waitFor();
  library.once("dialog", dialog => dialog.dismiss());
  await library.getByRole("button", {name:"删除预设", exact:true}).click();
  assert.equal(await library.locator(".reference-card").count(), 1, "Cancelled deletion preserves the preset");
  library.once("dialog", dialog => dialog.accept());
  await library.getByRole("button", {name:"删除预设", exact:true}).click();
  await library.getByText("暂无氛围迁移文件。导入后可在此集中查看和维护。", {exact:true}).waitFor();
  await library.getByLabel("导入参考预设文件", {exact:true}).setInputFiles({name:"not-supported.svg",mimeType:"image/svg+xml",buffer:Buffer.from("<svg/>")});
  await library.getByRole("alert").filter({hasText:"仅支持 PNG、JPEG 或 WebP 图像文件。"}).waitFor();
  await library.getByLabel("导入参考预设文件", {exact:true}).setInputFiles({name:"corrupt.png",mimeType:"image/png",buffer:Buffer.from("not an image")});
  await library.getByRole("alert").filter({hasText:"无法解码参考图像。"}).waitFor();
  assert.equal(await library.locator(".reference-card").count(), 0, "Invalid image files are not archived");
  await library.getByRole("button", {name:"精准参考 1", exact:true}).click();
  await library.locator(".reference-card").click();
  if(process.env.LIBRARY_SMOKE_SCREENSHOT) await library.screenshot({path:process.env.LIBRARY_SMOKE_SCREENSHOT, fullPage:true});
  assert.deepEqual(await library.evaluate(() => window.__SMOKE_CSP__), [], "Library previews must satisfy the native production CSP");
  await library.close();
  const deniedLibrary = await context.newPage();
  deniedLibrary.on("pageerror", e => errors.push(e.message));
  await deniedLibrary.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {get(){throw new DOMException("test denied", "SecurityError");}});
  });
  await deniedLibrary.goto(origin);
  await deniedLibrary.getByRole("button", {name:"参考预设库", exact:true}).click();
  await deniedLibrary.getByRole("alert").waitFor();
  assert.equal(await deniedLibrary.getByText("正在读取预设库…", {exact:true}).count(), 0);
  assert.equal(await deniedLibrary.locator(".library-empty").count(), 0, "Unavailable storage must not look like an empty library");
  await deniedLibrary.close();
  const deniedLayout = await context.newPage();
  deniedLayout.on("pageerror", e=>errors.push(e.message));
  await deniedLayout.addInitScript(() => {
    Storage.prototype.getItem = () => {throw new DOMException("test denied", "SecurityError");};
    Storage.prototype.setItem = () => {throw new DOMException("test denied", "SecurityError");};
  });
  await deniedLayout.goto(origin);
  await deniedLayout.getByLabel("正向提示词", {exact:true}).fill("layout preferences are optional");
  await deniedLayout.close();
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log("PASS: pointer/keyboard column and raw/layered/negative textarea resize, optional layout storage, 1440/1101/900px layouts, multi-profile switching/duplicate editor, drawing presets, resolution/seed controls, source import, atmosphere drop/paste and result viewer with synthetic IPC; reference import, category isolation, reload persistence, deletion, invalid images and storage failures under production CSP; history pagination, failed thumbnails/export and actual/absent metadata with synthetic IPC; no external HTTP requests or page errors.");
} catch(error) {
  for(const p of context.pages()) console.error("SMOKE failure state:",await p.evaluate(()=>({alerts:Array.from(document.querySelectorAll('[role="alert"]')).map(n=>n.textContent),calls:window.__SMOKE_CALLS__,presets:window.__SMOKE_PRESETS__})).catch(()=>null));
  throw error;
} finally { await context.close(); await browser.close(); }
