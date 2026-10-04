import { useRef, useState } from "react";
import type { DesktopApi } from "../platform/desktop-api";
import type { DrawingPreset, GenerationInput } from "../platform/types";
import { normalizeError } from "../platform/types";
import { localParameterError, makeDrawingPreset } from "./generation-tools";
export default function DrawingPresets({ api, native, input, disabled, onApply }: {
    api: DesktopApi;
    native: boolean;
    input: GenerationInput;
    disabled: boolean;
    onApply: (p: DrawingPreset) => void;
}) {
    const [rows, setRows] = useState<DrawingPreset[]>([]), [loaded, setLoaded] = useState(false), [name, setName] = useState(""), [selected, setSelected] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const lock = useRef(false);
    async function refresh() { const values = await api.listDrawingPresets(); setRows(values); setLoaded(true); }
    async function run(f: () => Promise<void>) { if (lock.current)
        return; lock.current = true; setBusy(true); setError(""); try {
        await f();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : normalizeError(e).message);
    }
    finally {
        lock.current = false;
        setBusy(false);
    } }
    return <details className="panel drawing-presets" onToggle={e => { if (e.currentTarget.open && native && !loaded && !busy)
        void run(refresh); }}>
    <summary>生图预设 <span className="chip">{loaded ? rows.length : "本地"}</span></summary>
    <div className="preset-body"><p className="hint">保存提示词、尺寸及采样参数；不保存账号、密钥和参考图。应用会替换提示词与参数、移除氛围参考，保留当前连接和底图。</p>
    <fieldset disabled={!native || disabled || busy}><label>选择生图预设<select aria-label="选择生图预设" value={selected} onChange={e => setSelected(e.target.value)}><option value="">选择已保存预设</option>{rows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="actions"><button type="button" disabled={!selected} onClick={() => { const p = rows.find(v => v.id === selected); if (p && window.confirm("替换当前提示词与采样参数，并移除当前氛围参考？连接与底图保持不变。"))
        onApply(p); }}>应用预设</button><button type="button" disabled={!selected} onClick={() => { if (window.confirm("删除所选生图预设？"))
        void run(async () => { await api.deleteDrawingPreset(selected); setSelected(""); await refresh(); }); }}>删除预设</button></div>
      <label>新预设名称<input maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="例如：角色竖图"/></label>
      <div className="actions"><button type="button" onClick={() => void run(refresh)}>刷新预设</button><button type="button" className="tonal" disabled={!name.trim() || !input.draft.prompt.trim()} onClick={() => void run(async () => { const issue = localParameterError(input); if (issue)
        throw new Error(issue); const p = makeDrawingPreset(input, crypto.randomUUID(), name); await api.saveDrawingPreset(p); await refresh(); setSelected(p.id); setName(""); })}>保存当前为预设</button></div>
    </fieldset>{error && <p className="error" role="alert">生图预设：{error}</p>}</div>
  </details>;
}
