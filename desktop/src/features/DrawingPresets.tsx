import { useRef, useState } from "react";
import type { DesktopApi } from "../platform/desktop-api";
import type { DrawingPreset, GenerationInput } from "../platform/types";
import { normalizeError } from "../platform/types";
import { localParameterError, makeDrawingPreset, type PromptRetention } from "./generation-tools";

export default function DrawingPresets({ api, native, input, disabled, retention, onRetention, onApply, onArtist }: {
    api: DesktopApi;
    native: boolean;
    input: GenerationInput;
    disabled: boolean;
    retention: PromptRetention;
    onRetention: (value: PromptRetention) => void;
    onApply: (preset: DrawingPreset) => void;
    onArtist: (preset: DrawingPreset) => void;
}) {
    const [rows, setRows] = useState<DrawingPreset[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [name, setName] = useState("");
    const [selected, setSelected] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const lock = useRef(false);
    const current = rows.find(row => row.id === selected);
    async function refresh() {
        const values = await api.listDrawingPresets();
        setRows(values);
        setLoaded(true);
    }
    async function run(action: () => Promise<void>) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try { await action(); }
        catch (e) { setError(e instanceof Error ? e.message : normalizeError(e).message); }
        finally { lock.current = false; setBusy(false); }
    }
    async function save(id: string, title: string) {
        const issue = localParameterError(input);
        if (issue) throw new Error(issue);
        const preset = makeDrawingPreset(input, id, title);
        await api.saveDrawingPreset(preset);
        await refresh();
        setSelected(preset.id);
        setName("");
    }
    return <details className="panel drawing-presets" onToggle={event => {
        if (event.currentTarget.open && native && !loaded && !busy) void run(refresh);
    }}>
        <summary>绘图配置 <span className="chip">{current?.name ?? "未选择"}</span></summary>
        <div className="preset-body">
            <p className="hint">保存画师串、正向及负向提示词、尺寸与采样参数，不包含 API 配置、凭据或参考图。</p>
            <fieldset disabled={disabled || busy}>
                <div className="retention-options">
                    <label className="toggle"><input type="checkbox" checked={retention.style} onChange={e => onRetention({ ...retention, style: e.target.checked })}/>保留画师串</label>
                    <label className="toggle"><input type="checkbox" checked={retention.negative} onChange={e => onRetention({ ...retention, negative: e.target.checked })}/>保留负向提示词</label>
                </div>
                <p className="hint">保留选项仅影响绘图配置切换及提示词清空，不限制手动编辑或历史参数恢复。</p>
            </fieldset>
            <fieldset disabled={!native || disabled || busy}>
                <label>当前绘图配置<select aria-label="当前绘图配置" value={selected} onChange={e => setSelected(e.target.value)}>
                    <option value="">选择已保存配置</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select></label>
                <div className="actions">
                    <button type="button" disabled={!current} onClick={() => {
                        if (current && window.confirm("应用所选绘图配置？按保留选项处理画师串与负向提示词，其余提示词及采样参数将替换。氛围参考将移除；API 配置与底图保持不变。")) onApply(current);
                    }}>应用绘图配置</button>
                    <button type="button" disabled={!current} onClick={() => {
                        if (current && window.confirm("替换当前画师串？正向及负向提示词、采样参数、API 配置和参考图保持不变。")) onArtist(current);
                    }}>仅应用画师串</button>
                </div>
                <label>新配置名称<input maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="例如：角色竖图"/></label>
                <div className="actions">
                    <button type="button" className="tonal" disabled={!name.trim() || !input.draft.prompt.trim()} onClick={() => void run(() => save(crypto.randomUUID(), name))}>保存为新配置</button>
                    <button type="button" disabled={!current || !input.draft.prompt.trim()} onClick={() => {
                        if (current && window.confirm("使用当前提示词及参数更新所选绘图配置？")) void run(() => save(current.id, name.trim() || current.name));
                    }}>更新所选配置</button>
                    <button type="button" disabled={!current} onClick={() => {
                        if (current && window.confirm("删除所选绘图配置？")) void run(async () => { await api.deleteDrawingPreset(current.id); setSelected(""); await refresh(); });
                    }}>删除绘图配置</button>
                    <button type="button" onClick={() => void run(refresh)}>刷新配置</button>
                </div>
            </fieldset>
            {error && <p className="error" role="alert">绘图配置：{error}</p>}
        </div>
    </details>;
}
