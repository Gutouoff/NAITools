// Optional UI smoke test. Requires Playwright supplied by the developer environment.
// No browser downloads, accounts, existing browser profiles, or NovelAI requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:1420";
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const external = []; const errors = [];
await context.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.startsWith(origin + "/") || url.startsWith("data:")) await route.continue();
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
  await page.getByLabel("负向提示词").fill("local negative draft");
  assert.equal(await page.getByRole("button", { name: "保存草稿" }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "生成图像（仅桌面端）" }).isEnabled(), false);
  assert.equal(await page.getByLabel("导入图生图底图", {exact:true}).isEnabled(), false);
  assert.equal(await page.getByLabel("添加氛围参考", {exact:true}).isEnabled(), false);
  await page.getByRole("button", {name:"分层编辑",exact:true}).click();
  await resizePrompt("画师", "调整画师高度");
  await page.getByLabel("画师",{exact:true}).fill("1.5::artist::, repeated, repeated,");
  await page.getByLabel("角色数量与身份",{exact:true}).fill("{subject}");
  await page.getByText("查看提交文本",{exact:true}).click();
  assert.equal(await page.getByTestId("compiled-prompt").textContent(), "1.5::artist::, repeated, repeated,\n{subject}");
  await page.getByRole("button",{name:"原文编辑",exact:true}).click();
  assert.equal(await page.getByLabel("正向提示词").inputValue(),"smoke-test local draft");
  await page.getByRole("button",{name:/连接与任务/}).click();
  await page.getByRole("heading",{name:"连接配置"}).waitFor();
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
  assert.equal(await page.getByLabel("负向提示词").inputValue(), "local negative draft");
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
      if(command === "connection_token_set")return;
      if(command === "credentials_status"){
        if(window.__SMOKE_CASE__ === "credentials-failed")throw {code:"credentials_unavailable",message:"测试：凭据读取失败。",retryable:false};
        return true;
      }
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
  await mocked.getByRole("button",{name:"连接与任务",exact:true}).click();
  await mocked.getByText(/NovelAI 官方 · 凭据已保存/).waitFor();
  await mocked.getByText("任务记录未读取，不能视为没有待核对任务。",{exact:true}).waitFor();
  assert.equal(await mocked.getByText("暂无任务记录。",{exact:true}).count(),0);
  await mocked.evaluate(()=>{window.__SMOKE_CASE__="credentials-failed";});
  await mocked.getByRole("button",{name:"工作台",exact:true}).click();
  await mocked.getByRole("button",{name:"连接与任务",exact:true}).click();
  await mocked.getByText("暂无任务记录。",{exact:true}).waitFor();
  await mocked.getByText(/NovelAI 官方 · 凭据状态不可读/).waitFor();
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
  await mocked.getByRole("button", {name:"连接与任务", exact:true}).click();
  await mocked.getByRole("button", {name:"添加中转站", exact:true}).click();
  await mocked.getByLabel("配置名称", {exact:true}).fill("Synthetic relay");
  await mocked.getByLabel("服务地址", {exact:true}).fill("https://relay.example");
  await mocked.getByLabel("生图接口路径", {exact:true}).fill("/documented/generate");
  await mocked.getByLabel("单图预计费用（美元）", {exact:true}).fill("0.02");
  await mocked.getByRole("button", {name:"保存配置", exact:true}).click();
  await mocked.getByText("连接配置已保存。密钥请在下方单独保存。", {exact:true}).waitFor();
  await mocked.getByLabel("API Key / Persistent API Token", {exact:true}).fill("synthetic-test-only-not-a-real-key");
  await mocked.getByRole("button", {name:"保存凭据", exact:true}).click();
  await mocked.getByText("凭据已保存；输入框已清空。", {exact:true}).waitFor();
  assert.equal(await mocked.getByLabel("API Key / Persistent API Token", {exact:true}).inputValue(), "");
  await mocked.getByRole("button", {name:"工作台", exact:true}).click();
  await mocked.getByLabel("生成连接", {exact:true}).selectOption({label:"Synthetic relay"});
  await mocked.getByRole("button", {name:"生成图像", exact:true}).click();
  await mocked.getByRole("dialog").getByText(/预计生成费 \$0.020/).waitFor();
  await mocked.getByRole("button", {name:"取消", exact:true}).click();
  assert.equal(await mocked.evaluate(()=>window.__SMOKE_CALLS__.filter(c=>c==="generation_submit"||c==="vibe_encode").length),0);
  await mocked.close();
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
  console.log("PASS: pointer/keyboard column and raw/layered/negative textarea resize, optional layout storage, 1440/1101/900px layouts, multi-profile editing and synthetic IPC failure/confirmation handling; no external HTTP requests or page errors.");
} finally { await context.close(); await browser.close(); }
