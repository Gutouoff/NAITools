import type {DrawingPreset} from "./types.ts";
import type { BootInfo,EditorDraft,HistoryPage,HistoryQuery,GenerationInput,GenerationResult,ImageAsset,VibeAsset,EncodeInput,TaskRecord,ConnectionProfile,ConnectionStatus } from "./types.ts";
import {DesktopError,normalizeError} from "./types.ts";
export type Invoke = <T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
export interface DesktopApi {
  bootstrap():Promise<BootInfo>;markReady():Promise<BootInfo>;loadDraft():Promise<EditorDraft>;saveDraft(draft:EditorDraft):Promise<void>;
  listHistory(query:HistoryQuery):Promise<HistoryPage>;historyRequest(id:string):Promise<GenerationInput>;submitGeneration(input:GenerationInput):Promise<GenerationResult>;
  credentialsStatus():Promise<boolean>;setToken(token:string):Promise<void>;deleteToken():Promise<void>;
  importImage(base64:string):Promise<ImageAsset>;encodeVibe(input:EncodeInput):Promise<VibeAsset>;readArtifact(id:string,thumbnail?:boolean):Promise<string>;exportArtifact(id:string):Promise<boolean>;
  listConnections(checkCredentials?:boolean):Promise<ConnectionStatus[]>;saveConnection(profile:ConnectionProfile):Promise<void>;deleteConnection(id:string):Promise<void>;
  setConnectionToken(id:string,token:string):Promise<void>;deleteConnectionToken(id:string):Promise<void>;
  listDrawingPresets():Promise<DrawingPreset[]>;saveDrawingPreset(preset:DrawingPreset):Promise<void>;deleteDrawingPreset(id:string):Promise<void>;
  listTasks():Promise<TaskRecord[]>;acknowledgeTask(id:string):Promise<void>;
}
export function mapDraft(d:EditorDraft):EditorDraft {
  const mapped:EditorDraft={prompt:d.prompt,negativePrompt:d.negativePrompt};
  if(d.promptDocument) mapped.promptDocument={mode:d.promptDocument.mode,raw:d.promptDocument.raw,blocks:d.promptDocument.blocks.map(b=>({id:b.id,title:b.title,enabled:b.enabled,text:b.text}))};
  return mapped;
}
export function mapGeneration(i:GenerationInput):GenerationInput {return {...(i.connectionId?{connectionId:i.connectionId}:{}),draft:mapDraft(i.draft),model:i.model,mode:i.mode,width:i.width,height:i.height,steps:i.steps,guidance:i.guidance,sampler:i.sampler,seed:i.seed,imageId:i.imageId,strength:i.strength,noise:i.noise,vibes:i.vibes.map(v=>({encodingId:v.encodingId,strength:v.strength})),confirmPaid:i.confirmPaid};}
export function mapDrawingPreset(p:DrawingPreset):DrawingPreset{return {id:p.id,name:p.name,draft:mapDraft(p.draft),model:p.model,width:p.width,height:p.height,steps:p.steps,guidance:p.guidance,sampler:p.sampler,seed:p.seed,strength:p.strength,noise:p.noise};}
export function nativeApi(invoke:Invoke):DesktopApi {
  async function call<T>(command:string,args?:Record<string,unknown>):Promise<T>{try{return await invoke<T>(command,args);}catch(e){throw normalizeError(e);}}
  return {
    async bootstrap(){const b=await call<BootInfo>("desktop_bootstrap");if(b.schemaVersion!==2)throw new DesktopError("schema_mismatch","本地接口版本不兼容，请更新界面与宿主。",false);return b;},markReady:()=>call("desktop_mark_ready"),
    loadDraft:()=>call("draft_load"),saveDraft:d=>call("draft_save",{draft:mapDraft(d)}),listHistory:q=>call("history_list",{query:{limit:q.limit??50,before:q.before??null}}),historyRequest:id=>call("history_request",{id}),
    submitGeneration:input=>call("generation_submit",{input:mapGeneration(input)}),credentialsStatus:()=>call("credentials_status"),setToken:token=>call("credentials_set",{token}),deleteToken:()=>call("credentials_delete"),
    importImage:base64=>call("image_import",{base64}),encodeVibe:i=>call("vibe_encode",{input:{...(i.connectionId?{connectionId:i.connectionId}:{}),imageId:i.imageId,model:i.model,informationExtracted:i.informationExtracted,confirmPaid:i.confirmPaid}}),
    listConnections:(checkCredentials=true)=>call("connections_list",{checkCredentials}),saveConnection:profile=>call("connection_save",{profile}),deleteConnection:id=>call("connection_delete",{id}),
    setConnectionToken:(id,token)=>call("connection_token_set",{id,token}),deleteConnectionToken:id=>call("connection_token_delete",{id}),
    listDrawingPresets:()=>call("drawing_presets_list"),saveDrawingPreset:preset=>call("drawing_preset_save",{preset:mapDrawingPreset(preset)}),deleteDrawingPreset:id=>call("drawing_preset_delete",{id}),
    readArtifact:(id,thumbnail=false)=>call("artifact_read",{id,thumbnail}),exportArtifact:id=>call("artifact_export",{id}),listTasks:()=>call("task_list"),acknowledgeTask:id=>call("task_acknowledge",{id})
  };
}
export function previewApi():DesktopApi {
  const boot:BootInfo={schemaVersion:2,appVersion:"0.1.0",runtime:"browser_preview",storage:"unavailable",hostElapsedMs:null,rendererReadyHostMs:null,naiContract:{verification:"unverified",generationEnabled:false,reason:"浏览器仅预览 UI；没有 Rust 宿主，也不会访问 NovelAI。",evidenceFile:"contracts/novelai-evidence.json"}};
  const unavailable=async():Promise<never>=>{throw new DesktopError("native_unavailable","浏览器预览不提供原生存储或付费接口；请在 PC 程序中使用。",false);};
  return {bootstrap:async()=>boot,markReady:async()=>boot,loadDraft:unavailable,saveDraft:unavailable,listHistory:unavailable,historyRequest:unavailable,submitGeneration:unavailable,credentialsStatus:unavailable,setToken:unavailable,deleteToken:unavailable,importImage:unavailable,encodeVibe:unavailable,readArtifact:unavailable,exportArtifact:unavailable,listConnections:unavailable,saveConnection:unavailable,deleteConnection:unavailable,setConnectionToken:unavailable,deleteConnectionToken:unavailable,listDrawingPresets:unavailable,saveDrawingPreset:unavailable,deleteDrawingPreset:unavailable,listTasks:unavailable,acknowledgeTask:unavailable};
}
let api:DesktopApi|undefined;
export async function getDesktopApi():Promise<DesktopApi>{if(api)return api;const {isTauri,invoke}=await import("@tauri-apps/api/core");api=isTauri()?nativeApi(invoke):previewApi();return api;}
