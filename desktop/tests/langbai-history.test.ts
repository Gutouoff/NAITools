import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryMethods, historyDateBounds, localHistoryDate } from "../compat/history.ts";
import type { Invoke } from "../src/platform/desktop-api.ts";
import { DesktopError, type GenerationInput } from "../src/platform/types.ts";
const input: GenerationInput = {
  connectionId: "account-test", draft: { prompt: "{artist:example}, 1girl, 1girl", negativePrompt: "lowres" },
  model: "nai-diffusion-4-5-full", mode: "txt2img", width: 832, height: 1216,
  steps: 28, guidance: 6, sampler: "k_euler_ancestral", seed: 0, imageId: null,
  strength: .7, noise: 0, vibes: [], confirmPaid: false,
};
const at = new Date(2026, 9, 5, 12).getTime();
const row = (id: string) => ({ id, artifactId: `image-${id}`, createdAtMs: at, groupId: null, request: structuredClone(input) });
const url = (id: string) => `http://naitools-image.localhost/${id}`;

test("history follows cursor pages, carries no image bytes and never splits saved captions", async () => {
  const calls: Array<{command: string; args?: Record<string, unknown>}> = [];
  const invoke: Invoke = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({command,args});
    const before = (args?.filter as {before: unknown}).before;
    return (before ? {items:[row("a")],nextCursor:null} : {items:[row("b")],nextCursor:{id:"b",createdAtMs:at}}) as T;
  };
  const api = createHistoryMethods(invoke,url);
  const items = await api.getHistory("2026-10-05", "__ungrouped");
  assert.deepEqual(items.map(i=>i.id),["b","a"]);
  assert.equal(items[0].filePath,"naitools://outputs/image-b.png");
  assert.equal(items[0].fileUrl,url("image-b"));
  assert.equal(items[0].actualSeed,0,"Seed zero is a valid saved seed, not random");
  assert.equal(items[0].params.seedMode,"fixed");
  assert.equal(items[0].params.stylePrompt,"");
  assert.equal(items[0].params.positivePrompt,input.draft.prompt);
  assert.equal(items[0].params.preservePromptText,true);
  assert.equal(items[0].params.qualityToggle,false);
  assert.equal(items[0].params.ucPreset,3,"Do not append an extra UC preset on replay");
  assert.equal(items[0].params.cfgRescale,0);
  assert.equal(JSON.stringify(items).includes("data:image"),false);
  assert.equal(JSON.stringify(items).includes("account-test"),false);
  assert.deepEqual(calls.map(c=>c.command),["langbai_history_page","langbai_history_page"]);
});
test("dates are local-calendar bounds with malformed dates rejected before IPC", async () => {
  assert.equal(localHistoryDate(at),"2026-10-05");
  assert.deepEqual(historyDateBounds("2026-10-05"),{fromMs:new Date(2026,9,5).getTime(),untilMs:new Date(2026,9,6).getTime()});
  for(const date of ["2026-02-30","2026-13-01","2026-1-01","../private","1969-01-01"]) assert.throws(()=>historyDateBounds(date),DesktopError);
  let calls=0;
  await assert.rejects(createHistoryMethods(async()=>{calls++;throw Error("No call");},url).getHistory("bad"),DesktopError);
  assert.equal(calls,0);
});
test("missing/corrupt receipts reject explicitly; records are not omitted or invented", async () => {
  for(const request of [null,{...input,seed:null},{...input,model:"unknown"}]) {
    let calls=0;
    const api=createHistoryMethods(async <T>()=>{calls++;return {items:[{...row("a"),request}],nextCursor:null} as T;},url);
    await assert.rejects(api.getHistory(),(e:unknown)=>e instanceof DesktopError && (e.code==="history_receipt_unavailable"||e.code==="history_response_invalid"));
    assert.equal(calls,1);
  }
});
test("duplicate pages/cursor cycles and oversized selections do not return truncated success",async()=>{
  let pages=0;
  const api=createHistoryMethods(async <T>()=>{pages++;return {items:[row("a")],nextCursor:{id:"a",createdAtMs:at}} as T;},url);
  await assert.rejects(api.getHistory(),/无效/);assert.equal(pages,2);
  let page=0;
  const large=createHistoryMethods(async <T>()=>{const items=Array.from({length:100},()=>row(`item-${page++}`));return {items,nextCursor:{id:items.at(-1)!.id,createdAtMs:at}} as T;},url);
  await assert.rejects(large.getHistory(),(e:unknown)=>e instanceof DesktopError && e.code==="history_result_too_large");
  assert.equal(page,5000);
});
test("group APIs preserve original argument/return contracts through explicit commands",async()=>{
  const calls:Array<{command:string;args?:Record<string,unknown>}>=[];
  const invoke:Invoke=async <T>(command:string,args?:Record<string,unknown>)=>{
    calls.push({command,args});
    if(command==="langbai_history_days")return [at,at] as T;
    if(command==="langbai_history_group_set")return undefined as T;
    return [{id:"group-a",name:"人物",createdAtMs:at}] as T;
  };
  const api=createHistoryMethods(invoke,url);
  assert.deepEqual(await api.getHistoryDates(),["2026-10-05"]);
  assert.equal((await api.getHistoryGroups())[0].createdAt,new Date(at).toISOString());
  await api.createHistoryGroup("人物");await api.renameHistoryGroup("group-a","场景");await api.deleteHistoryGroup("group-a");
  assert.deepEqual(await api.setHistoryGroup("a"),{ok:true});
  assert.deepEqual(calls.filter(c=>c.command==="langbai_history_group_edit").map(c=>c.args?.action),["create","rename","delete"]);
  assert.deepEqual(calls.at(-1)?.args,{id:"a",groupId:null});
});
test("storage errors are propagated without retry or fabricated empty libraries",async()=>{
  let calls=0;
  const api=createHistoryMethods(async()=>{calls++;throw new DesktopError("storage_access_denied","denied",false);},url);
  await assert.rejects(api.getHistoryGroups(),(e:unknown)=>e instanceof DesktopError&&e.code==="storage_access_denied");
  assert.equal(calls,1);
});
