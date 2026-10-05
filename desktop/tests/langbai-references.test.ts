import test from "node:test";
import assert from "node:assert/strict";
import { createLangbaiBridge } from "../compat/desktop-bridge.ts";
import type { Invoke } from "../src/platform/desktop-api.ts";
const row = { id: "preset-1", name: "参考预设", group: "分组一", kind: "vibe", extension: "png", createdAtMs: 1000,
  infoExtracted: 0.7, strength: 0.4, preciseType: "character&style", fidelity: 0.8, informationExtracted: 1, width: 2, height: 3 };
test("original reference library uses on-demand owned URLs and restores saved parameters", async () => {
  const calls: { command: string; args?: Record<string,unknown> }[] = [];
  const invoke: Invoke = async <T>(command:string,args?:Record<string,unknown>) => {
    calls.push({command,args});
    if (command === "langbai_reference_read") return {preset:structuredClone(row),base64:"cG5n"} as T;
    return {groups:["分组一"],presets:[structuredClone(row)]} as T;
  };
  const {api} = createLangbaiBridge(invoke);
  const library = await api.listReferencePresets();
  assert.equal(library.presets[0].fileUrl,"http://naitools-image.localhost/imports/preset-1.png");
  assert.equal(library.presets[0].filePath,"naitools://imports/preset-1.png");
  assert.equal(library.presets[0].createdAt,"1970-01-01T00:00:01.000Z");
  assert.ok(!JSON.stringify(library).includes("base64"));
  const result = await api.readReferencePreset("preset-1");assert.equal(result.ok,true);
  assert.equal(result.base64,"cG5n");assert.equal(result.preset!.infoExtracted,0.7);assert.equal(result.preset!.strength,0.4);assert.equal(result.preset!.fidelity,0.8);
  await api.saveReferencePreset({name:"参考预设",kind:"vibe",base64:"cG5n",infoExtracted:0.7,strength:0.4});
  await api.createReferencePresetGroup("分组二");await api.moveReferencePresetToGroup("preset-1","分组二");await api.deleteReferencePresetGroup("分组二");await api.deleteReferencePreset("preset-1");
  assert.deepEqual(calls.filter(c=>c.command==="langbai_reference_edit").map(c=>c.args),[
    {action:"create_group",id:null,group:"分组二"}, {action:"move",id:"preset-1",group:"分组二"}, {action:"delete_group",id:null,group:"分组二"}, {action:"delete",id:"preset-1",group:null},
  ]);
  assert.ok(calls.every(c=>c.command.startsWith("langbai_reference")),"No generation, credentials or HTTP calls");
});
test("reference operations report failure to original handlers and never retry",async()=>{
  let calls=0;const {api}=createLangbaiBridge(async()=>{calls++;throw {code:"storage_access_denied",message:"无法打开或写入本地数据；请求不会自动重试。",retryable:false};});
  const result=await api.saveReferencePreset({name:"测试",kind:"vibe",base64:"cG5n"});
  assert.deepEqual(result,{ok:false,message:"无法打开或写入本地数据；请求不会自动重试。"});assert.equal(calls,1);
  assert.equal((await api.readReferencePreset("preset-1")).ok,false);assert.equal(calls,2);
  await assert.rejects(api.listReferencePresets());assert.equal(calls,3);
});
test("invalid native reference payloads cannot grant external media or synthesize defaults",async()=>{
  for (const changed of [{id:"../../private"},{extension:"svg"},{createdAtMs:NaN},{strength:1.2},{width:0},{kind:"unknown"},{preciseType:"unknown"}]) {
    const {api}=createLangbaiBridge(async <T>()=>({groups:[],presets:[{...row,...changed}]} as T));
    await assert.rejects(api.listReferencePresets());
  }
});
