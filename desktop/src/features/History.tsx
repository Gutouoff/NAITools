import {useEffect,useState} from "react";
import type {DesktopApi} from "../platform/desktop-api";
import type {GenerationInput,HistoryPage,HistoryItem} from "../platform/types";
import {normalizeError} from "../platform/types";
export default function History({api,native,onReplay}:{api:DesktopApi;native:boolean;onReplay:(input:GenerationInput)=>void}){
  const [page,setPage]=useState<HistoryPage>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[selected,setSelected]=useState<{item:HistoryItem;url:string}>();
  useEffect(()=>{let active=true;if(native){setBusy(true);void api.listHistory({limit:30}).then(p=>{if(active)setPage(p);}).catch(e=>{if(active)setError(normalizeError(e).message);}).finally(()=>{if(active)setBusy(false);});}return()=>{active=false;};},[api,native]);
  async function run(f:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await f();}catch(e){setError(normalizeError(e).message);}finally{setBusy(false);}}
  return <section className="panel history-panel"><div className="panel-heading"><h2>独立历史库</h2><span className="chip">按需读取 · 游标分页</span></div><p className="hint">保留生成时的模型、Seed、参数与素材引用；恢复仅放回编辑器，不会自动生图。旧图片目录不扫描。</p>
    {!native&&<p>浏览器预览无法查询原生数据库。</p>}{error&&<p role="alert" className="error">{error}</p>}{busy&&<p role="status">读取中…</p>}{page?.items.length===0&&<div className="history-empty">还没有生成记录。</div>}
    <div className="history-grid">{page?.items.map(item=><article className="history-item" key={item.id}><time>{new Date(item.createdAtMs).toLocaleString()}</time><p>{item.prompt}</p><div className="actions"><button disabled={busy} onClick={()=>void run(async()=>setSelected({item,url:await api.readArtifact(item.artifactId,true)}))}>预览</button><button className="tonal" disabled={busy} onClick={()=>void run(async()=>onReplay(await api.historyRequest(item.id)))}>恢复到工作台</button></div></article>)}</div>
    {page?.nextCursor&&<button disabled={busy} onClick={()=>void run(async()=>setPage(await api.listHistory({limit:30,before:page.nextCursor})))}>下一页</button>}
    {selected&&<div className="history-preview"><img src={selected.url} alt="历史图像缩略图"/><div className="actions"><button onClick={()=>setSelected(undefined)}>关闭预览</button><button disabled={busy} onClick={()=>void run(async()=>{await api.exportArtifact(selected.item.artifactId);})}>导出原始 PNG</button></div></div>}
  </section>;
}
