import {test} from "node:test";
import assert from "node:assert/strict";
import {SIZE_PRESETS,makeDrawingPreset,applyDrawingPreset,localParameterError,readSelectedConnection,rememberConnection} from "../src/features/generation-tools.ts";
import {mapDrawingPreset,nativeApi} from "../src/platform/desktop-api.ts";
import {readFileSync} from "node:fs";
import type {GenerationInput,DrawingPreset} from "../src/platform/types.ts";
const fixture=JSON.parse(readFileSync(new URL("../contracts/generation-v1.fixture.json",import.meta.url),"utf8")).input as GenerationInput;
test("resolution shortcuts fit the local generation safety limits",()=>{
  for(const size of SIZE_PRESETS)assert.equal(localParameterError({...fixture,...size}),null);
  for(const p of [{width:1536,height:1536},{width:257},{steps:0},{steps:2.5},{guidance:NaN},{seed:4294967296},{noise:2}])assert.ok(localParameterError({...fixture,...p}));
  assert.equal(localParameterError({...fixture,seed:0}),null);assert.equal(localParameterError({...fixture,seed:4294967295}),null);
});
test("named presets exclude account routing, references and paid consent",()=>{
  const source={...fixture,connectionId:"account-b",imageId:"input-a",vibes:[{encodingId:"vibe-a",strength:0.5}],confirmPaid:true};
  const preset=makeDrawingPreset(source,"preset-a","  portrait  ");
  assert.equal(preset.name,"portrait");for(const key of ["connectionId","imageId","vibes","confirmPaid","token"])assert.equal(key in preset,false);
  preset.draft.prompt="changed";assert.notEqual(source.draft.prompt,"changed");
  const polluted={...preset,connectionId:"wrong-account",imageId:"wrong-image",vibes:[{encodingId:"wrong",strength:1}],confirmPaid:true} as DrawingPreset;
  const applied=applyDrawingPreset({...source,mode:"i2i"},polluted);
  assert.equal(applied.connectionId,"account-b");assert.equal(applied.imageId,"input-a");assert.equal(applied.mode,"i2i");assert.equal(applied.confirmPaid,false);assert.deepEqual(applied.vibes,[]);
  const mapped=mapDrawingPreset(polluted);assert.equal("connectionId" in mapped,false);assert.equal("confirmPaid" in mapped,false);
});
test("preset IPC maps only whitelisted fields and never submits a generation",async()=>{
  const calls:{command:string,args?:Record<string,unknown>}[]=[];
  const api=nativeApi(async<T>(command:string,args?:Record<string,unknown>)=>{calls.push({command,args});return [] as T;});
  const p=makeDrawingPreset(fixture,"preset-a","test");await api.listDrawingPresets();await api.saveDrawingPreset(p);await api.deleteDrawingPreset(p.id);
  assert.deepEqual(calls.map(c=>c.command),["drawing_presets_list","drawing_preset_save","drawing_preset_delete"]);assert.deepEqual(calls[1].args,{preset:p});
});
test("account-selection preference fails safely when localStorage is unavailable",()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  try {
    Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>{throw new Error("denied");},setItem:()=>{throw new Error("denied");}}});
    assert.equal(readSelectedConnection(),"default-novelai");assert.doesNotThrow(()=>rememberConnection("account-b"));
    const data=new Map<string,string>();Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)}});
    rememberConnection("account-b");assert.equal(readSelectedConnection(),"account-b");
    rememberConnection("https://not-an-id");assert.equal(readSelectedConnection(),"default-novelai");
  }finally{if(descriptor)Object.defineProperty(globalThis,"localStorage",descriptor);else Reflect.deleteProperty(globalThis,"localStorage");}
});


import { applyArtistString, clearPromptDraft, readPromptRetention, rememberPromptRetention } from "../src/features/generation-tools.ts";
import { newPromptDocument, compilePrompt } from "../src/features/prompt.ts";
function draft(style: string, body: string, negative: string) {
  const document = { ...newPromptDocument(body), stylePrompt: style };
  return { prompt: compilePrompt(document), negativePrompt: negative, promptDocument: document };
}
test("configuration retention preserves edited artist strings and negative prompts, including intentional empty values", () => {
  const current = { ...fixture, draft: draft("artist:current", "current body", "current negative"), connectionId: "account-b", imageId: "source", confirmPaid: true };
  const preset = makeDrawingPreset({ ...fixture, draft: draft("artist:preset", "preset body", "preset negative") }, "retention", "Retained");
  for (const style of [true, false]) for (const negative of [true, false]) {
    const applied = applyDrawingPreset(current, preset, { style, negative });
    assert.equal(applied.draft.promptDocument?.stylePrompt, style ? "artist:current" : "artist:preset");
    assert.equal(applied.draft.promptDocument?.raw, "preset body");
    assert.equal(applied.draft.negativePrompt, negative ? "current negative" : "preset negative");
    assert.equal(applied.draft.prompt, compilePrompt(applied.draft.promptDocument!));
    assert.equal(applied.connectionId, current.connectionId);
    assert.equal(applied.imageId, current.imageId);
    assert.equal(applied.confirmPaid, false);
  }
  const empty = applyDrawingPreset({ ...current, draft: draft("", "body", "") }, preset, { style: true, negative: true });
  assert.equal(empty.draft.prompt, "preset body");
  assert.equal(empty.draft.negativePrompt, "");
  assert.equal(current.draft.promptDocument.stylePrompt, "artist:current");
  assert.equal(preset.draft.promptDocument?.stylePrompt, "artist:preset");
});
test("artist-only application and prompt clearing keep routing, image references and sampling parameters", () => {
  const current = { ...fixture, draft: draft("artist:current", "body", "negative"), vibes: [{ encodingId: "cache", strength: 0.5 }], confirmPaid: true };
  const preset = makeDrawingPreset({ ...fixture, draft: draft("artist:preset", "preset body", "preset negative"), steps: 3 }, "artist", "Artist");
  const applied = applyArtistString(current, preset);
  assert.equal(applied.draft.prompt, "artist:preset,\nbody");
  assert.equal(applied.draft.negativePrompt, "negative");
  assert.equal(applied.steps, current.steps);
  assert.deepEqual(applied.vibes, current.vibes);
  assert.equal(applied.confirmPaid, false);
  const cleared = clearPromptDraft(current, { style: true, negative: true });
  assert.equal(cleared.draft.prompt, "artist:current");
  assert.equal(cleared.draft.negativePrompt, "negative");
  assert.deepEqual(cleared.vibes, current.vibes);
  assert.equal(clearPromptDraft(current, { style: false, negative: false }).draft.prompt, "");
});
test("legacy artist layer preservation uses explicit structure, never tag inference", () => {
  const document = { mode: "layered" as const, raw: "inactive", blocks: [{ id: "block-1", title: "画师", enabled: true, text: "artist:legacy" }, { id: "block-2", title: "角色", enabled: true, text: "body" }] };
  const current = { ...fixture, draft: { prompt: compilePrompt(document), negativePrompt: "", promptDocument: document } };
  assert.equal(clearPromptDraft(current, { style: true, negative: false }).draft.prompt, "artist:legacy");
  const raw = { ...current, draft: { ...current.draft, prompt: "inactive", promptDocument: { ...document, mode: "raw" as const } } };
  assert.equal(clearPromptDraft(raw, { style: true, negative: false }).draft.prompt, "");
  assert.equal(raw.draft.promptDocument.blocks[0].text, "artist:legacy");
});
test("retention flags are optional preferences and contain no prompt content", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    let saved = "";
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } } });
    assert.deepEqual(readPromptRetention(), { style: true, negative: true });
    rememberPromptRetention({ style: false, negative: true });
    assert.equal(saved, '{"style":false,"negative":true}');
    assert.deepEqual(readPromptRetention(), { style: false, negative: true });
    saved = '{"style":"yes","negative":false}';
    assert.deepEqual(readPromptRetention(), { style: true, negative: true });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
