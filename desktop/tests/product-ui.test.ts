import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
test("workbench removes promotional and architecture-only chrome",()=>{
  const app=read("src/App.tsx"),bench=read("src/features/Workbench.tsx");
  assert.doesNotMatch(app,/Rust \+ Tauri|把精力留给创作|CREATIVE SPACE|LIGHTWEIGHT DESKTOP|PC PREVIEW|轻量 CSS/);
  assert.doesNotMatch(bench,/READY WHEN YOU ARE|从一个画面开始|结果会由 Rust/);
  assert.match(bench,/采样步数/);assert.match(bench,/提示词引导强度/);assert.match(bench,/随机种子（Seed）/);
});
test("project license retains full original copyright and permission text",()=>{
  const original=readFileSync(new URL("../../LICENSE",import.meta.url),"utf8");
  assert.equal(read("licenses/PROJECT-LICENSE.txt").replace(/\r\n/g,"\n"),original.replace(/\r\n/g,"\n"));
  assert.match(read("src/features/Diagnostics.tsx"),/PROJECT-LICENSE\.txt\?raw/);
});
