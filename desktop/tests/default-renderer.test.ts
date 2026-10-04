import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
test("default desktop build loads the frozen original renderer, never the custom prompt editor", () => {
 const config = JSON.parse(read("../src-tauri/tauri.conf.json"));
 const pkg = JSON.parse(read("../package.json"));
 assert.equal(config.build.frontendDist, "../dist-langbai");
 assert.equal(config.app.windows[0].decorations, false);
 assert.match(pkg.scripts.build, /typecheck:langbai/);
 assert.match(read("../vite.config.ts"), /import langbai from/);
 assert.ok(read("../compat/main.ts").includes('import("../langbai/src/main")'));
 assert.ok(!read("../compat/main.ts").includes('src/App')); assert.ok(!read("../compat/main.ts").includes('src/styles'));
});
