import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLangbaiBridge, IMPLEMENTED_METHODS, SUBSCRIPTIONS } from "../compat/desktop-bridge.ts";
import type { Invoke } from "../src/platform/desktop-api.ts";
import { DesktopError } from "../src/platform/types.ts";
const defaults=JSON.parse(readFileSync(new URL("../crates/studio-core/src/langbai-defaults.json",import.meta.url),"utf8"));
const contract=JSON.parse(readFileSync(new URL("../compat/langbai-api-members.json",import.meta.url),"utf8"));
test("every required original contract member is present, without invented methods",()=>{
 const bridge=createLangbaiBridge(async()=>{throw Error("unexpected IPC");});
 assert.ok(Object.isFrozen(bridge.api));
 assert.deepEqual(Object.keys(bridge.api).sort(),contract.filter((m:{optional:boolean})=>!m.optional).map((m:{name:string})=>m.name).sort());
 assert.equal(bridge.api.platform,"win32");
 assert.equal(IMPLEMENTED_METHODS.length,32);
 assert.equal(bridge.api.onStudioAgentRequest,undefined);
 for(const name of SUBSCRIPTIONS) {
  const remove=(bridge.api[name as keyof typeof bridge.api] as (callback:()=>void)=>()=>void)(()=>{throw Error("fake progress");});
  assert.equal(typeof remove,"function"); remove(); remove();
 }
 bridge.dispose();
});
test("original settings use explicit commands; artist strings remain settings, not credentials",async()=>{
 const calls:Array<{command:string;args?:Record<string,unknown>}>=[];
 const settings=structuredClone(defaults);
 const invoke:Invoke=async <T>(command:string,args?:Record<string,unknown>)=>{
  calls.push({command,args});
  if(command==="langbai_settings_get") return structuredClone(settings) as T;
  if(command==="langbai_setting_set") {settings[args!.key as string]=args!.value;return args!.value as T;}
  if(command==="credentials_status")return false as T;
  if(command==="langbai_window_action")return undefined as T;
  throw Error("Unexpected command");
 };
 const {api,startDragging}=createLangbaiBridge(invoke);
 assert.equal(await api.isFirstRun(),true);
 await api.setSetting("savedStylePrompt","artist:example");
 assert.equal(await api.getSetting("savedStylePrompt"),"artist:example");
 assert.deepEqual(await api.completeSetup(),{ok:true}); assert.equal(await api.isFirstRun(),false);
 assert.deepEqual(await api.accountCached(),{hasToken:false,stale:true});
 await api.minimize(); await api.maximize(); await startDragging(); await api.close();
 assert.deepEqual(calls.filter(c=>c.command==="langbai_window_action").map(c=>c.args!.action),["minimize","maximize","startDragging","close"]);
});
test("storage failures retain their error and never trigger default success or retry",async()=>{
 let calls=0;
 const bridge=createLangbaiBridge(async()=>{calls++;throw {code:"storage_access_denied",message:"无法打开或写入本地数据；请求不会自动重试。",retryable:false};});
 await assert.rejects(bridge.api.getSettings(),(e:unknown)=>e instanceof DesktopError && e.code==="storage_access_denied");
 assert.equal(calls,1);
 await assert.rejects(bridge.api.completeSetup(),(e:unknown)=>e instanceof DesktopError && e.code==="storage_access_denied");
 assert.equal(calls,2);
});
test("unported native and paid methods reject without invoking any service",async()=>{
 let calls=0; const {api}=createLangbaiBridge(async()=>{calls++;throw Error("must not invoke");});
 for(const name of ["storedToken","verifyToken","generate","generateCompatible","importReferencePresets","runAutomaticBackup"]) {
  assert.equal(typeof (api as unknown as Record<string,unknown>)[name],"function",name);
  await assert.rejects((api as unknown as Record<string,()=>Promise<unknown>>)[name](),(e:unknown)=>e instanceof DesktopError && e.code==="langbai_api_unavailable");
 }
 assert.equal(calls,0);
 assert.throws(()=>api.startImageDrag("C:\\private\\image.png"),/尚未接入 Rust/);
});

test("built-in reverse defaults are original versioned resources, independent of edited settings",async()=>{
 const expected=JSON.parse(readFileSync(new URL("../compat/langbai-reverse-defaults.json",import.meta.url),"utf8"));
 let calls=0;const {api}=createLangbaiBridge(async()=>{calls++;throw Error("No native call for packaged constants");});
 const first=await api.getReverseTemplateDefaults();assert.deepEqual(first,expected);
 first.tags="edited";assert.deepEqual(await api.getReverseTemplateDefaults(),expected);assert.equal(calls,0);
});
