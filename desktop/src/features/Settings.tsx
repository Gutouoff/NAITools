import {useEffect,useState} from "react";
import type {DesktopApi} from "../platform/desktop-api";
import type {TaskRecord} from "../platform/types";
import {normalizeError} from "../platform/types";
import Connections from "./Connections";
export default function Settings({api,native,taskSignal,onConnections}:{api:DesktopApi;native:boolean;taskSignal:number;onConnections:()=>void}){
  const [tasks,setTasks]=useState<TaskRecord[]>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [taskError,setTaskError]=useState("");
  useEffect(()=>{let active=true;if(native){setTasks(undefined);setTaskError("");void api.listTasks().then(v=>{if(active)setTasks(v);},e=>{if(active)setTaskError(normalizeError(e).message);});}return()=>{active=false;};},[api,native,taskSignal]);
  async function run(f:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await f();}catch(e){setError(normalizeError(e).message);}finally{setBusy(false);}}
  async function refresh(){setTaskError("");try{setTasks(await api.listTasks());}catch(e){setTasks(undefined);setTaskError(normalizeError(e).message);}}
  return <div className="settings-grid"><Connections api={api} native={native} onChanged={onConnections}/><section className="panel"><div className="panel-heading"><h2>付费任务记录</h2><button disabled={!native||busy} onClick={()=>void run(refresh)}>刷新</button></div><p className="hint">提交前先落盘。超时、返回解析失败或程序退出后，可能无法确定是否扣费。未核对任务会阻止新付费请求；解除阻止也不会重发旧任务。</p>
    {error&&<p className="error" role="alert">{error}</p>}{!native&&<p>浏览器预览没有原生任务日志。</p>}{native&&tasks?.length===0&&<p className="muted">暂无任务记录。</p>}
    {native&&tasks===undefined&&<p className="muted">{taskError?"任务记录未读取，不能视为没有待核对任务。":"正在读取任务记录…"}</p>}
    {taskError&&<p className="error" role="alert">任务记录：{taskError}</p>}
    {tasks?.map(t=><article className="task-row" key={t.id}><div><strong>{t.kind==="generation"?"生图":"氛围编码"}</strong><span className={`task-state ${t.state==="outcome_unknown"?"warning":""}`}>{t.state==="outcome_unknown"?"结果待核对":t.state==="completed"?"已完成":t.state}</span></div><small>{new Date(t.createdAtMs).toLocaleString()} · {t.id}</small>{t.connection?<small>提交连接：{t.connection.name} · {t.connection.baseUrl}<br/>{t.connection.id} · {t.kind==="generation"?t.connection.generationPath:t.connection.encodePath}</small>:<small>旧任务未记录连接快照；请结合创建时间核对账户。</small>}{t.errorCode&&<small>错误分类：{t.errorCode}（无原始响应或凭据）</small>}
      {t.state==="outcome_unknown"&&!t.acknowledged&&<button className="tonal" disabled={busy} onClick={()=>{if(!window.confirm("你是否已经核对所选服务账户与费用？这里只解除新任务阻止，不会取消扣费，也不会重新发送旧任务。"))return;void run(async()=>{await api.acknowledgeTask(t.id);await refresh();});}}>我已核对官网，允许新的操作</button>}{t.acknowledged&&<small>已确认核对；旧任务仍保持未知，不会重试。</small>}
    </article>)}
  </section></div>;
}
