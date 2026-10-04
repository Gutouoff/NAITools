import { useEffect, useRef, useState } from "react";
import type { DesktopApi } from "../platform/desktop-api";
import type { ConnectionProfile, ConnectionStatus } from "../platform/types";
import { normalizeError } from "../platform/types";
const official: ConnectionProfile = { id: "default-novelai", name: "NovelAI 默认账号", kind: "official", baseUrl: "https://image.novelai.net", generationPath: "/ai/generate-image", encodePath: "/ai/encode-vibe", generationUsd: null, encodingUsd: null };
export default function Connections({ api, native, onChanged }: {
    api: DesktopApi;
    native: boolean;
    onChanged: () => void;
}) {
    const [rows, setRows] = useState<ConnectionStatus[]>([]);
    const [profile, setProfile] = useState<ConnectionProfile>(official);
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
    const lock = useRef(false);
    useEffect(() => { let live = true; if (native)
        void api.listConnections().then(v => { if (live)
            setRows(v); }, e => { if (live)
            setError(normalizeError(e).message); }); return () => { live = false; }; }, [api, native]);
    async function refresh() { setRows(await api.listConnections()); onChanged(); }
    async function run(f: () => Promise<void>) { if (lock.current)
        return; lock.current = true; setBusy(true); setError(""); setMessage(""); try {
        await f();
    }
    catch (e) {
        setError(normalizeError(e).message);
    }
    finally {
        lock.current = false;
        setBusy(false);
    } }
    function edit(p: Partial<ConnectionProfile>) { setProfile(current => ({ ...current, ...p })); }
    function choose(p: ConnectionProfile) { setProfile({ ...p }); setToken(""); setMessage(""); }
    function add(kind: ConnectionProfile["kind"]) { choose({ ...official, id: crypto.randomUUID(), name: kind === "official" ? "NovelAI 新账号" : "新中转站", kind, ...(kind === "relay_native" ? { baseUrl: "", generationPath: "", encodePath: null } : {}) }); }
    const saved = rows.find(r => r.profile.id === profile.id);
    return <section className="panel connections-panel">
    <div className="panel-heading"><h2>连接配置</h2><span className="chip">{rows.length} 套</span></div>
    <p className="hint">每套配置对应一个账号或 API Key，可保存多个 NAI 账号和中转站。密钥只存入 Windows 凭据管理器，不回显、不进入数据库或日志。</p>
    <div className="connection-list">{rows.map(r => <button type="button" key={r.profile.id} disabled={busy} className={r.profile.id === profile.id ? "selected" : ""} onClick={() => choose(r.profile)}><strong>{r.profile.name}</strong><small>{r.profile.kind === "official" ? "NovelAI 官方" : "原生兼容中转"} · {r.hasToken === true ? "凭据已保存" : r.hasToken === false ? "缺少凭据" : "凭据状态不可读"}</small></button>)}</div>
    <div className="actions"><button type="button" disabled={!native || busy} onClick={() => add("official")}>添加 NAI 账号</button><button type="button" disabled={!native || busy} onClick={() => add("relay_native")}>添加中转站</button></div>
    <form onSubmit={e => { e.preventDefault(); void run(async () => { await api.saveConnection(profile); await refresh(); setMessage("连接配置已保存。密钥请在下方单独保存。"); }); }}>
      <fieldset disabled={!native || busy}><label>配置名称<input value={profile.name} maxLength={80} required onChange={e => edit({ name: e.target.value })}/></label>
      <label>接口协议<select value={profile.kind} disabled={profile.id === "default-novelai"} onChange={e => { const kind = e.target.value as ConnectionProfile["kind"]; choose(kind === "official" ? { ...official, id: profile.id, name: profile.name } : { ...profile, kind, baseUrl: "", generationPath: "", encodePath: null }); }}><option value="official">NovelAI 官方</option><option value="relay_native">NovelAI 原生兼容（JSON → ZIP）</option></select></label>
      <label>服务地址<input value={profile.baseUrl} type="url" required disabled={profile.kind === "official"} placeholder="https://example.com" onChange={e => edit({ baseUrl: e.target.value.replace(/\/$/, "") })}/></label>
      {profile.kind === "relay_native" && <><p className="notice">仅适用于服务商明确支持的 NovelAI 原生格式：Bearer 认证、JSON 请求、ZIP 图片响应。请按文档填写路径；不自动猜测 /v1、OpenAI Images 或 Chat 格式。</p>
      <label>生图接口路径<input value={profile.generationPath} required placeholder="填写服务商文档中的路径" onChange={e => edit({ generationPath: e.target.value })}/></label>
      <label>氛围编码接口路径（可选）<input value={profile.encodePath ?? ""} placeholder="未提供则禁用远程编码" onChange={e => edit({ encodePath: e.target.value || null })}/></label>
      <div className="field-grid"><label>单图预计费用（美元）<input type="number" min="0" max="100" step="0.001" value={profile.generationUsd ?? ""} placeholder="未核实" onChange={e => edit({ generationUsd: e.target.value === "" ? null : Number(e.target.value) })}/></label><label>首次氛围编码费用（美元）<input type="number" min="0" max="100" step="0.001" value={profile.encodingUsd ?? ""} placeholder="未核实" onChange={e => edit({ encodingUsd: e.target.value === "" ? null : Number(e.target.value) })}/></label></div>
      <p className="hint">费用是手动设置的预估值，不代表实时余额或服务商最终扣费。新图和提取参数变化可能重新收费，编码成功后出图失败也可能产生编码费用。</p></>}
      <div className="actions"><button type="button" disabled={!saved || profile.id === "default-novelai"} onClick={() => { if (!window.confirm("删除此连接及其保存的凭据？历史、草稿和图片不会删除。"))
        return; void run(async () => { await api.deleteConnection(profile.id); choose(official); await refresh(); setMessage("连接已删除；历史与图片保留。"); }); }}>删除配置</button><button className="primary">保存配置</button></div></fieldset>
    </form>
    <form onSubmit={e => { e.preventDefault(); const secret = token; setToken(""); void run(async () => { await api.setConnectionToken(profile.id, secret); await refresh(); setMessage("凭据已保存；输入框已清空。"); }); }}><fieldset disabled={!native || busy || !saved}><label htmlFor="token">API Key / Persistent API Token</label><input id="token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} placeholder="只输入密钥，不加 Bearer"/><div className="actions"><button type="button" disabled={!saved?.hasToken} onClick={() => { if (!window.confirm("只删除此连接保存的凭据？"))
        return; setToken(""); void run(async () => { await api.deleteConnectionToken(profile.id); await refresh(); }); }}>删除凭据</button><button className="tonal" disabled={!token}>保存凭据</button></div></fieldset></form>
    {message && <p className="success" role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}
