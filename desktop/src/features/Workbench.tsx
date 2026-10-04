import {useEffect,useRef,useState} from "react";
import type {DesktopApi} from "../platform/desktop-api";
import type {GenerationInput,GenerationResult,ImageAsset,VibeAsset} from "../platform/types";
import {normalizeError} from "../platform/types";
import PromptEditor from "./PromptEditor";
import {compilePrompt,newPromptDocument} from "./prompt";
interface Row {key:string;image?:ImageAsset;encoding?:VibeAsset;information:number;strength:number}
interface Confirmation {title:string;description:string;run:()=>Promise<void>}
function Confirm({value,onCancel,onAccept}:{value:Confirmation;onCancel:()=>void;onAccept:()=>void}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);return <dialog ref={ref} onCancel={onCancel} className="confirm-dialog"><h2>{value.title}</h2><p>{value.description}</p><p className="hint">请求可能消耗 Anlas；发生超时或未知结果不会自动重发。</p><div className="actions"><button autoFocus onClick={onCancel}>取消</button><button className="primary" onClick={onAccept}>确认并提交一次</button></div></dialog>;}
async function fileBase64(file:File){if(file.size>16*1024*1024)throw new Error("图片不得超过 16 MB。");return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("文件读取失败。"));reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.readAsDataURL(file);});}
export default function Workbench({api,native,input,setInput,replaySignal,onTasks}:{api:DesktopApi;native:boolean;input:GenerationInput;setInput:(i:GenerationInput)=>void;replaySignal:number;onTasks:()=>void}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[image,setImage]=useState<ImageAsset>(),[rows,setRows]=useState<Row[]>([]),[result,setResult]=useState<GenerationResult>(),[confirmation,setConfirmation]=useState<Confirmation>();
  const lock=useRef(false);
  useEffect(()=>{setRows(input.vibes.map((v,index)=>({key:`replay-${replaySignal}-${index}`,encoding:{id:v.encodingId,model:input.model,informationExtracted:-1,cacheHit:true},information:-1,strength:v.strength})));setImage(undefined);},[replaySignal]);
  const doc=input.draft.promptDocument??newPromptDocument(input.draft.prompt);
  function patch(p:Partial<GenerationInput>){setInput({...input,...p});}
  function updateRows(next:Row[]){setRows(next);patch({vibes:next.filter(r=>r.encoding).map(r=>({encodingId:r.encoding!.id,strength:r.strength}))});}
  async function run(operation:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError("");setMessage("");try{await operation();}catch(e){setError(e instanceof Error && !("code" in e)?e.message:normalizeError(e).message);}finally{lock.current=false;setBusy(false);}}
  async function load(){await run(async()=>{const draft=await api.loadDraft();patch({draft});setMessage("已读取本地草稿（仅提示词）。");});}
  async function save(){await run(async()=>{await api.saveDraft(input.draft);setMessage("提示词与分层草稿已保存；Token 不在草稿里。");});}
  async function importSource(file:File,vibe:boolean){await run(async()=>{const a=await api.importImage(await fileBase64(file));if(vibe)updateRows([...rows,{key:a.id,image:a,information:0.8,strength:0.5}]);else{setImage(a);patch({imageId:a.id,mode:"i2i"});}});}
  function ready(r:Row){return !!r.encoding&&r.encoding.model===input.model&&(r.information===-1||r.encoding.informationExtracted===r.information);}
  async function encode(row:Row,paid:boolean){let v:VibeAsset;try{v=await api.encodeVibe({imageId:row.image!.id,model:input.model,informationExtracted:row.information,confirmPaid:paid});}catch(e){if(paid)onTasks();throw e;}updateRows(rows.map(r=>r.key===row.key?{...r,encoding:v}:r));setMessage(v.cacheHit?"复用了本地氛围编码，没有发送收费请求。":"氛围编码已保存，之后可复用。");}
  function requestGenerate(){if(rows.some(r=>!ready(r))){setError("有氛围参考尚未编码或已过期。请显式编码，或移除该参考；不会静默忽略。");return;}if(input.mode==="i2i"&&!input.imageId){setError("请先导入 i2i 底图。");return;}if(rows.reduce((sum,r)=>sum+r.strength,0)>1.000001){setError("当前版本氛围总强度不得超过 1，不会自动改权重。");return;}
    const snapshot=structuredClone({...input,imageId:input.mode==="i2i"?input.imageId:null,vibes:rows.map(r=>({encodingId:r.encoding!.id,strength:r.strength})),confirmPaid:true});
    setConfirmation({title:"确认生成一张图片",description:`${input.model.includes("curated")?"V4.5 Curated":"V4.5 Full"} · ${input.width} × ${input.height} · ${input.steps} 步 · ${input.mode==="i2i"?"图生图":"文生图"} · ${rows.length} 个已编码氛围参考。实际费用由账户与 NAI 决定，本应用不承诺免费。`,run:async()=>{try{const r=await api.submitGeneration(snapshot);setResult(r);setMessage(`已保存结果。Seed: ${r.seed}`);}catch(e){onTasks();throw e;}}});
  }
  const disabled=busy||!!confirmation;
  return <><div className="workbench">
    <div className="editor-column"><PromptEditor doc={doc} disabled={disabled} onChange={d=>patch({draft:{...input.draft,promptDocument:d,prompt:compilePrompt(d)}})}/>
      <section className="panel"><label htmlFor="negative">负向提示词</label><textarea id="negative" className="negative" value={input.draft.negativePrompt} disabled={disabled} onChange={e=>patch({draft:{...input.draft,negativePrompt:e.target.value}})} spellCheck={false} placeholder="只发送这里输入的内容，不偷偷添加负面模板。"/><div className="actions"><button disabled={!native||disabled} onClick={()=>void load()}>读取草稿</button><button className="tonal" disabled={!native||disabled} onClick={()=>void save()}>保存草稿</button></div></section>
      <section className="panel"><div className="panel-heading"><h2>生成参数</h2><span className="chip">单张 · 非流式</span></div><fieldset disabled={disabled}><div className="field-grid">
        <label className="wide">模型<select value={input.model} onChange={e=>patch({model:e.target.value})}><option value="nai-diffusion-4-5-full">NAI V4.5 Full</option><option value="nai-diffusion-4-5-curated">NAI V4.5 Curated</option></select></label>
        <label>宽度<input type="number" min="256" max="1536" step="64" value={input.width} onChange={e=>patch({width:Number(e.target.value)})}/></label><label>高度<input type="number" min="256" max="1536" step="64" value={input.height} onChange={e=>patch({height:Number(e.target.value)})}/></label>
        <label>Steps<input type="number" min="1" max="28" value={input.steps} onChange={e=>patch({steps:Number(e.target.value)})}/></label><label>Guidance<input type="number" min="1" max="10" step="0.1" value={input.guidance} onChange={e=>patch({guidance:Number(e.target.value)})}/></label>
        <label>采样器<select value={input.sampler} onChange={e=>patch({sampler:e.target.value})}><option value="k_euler_ancestral">Euler a</option><option value="k_euler">Euler</option></select></label><label>Seed<input type="number" min="0" max="4294967295" value={input.seed??""} placeholder="留空为随机" onChange={e=>patch({seed:e.target.value===""?null:Number(e.target.value)})}/></label>
      </div><div className="presets"><button onClick={()=>patch({width:832,height:1216})}>竖图</button><button onClick={()=>patch({width:1216,height:832})}>横图</button><button onClick={()=>patch({width:1024,height:1024})}>方图</button></div></fieldset><p className="hint">本版保守范围：64 倍数、总像素 ≤ 1,048,576、最多 28 步。不是 NAI 全部限制；暂不支持多角色专属 caption。</p></section>
    </div>
    <div className="result-column"><section className="panel stage"><div className="panel-heading"><h2>图像结果</h2><span className="chip">{busy?"任务进行中":"READY WHEN YOU ARE"}</span></div><div className="image-stage">{result?<img src={result.imageUrl} alt="NovelAI 生成结果"/>:<div className="empty-stage"><div className="empty-symbol">✦</div><h3>从一个画面开始</h3><p>结果会由 Rust 验证、原样保存。<br/>这里不会用模拟图片冒充生图成功。</p></div>}</div>
      {result&&<div className="result-info"><span>Seed {result.seed}</span><button disabled={disabled} onClick={()=>void run(async()=>{const saved=await api.exportArtifact(result.artifactId);if(saved)setMessage("已导出原始 PNG（保留服务元数据）。");})}>导出 PNG</button></div>}
      <button className="primary generate" disabled={!native||disabled||!input.draft.prompt.trim()} onClick={requestGenerate}>{busy?"处理中，请勿重复提交…":native?"生成一张图片":"生图仅在 PC 原生版可用"}</button><p className="hint">不会自动编码、批量提交或重试。真实付费链路仍待单独验收。</p>
      {message&&<p role="status" className="success">{message}</p>}{error&&<div role="alert" className="error">{error}</div>}
    </section>
    <section className="panel"><div className="panel-heading"><h2>i2i · 图生图</h2><label className="toggle"><input type="checkbox" checked={input.mode==="i2i"} disabled={disabled} onChange={e=>patch({mode:e.target.checked?"i2i":"txt2img"})}/>启用</label></div><p className="hint">底图本地保存；生成时按目标比例中心裁剪，不拉伸。与氛围参考是两条不同路径。</p>
      <label className="file-control">导入 i2i 底图<input aria-label="导入 i2i 底图" type="file" accept="image/png,image/jpeg,image/webp" disabled={!native||disabled} onChange={e=>{const f=e.target.files?.[0];if(f)void importSource(f,false);e.target.value="";}}/></label>
      {image&&<img className="source-thumb" src={image.previewUrl} alt="i2i 底图"/>}{input.imageId&&!image&&<p className="hint">已恢复本地底图引用：{input.imageId}</p>}
      <div className="field-grid"><label>Strength · 改动强度<input type="number" min="0" max="1" step="0.05" value={input.strength} disabled={disabled} onChange={e=>patch({strength:Number(e.target.value)})}/></label><label>Noise · 噪声<input type="number" min="0" max="1" step="0.05" value={input.noise} disabled={disabled} onChange={e=>patch({noise:Number(e.target.value)})}/></label></div>
    </section>
    <section className="panel"><div className="panel-heading"><h2>氛围参考 · Vibe Transfer</h2><span className="chip">{rows.length}/4</span></div><p className="hint">V4+ 首次编码按官方说明消耗 2 Anlas。换模型或信息提取量需要新编码；相同素材、模型和提取量可复用本地缓存。</p>
      <label className="file-control">添加氛围参考<input aria-label="添加氛围参考" type="file" accept="image/png,image/jpeg,image/webp" disabled={!native||disabled||rows.length>=4} onChange={e=>{const f=e.target.files?.[0];if(f)void importSource(f,true);e.target.value="";}}/></label>
      {rows.map((r,index)=><article className="vibe-row" key={r.key}><div className="vibe-heading">{r.image&&<img src={r.image.previewUrl} alt={`氛围参考 ${index+1}`}/>}<div><strong>参考 {index+1}</strong><small>{ready(r)?"编码可用（更换模型会失效）":"待显式编码"}</small></div><button aria-label={`移除参考 ${index+1}`} disabled={disabled} onClick={()=>updateRows(rows.filter(v=>v.key!==r.key))}>移除</button></div>
        <div className="field-grid">{r.image&&<label>信息提取量<input type="number" min="0" max="1" step="0.05" disabled={disabled} value={r.information} onChange={e=>updateRows(rows.map(v=>v.key===r.key?{...v,information:Number(e.target.value),encoding:undefined}:v))}/></label>}<label>参考强度<input type="number" min="0" max="1" step="0.05" disabled={disabled} value={r.strength} onChange={e=>updateRows(rows.map(v=>v.key===r.key?{...v,strength:Number(e.target.value)}:v))}/></label></div>
        {r.image&&<div className="actions"><button disabled={disabled} onClick={()=>void run(()=>encode(r,false))}>仅查找缓存（不收费）</button><button className="tonal" disabled={disabled||!native} onClick={()=>setConfirmation({title:"确认氛围编码",description:`参考 ${index+1} · 信息提取量 ${r.information}。未命中缓存时将发起一次编码，通常消耗 2 Anlas；命中则仅复用缓存。`,run:()=>encode(r,true)})}>确认编码 / 复用</button></div>}
      </article>)}<p className="hint">本版最多 4 张、强度总和 ≤ 1，均为应用保守限制，不会自动归一化。</p>
    </section></div>
  </div>{confirmation&&<Confirm value={confirmation} onCancel={()=>setConfirmation(undefined)} onAccept={()=>{const action=confirmation.run;setConfirmation(undefined);void run(action);}}/>}</>;
}
