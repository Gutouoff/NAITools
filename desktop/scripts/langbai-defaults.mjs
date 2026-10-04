// Evaluate ONLY the extracted pure defaults and their frozen pure helper modules.
// This tool never loads Electron, reads user configuration or calls any provider.
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const root=fileURLToPath(new URL("../",import.meta.url));
const cache=new Map();
function load(file) {
 if(cache.has(file)) return cache.get(file).exports;
 if(file.endsWith(".json")) {const module={exports:JSON.parse(readFileSync(file,"utf8"))};cache.set(file,module);return module.exports;}
 const module={exports:{}};
 cache.set(file,module);
 const source=readFileSync(file,"utf8");
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const localRequire=specifier=>{
  if(!specifier.startsWith(".")) throw new Error("Only pure relative source dependencies are allowed: "+specifier);
  const target=resolve(dirname(file),/\.(json|ts)$/.test(specifier)?specifier:specifier+".ts");
  if(!target.startsWith(resolve(root,"langbai/src")+sep)) throw new Error("Dependency outside frozen renderer");
  return load(target);
 };
 vm.runInThisContext("(function(require,module,exports){"+compiled+"\n})",{filename:file})(localRequire,module,module.exports);
 return module.exports;
}
const defaults=load(resolve(root,"compat/default-settings.ts")).defaultSettings();
const text=JSON.stringify(defaults,null,2)+"\n";
const output=resolve(root,"crates/studio-core/src/langbai-defaults.json");
if(process.argv.includes("--check")) {
 if(readFileSync(output,"utf8")!==text) throw new Error("Defaults drift; regenerate with npm run defaults:langbai");
} else writeFileSync(output,text);
const reverseDefaults=load(resolve(root,"langbai/src/data/prompt-templates.ts")).SCOPED_REVERSE_SYSTEM_PROMPTS;
const reverseText=JSON.stringify(reverseDefaults,null,2)+"\n";
const reverseOutput=resolve(root,"compat/langbai-reverse-defaults.json");
if(process.argv.includes("--check")) {
 if(readFileSync(reverseOutput,"utf8")!==reverseText)throw new Error("Built-in reverse template drift");
} else writeFileSync(reverseOutput,reverseText);
console.log("Langbai defaults:",Object.keys(defaults).length,"keys; no runtime credentials");
