import {useEffect,useState,lazy,Suspense} from "react";
import {getDesktopApi,type DesktopApi} from "./platform/desktop-api";
import type {BootInfo,GenerationInput} from "./platform/types";
import {normalizeError} from "./platform/types";
import Workbench from "./features/Workbench";
import {newPromptDocument} from "./features/prompt";
const History=lazy(()=>import("./features/History"));
const Diagnostics=lazy(()=>import("./features/Diagnostics"));
const Settings=lazy(()=>import("./features/Settings"));
type Tab="workbench"|"history"|"settings"|"diagnostics";
const initial:GenerationInput={draft:{prompt:"",negativePrompt:"",promptDocument:newPromptDocument()},model:"nai-diffusion-4-5-full",mode:"txt2img",width:832,height:1216,steps:23,guidance:5,sampler:"k_euler_ancestral",seed:null,imageId:null,strength:0.7,noise:0,vibes:[],confirmPaid:false};
export default function App(){
  const [api,setApi]=useState<DesktopApi>(),[boot,setBoot]=useState<BootInfo>(),[tab,setTab]=useState<Tab>("workbench"),[error,setError]=useState(""),[input,setInput]=useState(initial),[rendererMs,setRendererMs]=useState<number>(),[replaySignal,setReplaySignal]=useState(0),[taskSignal,setTaskSignal]=useState(0);
  useEffect(()=>{let active=true;void getDesktopApi().then(async service=>{
    const b=await service.bootstrap();if(!active)return;setApi(service);setBoot(b);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(active){setRendererMs(performance.now());void service.markReady().then(v=>{if(active)setBoot(v);}).catch(e=>{if(active)setError(normalizeError(e).message);});}}));
  }).catch(e=>{if(active)setError(normalizeError(e).message);});return()=>{active=false;};},[]);
  const native=boot?.runtime==="tauri";
  const titles={workbench:"图像生成",history:"历史记录",settings:"连接与任务",diagnostics:"关于 NAITools"};
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">N</span><span className="brand-text">NAITools</span></div>
      <nav aria-label="主导航">{([["workbench","工作台","◈"],["history","历史记录","▤"],["settings","连接与任务","⚙"],["diagnostics","关于","ⓘ"]] as const).map(([id,title,icon])=>
        <button className={`nav-item ${tab===id?"active":""}`} aria-label={title} aria-current={tab===id?"page":undefined} title={title} key={id} onClick={()=>setTab(id)}><span aria-hidden="true">{icon}</span><span className="nav-label">{title}</span></button>)}
      </nav>
    </aside>
    <main className="main">
      <header className="page-header"><h1>{titles[tab]}</h1></header>
      {!native&&boot&&<div className="notice preview-notice">浏览器预览：本地保存、素材导入与生成不可用。</div>}
      {error&&<div className="error" role="alert">{error}</div>}
      {taskSignal>0&&tab!=="settings"&&<div className="notice">操作结果待核对，请勿重复提交。<button onClick={()=>setTab("settings")}>查看任务记录</button></div>}
      <div className="page-content">
        {api&&<div className="workbench-page" hidden={tab!=="workbench"}><Workbench api={api} native={native} input={input} setInput={setInput} replaySignal={replaySignal} onTasks={()=>setTaskSignal(s=>s+1)}/></div>}
        <Suspense fallback={<p className="muted">加载中…</p>}>
          {tab==="history"&&api&&<History api={api} native={native} onReplay={i=>{setInput(i);setReplaySignal(s=>s+1);setTab("workbench");}}/>}
          {tab==="settings"&&api&&<Settings api={api} native={native} taskSignal={taskSignal}/>}
          {tab==="diagnostics"&&<Diagnostics boot={boot} rendererMs={rendererMs}/>}
        </Suspense>
      </div>
    </main>
  </div>;
}
