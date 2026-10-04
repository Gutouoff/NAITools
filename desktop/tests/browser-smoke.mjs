// Optional UI smoke test. Requires Playwright supplied by the developer environment.
// No browser downloads, accounts, existing browser profiles, or NovelAI requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:1420";
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const external = []; const errors = [];
await context.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.startsWith(origin + "/") || url.startsWith("data:")) await route.continue();
  else { external.push(url); await route.abort(); }
});
try {
  const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin); await page.getByText("浏览器 UI 预览", { exact: true }).waitFor();
  await page.getByLabel("正向提示词").fill("smoke-test local draft");
  await page.getByLabel("负向提示词").fill("local negative draft");
  assert.equal(await page.getByRole("button", { name: "保存草稿" }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "生图仅在 PC 原生版可用" }).isEnabled(), false);
  assert.equal(await page.getByLabel("导入 i2i 底图", {exact:true}).isEnabled(), false);
  assert.equal(await page.getByLabel("添加氛围参考", {exact:true}).isEnabled(), false);
  await page.getByRole("button", {name:"分层编辑",exact:true}).click();
  await page.getByLabel("画师",{exact:true}).fill("1.5::artist::, repeated, repeated,");
  await page.getByLabel("角色数量与身份",{exact:true}).fill("{subject}");
  await page.getByText("查看实际提交的正向提示词",{exact:true}).click();
  assert.equal(await page.getByTestId("compiled-prompt").textContent(), "1.5::artist::, repeated, repeated,\n{subject}");
  await page.getByRole("button",{name:"原文编辑",exact:true}).click();
  assert.equal(await page.getByLabel("正向提示词").inputValue(),"smoke-test local draft");
  await page.getByRole("button",{name:/连接与任务/}).click();
  await page.getByRole("heading",{name:"NovelAI 连接"}).waitFor();
  assert.equal(await page.getByLabel("Persistent API Token",{exact:true}).isEnabled(),false);
  assert.equal(await page.getByRole("button",{name:"保存 Token",exact:true}).isEnabled(),false);
  await page.getByRole("button", { name: /框架状态/ }).click();
  await page.getByRole("heading", { name: "可核验的框架状态" }).waitFor();
  assert.equal(await page.getByText("browser_preview", { exact: true }).count(), 1);
  await page.getByRole("button", { name: /历史记录/ }).click();
  await page.getByText("浏览器预览无法查询原生数据库。", { exact: true }).waitFor();
  await page.getByRole("button", { name: /工作台/ }).click();
  assert.equal(await page.getByLabel("正向提示词").inputValue(), "smoke-test local draft");
  assert.equal(await page.getByLabel("负向提示词").inputValue(), "local negative draft");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT, fullPage: true });
  await page.setViewportSize({ width: 900, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log("PASS: production UI editing, lazy tabs, disabled paid/native actions, 1440/900px layouts; no external HTTP requests or page errors.");
} finally { await context.close(); await browser.close(); }
