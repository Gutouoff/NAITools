import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { DesktopApi } from "../platform/desktop-api";
import type { ConnectionStatus } from "../platform/types";
const Connections = lazy(() => import("./Connections"));
function Editor({ api, native, id, action, onChanged, onSelect, onClose }: {
    api: DesktopApi;
    native: boolean;
    id: string;
    action: "edit" | "create" | "duplicate";
    onChanged: () => void;
    onSelect: (id: string) => void;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { ref.current?.showModal(); }, []);
    return <dialog ref={ref} className="connection-dialog" aria-label="管理生图连接" onCancel={e => { e.preventDefault(); if (!busy)
        onClose(); }}>
    <div className="dialog-heading"><h2>账号与中转站</h2><button type="button" disabled={busy} onClick={onClose}>关闭</button></div>
    <Suspense fallback={<p className="hint">加载连接编辑器…</p>}><Connections api={api} native={native} selectedId={id} initialAction={action} onChanged={onChanged} onBusy={setBusy} onSelect={value => { onSelect(value); onClose(); }}/></Suspense>
  </dialog>;
}
export default function ConnectionPicker({ api, native, rows, id, disabled, error, onSelect, onChanged }: {
    api: DesktopApi;
    native: boolean;
    rows: ConnectionStatus[];
    id: string;
    disabled: boolean;
    error: string;
    onSelect: (id: string) => void;
    onChanged: () => void;
}) {
    const [editing, setEditing] = useState<"edit" | "create" | "duplicate">();
    const current = rows.find(r => r.profile.id === id)?.profile;
    return <section className="connection-toolbar" aria-label="当前生图配置">
    <label htmlFor="active-connection">当前配置</label><select id="active-connection" aria-label="生成连接" value={id} disabled={!native || disabled || !rows.length} onChange={e => onSelect(e.target.value)}>
      {!rows.some(r => r.profile.id === id) && <option value={id}>{error ? "连接读取失败" : id === "default-novelai" ? "NovelAI 默认账号" : "配置不可用，请重新选择"}</option>}
      {rows.map(r => <option key={r.profile.id} value={r.profile.id}>{r.profile.name} · {r.profile.kind === "official" ? "NAI 官方" : "原生中转"}</option>)}
    </select><span className="chip" title={current?.baseUrl}>{current?.kind === "official" ? "NovelAI" : current ? "NAI 原生兼容" : "未就绪"}</span>
    <div className="toolbar-actions"><button type="button" disabled={!native || disabled} onClick={() => setEditing("create")}>创建配置</button><button type="button" disabled={!native || disabled || !current} onClick={() => setEditing("edit")}>编辑配置</button><button type="button" disabled={!native || disabled || !current} onClick={() => setEditing("duplicate")}>复制配置</button><button type="button" disabled={!native || disabled} onClick={onChanged} title="重新读取连接配置">刷新</button></div>
    {error && <p className="connection-error" role="alert">连接配置：{error}</p>}
    {editing && <Editor api={api} native={native} id={id} action={editing} onChanged={onChanged} onSelect={onSelect} onClose={() => setEditing(undefined)}/>}
  </section>;
}
