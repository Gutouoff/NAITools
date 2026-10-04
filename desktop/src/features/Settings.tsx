import { useEffect, useState } from "react";
import type { DesktopApi } from "../platform/desktop-api";
import type { TaskRecord } from "../platform/types";
import { normalizeError } from "../platform/types";
import Connections from "./Connections";
const TASK_STATES: Record<TaskRecord["state"], string> = { queued: "已排队", submitting: "提交中", running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消", outcome_unknown: "结果待核对" };
export default function Settings({ api, native, taskSignal, onTasks, onConnections, selectedId, onSelect }: {
    api: DesktopApi;
    native: boolean;
    taskSignal: number;
    onTasks: () => void;
    onConnections: () => void;
    selectedId: string;
    onSelect: (id: string) => void;
}) {
    const [tasks, setTasks] = useState<TaskRecord[]>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [taskError, setTaskError] = useState("");
    useEffect(() => { let active = true; if (native) {
        setTasks(undefined);
        setTaskError("");
        void api.listTasks().then(v => { if (active)
            setTasks(v); }, e => { if (active)
            setTaskError(normalizeError(e).message); });
    } return () => { active = false; }; }, [api, native, taskSignal]);
    async function run(f: () => Promise<void>) { if (busy)
        return; setBusy(true); setError(""); try {
        await f();
    }
    catch (e) {
        setError(normalizeError(e).message);
    }
    finally {
        setBusy(false);
    } }
    async function refresh() { setTaskError(""); try {
        setTasks(await api.listTasks());
        onTasks();
    }
    catch (e) {
        setTasks(undefined);
        setTaskError(normalizeError(e).message);
    } }
    return <div className="settings-grid"><Connections api={api} native={native} onChanged={onConnections} selectedId={selectedId} onSelect={onSelect}/><section className="panel"><div className="panel-heading"><h2>付费任务记录</h2><button disabled={!native || busy} onClick={() => void run(refresh)}>刷新</button></div><p className="hint">请求提交前写入本地任务记录。超时、返回解析失败或程序退出后，可能无法确定是否扣费。未核对任务会阻止新付费请求；解除阻止也不会重新提交原任务。</p>
    {error && <p className="error" role="alert">{error}</p>}{!native && <p>浏览器预览没有原生任务日志。</p>}{native && tasks?.length === 0 && <p className="muted">暂无任务记录。</p>}
    {native && tasks === undefined && <p className="muted">{taskError ? "任务记录未读取，不能视为没有待核对任务。" : "正在读取任务记录…"}</p>}
    {taskError && <p className="error" role="alert">任务记录：{taskError}</p>}
    {tasks?.map(t => <article className="task-row" key={t.id}><div><strong>{t.kind === "generation" ? "图像生成" : "氛围参考信息提取"}</strong><span className={`task-state ${t.state === "outcome_unknown" ? "warning" : ""}`}>{TASK_STATES[t.state]}</span></div><small>{new Date(t.createdAtMs).toLocaleString()} · {t.id}</small>{t.connection ? <small>提交连接：{t.connection.name} · {t.connection.baseUrl}<br />{t.connection.id} · {t.kind === "generation" ? t.connection.generationPath : t.connection.encodePath}</small> : <small>旧任务未记录连接快照；请结合创建时间核对账户。</small>}{t.errorCode && <small>错误分类：{t.errorCode}（无原始响应或凭据）</small>}
      {t.state === "outcome_unknown" && !t.acknowledged && <button className="tonal" disabled={busy} onClick={() => { if (!window.confirm("确认已核对服务账户中的任务结果及费用？此操作仅解除新请求的提交限制，不会撤销费用或重新提交原任务。"))
            return; void run(async () => { await api.acknowledgeTask(t.id); await refresh(); }); }}>确认已核对，解除提交限制</button>}{t.acknowledged && <small>已确认核对；原任务结果仍标记为未知，不会自动重新提交。</small>}
    </article>)}
  </section></div>;
}
