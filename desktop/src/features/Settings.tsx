import {useEffect,useState} from "react";
import type {DesktopApi} from "../platform/desktop-api";
import type {TaskRecord} from "../platform/types";
import {normalizeError} from "../platform/types";
import {loadConnectionStatus} from "./connection-status";
export default function Settings({api,native,taskSignal}:{api:DesktopApi;native:boolean;taskSignal:number}){
  const [token,setToken]=useState(""),[hasToken,setHasToken]=useState<boolean>(),[tasks,setTasks]=useState<TaskRecord[]>(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [credentialError,setCredentialError]=useState(""),[taskError,setTaskError]=useState("");
  useEffect(()=>{let active=true;if(native){setHasToken(undefined);setTasks(undefined);setCredentialError("");setTaskError("");
    void loadConnectionStatus(api).then(([credentials,journal])=>{if(!active)return;
      if(credentials.status==="fulfilled")setHasToken(credentials.value);else setCredentialError(normalizeError(credentials.reason).message);
      if(journal.status==="fulfilled")setTasks(journal.value);else setTaskError(normalizeError(journal.reason).message);
    });}return()=>{active=false;setToken("");};},[api,native,taskSignal]);
  async function run(f:()=>Promise<void>){if(busy)return;setBusy(true);setError("");setMessage("");try{await f();}catch(e){setError(normalizeError(e).message);}finally{setBusy(false);}}
  async function refresh(){setTaskError("");try{setTasks(await api.listTasks());}catch(e){setTasks(undefined);setTaskError(normalizeError(e).message);}}
  return <div className="settings-grid"><section className="panel"><div className="panel-heading"><h2>NovelAI 连接</h2><span className="chip">{hasToken===true?"已保存凭据":hasToken===false?"未配置":!native?"仅桌面端可用":credentialError?"读取失败":"正在读取"}</span></div>
    <p>使用账户的 Persistent API Token。不要把 Token 发到聊天，也不会读取旧版账号。</p><p className="hint">仅写入本应用命名空间的 Windows 凭据存储；不进入 SQLite、历史或日志。删除凭据不会删除图像与草稿。</p>
    <form onSubmit={e=>{e.preventDefault();const secret=token;setToken("");void run(async()=>{await api.setToken(secret);setHasToken(true);setCredentialError("");setMessage("Token 已保存到 Windows 凭据存储；输入框已清空。");});}}><label htmlFor="token">Persistent API Token</label><input id="token" type="password" autoComplete="off" spellCheck={false} value={token} disabled={!native||busy} onChange={e=>setToken(e.target.value)} placeholder="只输入 Token，不加 Bearer"/><div className="actions"><button type="button" disabled={!native||busy||!hasToken} onClick={()=>{if(!window.confirm("确定删除本应用保存的 Token？"))return;void run(async()=>{await api.deleteToken();setHasToken(false);setCredentialError("");setMessage("已删除本应用的凭据。");});}}>删除凭据</button><button className="primary" disabled={!native||busy||!token}>保存 Token</button></div></form>
    {credentialError&&<p className="error" role="alert">凭据状态：{credentialError}</p>}{message&&<p className="success" role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </section><section className="panel"><div className="panel-heading"><h2>付费任务记录</h2><button disabled={!native||busy} onClick={()=>void run(refresh)}>刷新</button></div><p className="hint">提交前先落盘。超时、返回解析失败或程序退出后，可能无法确定是否扣费。未核对任务会阻止新付费请求；解除阻止也不会重发旧任务。</p>
    {!native&&<p>浏览器预览没有原生任务日志。</p>}{native&&tasks?.length===0&&<p className="muted">暂无任务记录。</p>}
    {native&&tasks===undefined&&<p className="muted">{taskError?"任务记录未读取，不能视为没有待核对任务。":"正在读取任务记录…"}</p>}
    {taskError&&<p className="error" role="alert">任务记录：{taskError}</p>}
    {tasks?.map(t=><article className="task-row" key={t.id}><div><strong>{t.kind==="generation"?"生图":"氛围编码"}</strong><span className={`task-state ${t.state==="outcome_unknown"?"warning":""}`}>{t.state==="outcome_unknown"?"结果待核对":t.state==="completed"?"已完成":t.state}</span></div><small>{new Date(t.createdAtMs).toLocaleString()} · {t.id}</small>{t.errorCode&&<small>错误分类：{t.errorCode}（无原始响应或凭据）</small>}
      {t.state==="outcome_unknown"&&!t.acknowledged&&<button className="tonal" disabled={busy} onClick={()=>{if(!window.confirm("你是否已经核对 NovelAI 账户与费用？这里只解除新任务阻止，不会取消扣费，也不会重新发送旧任务。"))return;void run(async()=>{await api.acknowledgeTask(t.id);await refresh();});}}>我已核对官网，允许新的操作</button>}{t.acknowledged&&<small>已确认核对；旧任务仍保持未知，不会重试。</small>}
    </article>)}
  </section></div>;
}
