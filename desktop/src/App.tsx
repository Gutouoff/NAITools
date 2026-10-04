import {useEffect,useState,lazy,Suspense} from "react";
import {getDesktopApi,type DesktopApi} from "./platform/desktop-api";
import type {BootInfo,GenerationInput} from "./platform/types";
import {normalizeError} from "./platform/types";
import Workbench from "./features/Workbench";
import {newPromptDocument} from "./features/prompt";
const History=lazy(()=>import("./features/History")),Diagnostics=lazy(()=>import("./features/Diagnostics")),Settings=lazy(()=>import("./features/Settings"));
type Tab="workbench"|"history"|"settings"|"diagnostics";
const initial:GenerationInput={draft:{prompt:"",negativePrompt:"",promptDocument:newPromptDocument()},model:"nai-diffusion-4-5-full",mode:"txt2img",width:832,height:1216,steps:23,guidance:5,sampler:"k_euler_ancestral",seed:null,imageId:null,strength:0.7,noise:0,vibes:[],confirmPaid:false};
export default function App(){
  const [api,setApi]=useState<DesktopApi>(),[boot,setBoot]=useState<BootInfo>(),[tab,setTab]=useState<Tab>("workbench"),[error,setError]=useState(""),[input,setInput]=useState(initial),[rendererMs,setRendererMs]=useState<number>(),[replaySignal,setReplaySignal]=useState(0),[taskSignal,setTaskSignal]=useState(0);
  useEffect(()=>{let active=true;void getDesktopApi().then(async service=>{const b=await service.bootstrap();if(!active)return;setApi(service);setBoot(b);requestAnimationFrame(()=>requestAnimationFrame(()=>{if(active){setRendererMs(performance.now());void service.markReady().then(v=>{if(active)setBoot(v);}).catch(e=>{if(active)setError(normalizeError(e).message);});}}));}).catch(e=>{if(active)setError(normalizeError(e).message);});return()=>{active=false;};},[]);
  const native=boot?.runtime==="tauri";
  const titles={workbench:"把精力留给创作",history:"历史记录",settings:"连接与任务",diagnostics:"框架状态"};
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">✦</span><div>岚白 Studio<small>PC · CREATIVE SPACE</small></div></div><span className="section-caption">创作空间</span><nav aria-label="主导航">{([["workbench","工作台","◈"],["history","历史记录","▤"],["settings","连接与任务","⚙"],["diagnostics","框架状态","⌁"]] as const).map(([id,title,icon])=><button className={`nav-item ${tab===id?"active":""}`} aria-current={tab===id?"page":undefined} key={id} onClick={()=>setTab(id)}><span>{icon}</span>{title}</button>)}</nav><div className="sidebar-footer"><span className="status-dot"/>独立 PC 新版<small>不扫描旧版账号与图片</small><small>M3 设计语言 · 轻量 CSS</small></div></aside>
    <main className="main"><header><div><span className="eyebrow">LIGHTWEIGHT DESKTOP / NAI</span><h1>{titles[tab]}</h1></div><span className="runtime-badge">{boot?(native?"Rust + Tauri":"浏览器 UI 预览"):"连接宿主中"}</span></header>
      {!native&&boot&&<div className="notice">当前仅为界面预览：不连接 NovelAI，不提供原生保存，也没有 PC 性能测量。</div>}{error&&<div className="error" role="alert">{error}</div>}
      {taskSignal>0&&tab!=="settings"&&<div className="notice">操作未确认成功；请在「连接与任务」核对任务记录，不要直接重复提交。<button onClick={()=>setTab("settings")}>查看记录</button></div>}
      {api&&<div hidden={tab!=="workbench"}><Workbench api={api} native={native} input={input} setInput={setInput} replaySignal={replaySignal} onTasks={()=>setTaskSignal(s=>s+1)}/></div>}
      <Suspense fallback={<p className="muted">按需加载页面…</p>}>{tab==="history"&&api&&<History api={api} native={native} onReplay={i=>{setInput(i);setReplaySignal(s=>s+1);setTab("workbench");}}/>}{tab==="settings"&&api&&<Settings api={api} native={native} taskSignal={taskSignal}/>} {tab==="diagnostics"&&<Diagnostics boot={boot} rendererMs={rendererMs}/>}</Suspense>
      <footer><span>PC PREVIEW · V4.5 OBSERVED SUBSET</span><span>不自动收费编码 / 不自动重试</span></footer>
    </main></div>;
}
