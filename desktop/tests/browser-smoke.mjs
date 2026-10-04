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
  await page.getByLabel("负向提示词").fill("local negative draft");
  assert.equal(await page.getByRole("button", { name: "保存草稿" }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "生成图像（仅桌面端）" }).isEnabled(), false);
  assert.equal(await page.getByLabel("导入图生图底图", {exact:true}).isEnabled(), false);
  assert.equal(await page.getByLabel("添加氛围参考", {exact:true}).isEnabled(), false);
  await page.getByRole("button", {name:"分层编辑",exact:true}).click();
  await page.getByLabel("画师",{exact:true}).fill("1.5::artist::, repeated, repeated,");
  await page.getByLabel("角色数量与身份",{exact:true}).fill("{subject}");
  await page.getByText("查看提交文本",{exact:true}).click();
  assert.equal(await page.getByTestId("compiled-prompt").textContent(), "1.5::artist::, repeated, repeated,\n{subject}");
  await page.getByRole("button",{name:"原文编辑",exact:true}).click();
  assert.equal(await page.getByLabel("正向提示词").inputValue(),"smoke-test local draft");
  await page.getByRole("button",{name:/连接与任务/}).click();
  await page.getByRole("heading",{name:"NovelAI 连接"}).waitFor();
  assert.equal(await page.getByLabel("Persistent API Token",{exact:true}).isEnabled(),false);
  assert.equal(await page.getByRole("button",{name:"保存 Token",exact:true}).isEnabled(),false);
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
    const boot = {schemaVersion:2,appVersion:"0.1.0",runtime:"tauri",storage:"isolated_sqlite_lazy",hostElapsedMs:1,rendererReadyHostMs:1,naiContract:{verification:"observed_subset",generationEnabled:true,reason:"synthetic IPC test",evidenceFile:"contracts/novelai-evidence.json"}};
    window.__TAURI_INTERNALS__ = {invoke: async command => {
      window.__SMOKE_CALLS__.push(command);
      if(command === "desktop_bootstrap" || command === "desktop_mark_ready")return boot;
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
  await mocked.getByText("已保存凭据",{exact:true}).waitFor();
  await mocked.getByText("任务记录未读取，不能视为没有待核对任务。",{exact:true}).waitFor();
  assert.equal(await mocked.getByText("暂无任务记录。",{exact:true}).count(),0);
  await mocked.evaluate(()=>{window.__SMOKE_CASE__="credentials-failed";});
  await mocked.getByRole("button",{name:"工作台",exact:true}).click();
  await mocked.getByRole("button",{name:"连接与任务",exact:true}).click();
  await mocked.getByText("暂无任务记录。",{exact:true}).waitFor();
  await mocked.getByRole("alert").filter({hasText:"测试：凭据读取失败。"}).waitFor();
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
  await mocked.close();
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log("PASS: production UI editing, lazy tabs, disabled paid/native actions, 1440/900px layouts, synthetic IPC failure/confirmation handling; no external HTTP requests or page errors.");
} finally { await context.close(); await browser.close(); }
