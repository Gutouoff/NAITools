import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, Dispatch, SetStateAction } from "react";
import { readWidths, fitWidths } from "./workbench-layout";
import DrawingPresets from "./DrawingPresets";
import ImageDropZone from "./ImageDropZone";
import { prepareImage, fileBase64, type SelectedImage } from "./image-import";
import ResultViewer from "./ResultViewer";
import { SIZE_PRESETS, localParameterError, applyDrawingPreset, applyArtistString, clearPromptDraft, readPromptRetention, rememberPromptRetention } from "./generation-tools";
import ResizableTextArea from "./ResizableTextArea";
import type { DesktopApi } from "../platform/desktop-api";
import type { GenerationInput, GenerationResult, VibeAsset, ConnectionStatus } from "../platform/types";
import { normalizeError } from "../platform/types";
import PromptEditor from "./PromptEditor";
import { compilePrompt, newPromptDocument } from "./prompt";
interface Row {
    key: string;
    image?: SelectedImage;
    encoding?: VibeAsset;
    information: number;
    strength: number;
}
interface Confirmation {
    title: string;
    description: string;
    run: () => Promise<void>;
}
function Confirm({ value, onCancel, onAccept }: {
    value: Confirmation;
    onCancel: () => void;
    onAccept: () => void;
}) { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { ref.current?.showModal(); }, []); return <dialog ref={ref} onCancel={onCancel} className="confirm-dialog"><h2>{value.title}</h2><p>{value.description}</p><p className="hint">请求可能产生服务费用；发生超时或未知结果不会自动重新提交。</p><div className="actions"><button autoFocus onClick={onCancel}>取消</button><button className="primary" onClick={onAccept}>确认并提交一次</button></div></dialog>; }
export default function Workbench({ api, native, input, setInput, replaySignal, connectionSignal, onOpenSettings, onTasks }: {
    api: DesktopApi;
    native: boolean;
    input: GenerationInput;
    setInput: Dispatch<SetStateAction<GenerationInput>>;
    replaySignal: number;
    connectionSignal: number;
    onOpenSettings: () => void;
    onTasks: () => void;
}) {
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(""), [image, setImage] = useState<SelectedImage>(), [rows, setRows] = useState<Row[]>([]), [result, setResult] = useState<GenerationResult>(), [confirmation, setConfirmation] = useState<Confirmation>();
    const [retention, setRetention] = useState(readPromptRetention);
    useEffect(() => { rememberPromptRetention(retention); }, [retention]);
    const lock = useRef(false);
    const workbenchRef = useRef<HTMLDivElement>(null);
    const [available, setAvailable] = useState(1000);
    const [ratios, setRatios] = useState(() => { try {
        return readWidths(localStorage.getItem("naitools.workbenchWidths"));
    }
    catch {
        return readWidths(null);
    } });
    const [connections, setConnections] = useState<ConnectionStatus[]>([]);
    const [connectionError, setConnectionError] = useState("");
    const drag = useRef<{
        kind: "editor" | "controls";
        startX: number;
        startValue: number;
    } | null>(null);
    const panelWidths = fitWidths(available, ratios);
    useEffect(() => {
        const node = workbenchRef.current;
        if (!node)
            return;
        const observer = new ResizeObserver(([entry]) => setAvailable(Math.max(720, entry.contentRect.width - 24)));
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    useEffect(() => { try {
        localStorage.setItem("naitools.workbenchWidths", JSON.stringify(ratios));
    }
    catch { /* optional layout state */ } }, [ratios]);
    useEffect(() => { let live = true; if (native)
        void api.listConnections(false).then(value => { if (live) {
            setConnections(value);
            setConnectionError("");
        } }, e => { if (live)
            setConnectionError(normalizeError(e).message); }); return () => { live = false; }; }, [api, native, connectionSignal]);
    function setPanel(kind: "editor" | "controls", value: number) {
        const other = kind === "editor" ? panelWidths.controls : panelWidths.editor;
        const minimum = kind === "editor" ? 260 : 220;
        const clamped = Math.max(minimum, Math.min(available - other - 240, value));
        setRatios(current => ({ ...current, [kind]: clamped / available }));
    }
    function beginResize(kind: "editor" | "controls", event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0)
            return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { kind, startX: event.clientX, startValue: panelWidths[kind] };
    }
    useEffect(() => { setRows(input.vibes.map((v, index) => ({ key: `replay-${replaySignal}-${index}`, encoding: { id: v.encodingId, model: input.model, informationExtracted: -1, cacheHit: true }, information: -1, strength: v.strength }))); setImage(undefined); }, [replaySignal]);
    const doc = input.draft.promptDocument ?? newPromptDocument(input.draft.prompt);
    function patch(p: Partial<GenerationInput>) { setInput(current => ({ ...current, ...p })); }
    function updateRows(next: Row[]) { setRows(next); patch({ vibes: next.filter(r => r.encoding).map(r => ({ encodingId: r.encoding!.id, strength: r.strength })) }); }
    async function run(operation: () => Promise<void>) { if (lock.current)
        return; lock.current = true; setBusy(true); setError(""); setMessage(""); try {
        await operation();
    }
    catch (e) {
        setError(e instanceof Error && !("code" in e) ? e.message : normalizeError(e).message);
    }
    finally {
        lock.current = false;
        setBusy(false);
    } }
    async function load() { await run(async () => { const draft = await api.loadDraft(); patch({ draft }); setMessage("已读取提示词草稿。"); }); }
    async function save() { await run(async () => { await api.saveDraft(input.draft); setMessage("已保存提示词草稿。"); }); }
    async function persistImage(selectedImage: SelectedImage): Promise<SelectedImage> {
        if (!selectedImage.file) throw new Error("原始图像文件不可用，请重新选择。");
        const asset = await api.importImage(await fileBase64(selectedImage.file));
        return { ...selectedImage, file: undefined, asset, error: undefined };
    }
    async function importSources(files: File[], vibe: boolean) {
        await run(async () => {
            if (vibe && rows.length + files.length > 4) throw new Error("最多导入 4 张氛围参考；此次未导入。");
            // Validate the complete selection before changing rows or writing any originals.
            const prepared: SelectedImage[] = [];
            for (const file of files) prepared.push(await prepareImage(file));
            if (!vibe) {
                const source = prepared[0];
                if (!source) return;
                setImage(source);
                patch({ imageId: null, mode: "i2i" });
                try {
                    const saved = await persistImage(source);
                    setImage(saved);
                    patch({ imageId: saved.asset!.id, mode: "i2i" });
                } catch (e) {
                    setImage({ ...source, error: normalizeError(e).message });
                    throw e;
                }
            } else {
                const added = prepared.map(image => ({ key: crypto.randomUUID(), image, information: 0.8, strength: 0.5 } satisfies Row));
                let next: Row[] = [...rows, ...added];
                updateRows(next);
                for (const row of added) {
                    try {
                        const saved = await persistImage(row.image);
                        next = next.map(r => r.key === row.key ? { ...r, image: saved } : r);
                        updateRows(next);
                    } catch (e) {
                        next = next.map(r => r.key === row.key ? { ...r, image: { ...row.image, error: normalizeError(e).message } } : r);
                        updateRows(next);
                        // Stop after the first failure. Remaining selections stay explicitly unsaved.
                        throw e;
                    }
                }
            }
        });
    }
    async function retrySource() {
        if (!image?.file) return;
        await run(async () => {
            try {
                const saved = await persistImage(image);
                setImage(saved);
                patch({ imageId: saved.asset!.id });
            } catch (e) { setImage({ ...image, error: normalizeError(e).message }); throw e; }
        });
    }
    async function retryReference(row: Row) {
        if (!row.image?.file) return;
        await run(async () => {
            try { const saved = await persistImage(row.image!); updateRows(rows.map(r => r.key === row.key ? { ...r, image: saved } : r)); }
            catch (e) { updateRows(rows.map(r => r.key === row.key ? { ...r, image: { ...row.image!, error: normalizeError(e).message } } : r)); throw e; }
        });
    }
    async function resultAsSource() {
        if (!result) return;
        await run(async () => {
            const asset = await api.importImage(await api.readArtifact(result.artifactId));
            setImage({ name: "生成结果", width: asset.width, height: asset.height, previewUrl: asset.previewUrl, asset });
            patch({ imageId: asset.id, mode: "i2i" });
            setMessage("已将生成结果导入为图生图底图，尚未发送新请求。");
        });
    }
    function ready(r: Row) { return !!r.encoding && r.encoding.model === input.model && (r.information === -1 || r.encoding.informationExtracted === r.information); }
    async function encode(row: Row, paid: boolean) { if (!row.image?.asset) throw new Error("参考图尚未保存，请先完成导入。"); let v: VibeAsset; try {
        v = await api.encodeVibe({ connectionId: input.connectionId, imageId: row.image.asset.id, model: input.model, informationExtracted: row.information, confirmPaid: paid });
    }
    catch (e) {
        if (paid)
            onTasks();
        throw e;
    } updateRows(rows.map(r => r.key === row.key ? { ...r, encoding: v } : r)); setMessage(v.cacheHit ? "复用了本地氛围编码，没有发送收费请求。" : "氛围编码已保存，之后可复用。"); }
    async function requestGenerate() {
        await run(async () => {
            const issue = localParameterError(input);
            if (issue)
                throw new Error(issue);
            if (rows.some(r => !ready(r))) {
                setError("有氛围参考尚未编码或已过期。请先进行信息提取，或移除该参考。参考状态有效前无法提交生成请求。");
                return;
            }
            if (input.mode === "i2i" && !input.imageId) {
                setError("请先导入图生图底图。");
                return;
            }
            if (rows.reduce((sum, r) => sum + r.strength, 0) > 1.000001) {
                setError("当前版本氛围总强度不得超过 1，不会自动改权重。");
                return;
            }
            const tasks = await api.listTasks();
            if (tasks.some(t => !t.acknowledged && ["submitting", "running", "outcome_unknown"].includes(t.state))) {
                onTasks();
                throw new Error("存在未核对的付费任务；请在设置中核对所选服务的任务结果及费用。");
            }
            if (!connections.some(c => c.profile.id === (input.connectionId ?? "default-novelai")))
                throw new Error("连接配置未读取或已删除，不能提交收费请求。");
            const snapshot = structuredClone({ ...input, imageId: input.mode === "i2i" ? input.imageId : null, vibes: rows.map(r => ({ encodingId: r.encoding!.id, strength: r.strength })), confirmPaid: true });
            setConfirmation({ title: "确认生成一张图片", description: `连接：${selected?.name ?? "未知"} · ${input.model.includes("curated") ? "V4.5 Curated" : "V4.5 Full"} · ${input.width} × ${input.height} · ${input.steps} 步 · ${input.mode === "i2i" ? "图生图" : "文生图"} · ${rows.length} 个已编码氛围参考。${generationCost()} 最终以所选服务消费记录为准。`, run: async () => { try {
                    const r = await api.submitGeneration(snapshot);
                    setResult(r);
                    setMessage(`已保存结果。Seed: ${r.seed}`);
                }
                catch (e) {
                    onTasks();
                    throw e;
                } } });
        });
    }
    const selected = connections.find(c => c.profile.id === (input.connectionId ?? "default-novelai"))?.profile;
    function generationCost() { return selected?.generationUsd != null ? `预计生成费 $${selected.generationUsd.toFixed(3)}（1 张；不含新增参考编码）。` : "生成费用未配置 / 由官方账户决定，不保证免费。"; }
    function encodingCost() { return selected?.encodingUsd != null ? `首次编码预计 $${selected.encodingUsd.toFixed(3)}，本地缓存命中不发送请求。` : "编码费用未配置，请核对服务计费。"; }
    const disabled = busy || !!confirmation;
    const workbenchStyle = { "--editor-width": `${panelWidths.editor}px`, "--controls-width": `${panelWidths.controls}px` } as CSSProperties;
    function separator(kind: "editor" | "controls", label: string) {
        const value = panelWidths[kind];
        return <div className={`workbench-divider ${kind}`} role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={kind === "editor" ? 260 : 220} aria-valuemax={Math.floor(available - (kind === "editor" ? panelWidths.controls : panelWidths.editor) - 240)} aria-valuenow={Math.round(value)} tabIndex={0} onPointerDown={e => beginResize(kind, e)} onPointerMove={e => { const current = drag.current; if (current?.kind === kind)
            setPanel(kind, current.startValue + (e.clientX - current.startX) * (kind === "editor" ? 1 : -1)); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={() => setRatios(readWidths(null))} onKeyDown={e => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
            return; e.preventDefault(); setPanel(kind, value + (e.key === "ArrowRight" ? 1 : -1) * (kind === "editor" ? 1 : -1) * (e.shiftKey ? 40 : 10)); }}/>;
    }
    return <><section className="connection-toolbar" aria-label="API 连接状态"><span>API 配置：</span><strong>{selected?.name ?? "未选择"}</strong><button type="button" disabled={disabled} onClick={onOpenSettings}>API 设置</button>{connectionError && <p className="connection-error" role="alert">API 配置：{connectionError}</p>}</section><div className="workbench" ref={workbenchRef} style={workbenchStyle}>
    <div className="editor-column">
      <DrawingPresets api={api} native={native} input={input} disabled={disabled} retention={retention} onRetention={setRetention} onArtist={p => { setInput(applyArtistString(input, p)); setMessage("已应用画师串；其余提示词与图像生成参数保持不变。"); }} onApply={p => { setRows([]); setInput(applyDrawingPreset(input, p, retention)); setMessage("已应用绘图配置；连接与底图保持不变。"); }}/>
      <PromptEditor doc={doc} disabled={disabled} onChange={d => patch({ draft: { ...input.draft, promptDocument: d, prompt: compilePrompt(d) } })}/>
      <section className="panel negative-panel">
        <label htmlFor="negative">负向提示词</label>
        <ResizableTextArea initialHeight={82} minHeight={60} id="negative" className="negative" value={input.draft.negativePrompt} disabled={disabled} onChange={e => patch({ draft: { ...input.draft, negativePrompt: e.target.value } })} spellCheck={false} placeholder="输入需要排除的标签"/>
        <div className="actions"><button disabled={disabled} onClick={() => { if (window.confirm("清空当前提示词？画师串与负向提示词按保留选项处理；采样参数、API 配置及参考图保持不变。")) setInput(clearPromptDraft(input, retention)); }}>清空提示词</button><button disabled={!native || disabled} onClick={() => void load()}>读取草稿</button><button className="tonal" disabled={!native || disabled} onClick={() => void save()}>保存草稿</button></div>
      </section>
    </div>
    {separator("editor", "调整提示词与预览宽度")}
    <div className="result-column">
      <section className="panel stage">
        <div className="panel-heading"><h2>图像预览</h2>{busy && <span className="chip" role="status">处理中</span>}</div>
        <ResultViewer result={result} disabled={disabled} onExport={() => void run(async () => { if (result && await api.exportArtifact(result.artifactId))
        setMessage("已导出原始 PNG。"); })} onReuseSeed={() => { if (result)
        patch({ seed: result.seed }); }} onUseSource={() => void resultAsSource()}/>
        {message && <p role="status" className="success">{message}</p>}{error && <div role="alert" className="error">{error}</div>}
        <button className="primary generate" disabled={!native || disabled || !input.draft.prompt.trim()} onClick={() => void requestGenerate()}>{busy ? "处理中…" : native ? "生成图像" : "生成图像（仅桌面端）"}</button>
        <p className="hint generate-hint">提交前确认费用；失败不自动重试。</p>
      </section>
    </div>
    {separator("controls", "调整预览与参数宽度")}
    <div className="controls-column" aria-label="生成参数与参考图">
      <section className="panel parameters"><div className="panel-heading"><h2>生成参数</h2></div>
        <fieldset disabled={disabled}>
          <div className="generation-mode" role="group" aria-label="生成模式">
            <label><input type="radio" name="generation-mode" value="txt2img" checked={input.mode === "txt2img"} onChange={() => patch({ mode: "txt2img" })}/>文生图</label>
            <label><input type="radio" name="generation-mode" value="i2i" checked={input.mode === "i2i"} onChange={() => patch({ mode: "i2i" })}/>图生图</label>
          </div><div className="field-grid">
          <label className="wide">模型<select value={input.model} onChange={e => patch({ model: e.target.value })}><option value="nai-diffusion-4-5-full">NAI V4.5 Full</option><option value="nai-diffusion-4-5-curated">NAI V4.5 Curated</option></select></label>
          <label>宽度（px）<input type="number" min="256" max="1536" step="64" value={input.width} onChange={e => patch({ width: Number(e.target.value) })}/></label>
          <label>高度（px）<input type="number" min="256" max="1536" step="64" value={input.height} onChange={e => patch({ height: Number(e.target.value) })}/></label>
          <div className="presets wide">{SIZE_PRESETS.slice(0, 3).map(p => <button key={p.name} type="button" title={p.width + " × " + p.height} onClick={() => patch({ width: p.width, height: p.height })}>{p.name}</button>)}<button type="button" aria-label="交换宽高" title="交换宽度与高度" onClick={() => patch({ width: input.height, height: input.width })}>⇄</button></div>
          <label className="wide">尺寸预设<select aria-label="尺寸预设" value={SIZE_PRESETS.find(p => p.width === input.width && p.height === input.height)?.name ?? "custom"} onChange={e => { const p = SIZE_PRESETS.find(p => p.name === e.target.value); if (p)
        patch({ width: p.width, height: p.height }); }}><option value="custom">自定义尺寸</option>{SIZE_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name} · {p.width} × {p.height}</option>)}</select></label>
          <p className="hint wide pixel-count">{(input.width * input.height / 1000000).toFixed(2)} MP · 上限 1.05 MP</p>
          <label>采样步数<input type="number" min="1" max="28" value={input.steps} onChange={e => patch({ steps: Number(e.target.value) })}/></label>
          <label title="Guidance">提示词引导强度<input type="number" min="1" max="10" step="0.1" value={input.guidance} onChange={e => patch({ guidance: Number(e.target.value) })}/></label>
          <label className="wide">采样器<select value={input.sampler} onChange={e => patch({ sampler: e.target.value })}><option value="k_euler_ancestral">Euler a</option><option value="k_euler">Euler</option></select></label>
          <div className="seed-mode wide"><span>Seed 模式</span><div className="segmented"><button type="button" className={input.seed === null ? "selected" : ""} onClick={() => patch({ seed: null })}>随机 Seed</button><button type="button" className={input.seed !== null ? "selected" : ""} onClick={() => patch({ seed: input.seed ?? result?.seed ?? 0 })}>固定 Seed</button></div></div>
          <label className="wide">随机种子（Seed）<input type="number" min="0" max="4294967295" value={input.seed ?? ""} placeholder="留空则随机" onChange={e => patch({ seed: e.target.value === "" ? null : Number(e.target.value) })}/></label>
        </div></fieldset>
        {localParameterError(input) && <p className="error" role="alert">{localParameterError(input)}</p>}
        <details className="limits"><summary>当前版本限制</summary><p className="hint">单张生成；尺寸为 64 的倍数，总像素不超过 1,048,576；最多 28 步。暂不支持多角色独立提示词。这些是应用限制，不代表服务全部规则。</p></details>
      </section>
      {input.mode === "i2i" && <details className="panel reference-panel" open>
        <summary>图生图底图</summary><div className="reference-body">
          <p className="hint">底图按目标比例中心裁剪后缩放。</p>
          <ImageDropZone label="导入底图" disabled={!native || disabled} onFiles={files => void importSources(files, false)}/>
          {image && <div className="source-selection"><img className="source-thumb" src={image.previewUrl} alt="图生图底图"/><div><strong title={image.name}>{image.name}</strong><small>{image.width} × {image.height} · {image.asset ? "已保存" : "未保存"}</small></div><div className="actions">{image.file && <button disabled={disabled} onClick={() => void retrySource()}>重新导入底图</button>}<button disabled={disabled} onClick={() => { setImage(undefined); patch({ imageId: null }); }}>移除底图</button></div>{image.error && <p className="error" role="alert">底图未保存：{image.error}</p>}</div>}{input.imageId && !image && <p className="hint">已恢复底图引用。</p>}
          <div className="field-grid"><label title="Strength">重绘强度<input type="number" min="0" max="1" step="0.05" value={input.strength} disabled={disabled} onChange={e => patch({ strength: Number(e.target.value) })}/></label><label title="Noise">噪声强度<input type="number" min="0" max="1" step="0.05" value={input.noise} disabled={disabled} onChange={e => patch({ noise: Number(e.target.value) })}/></label></div>
        </div>
      </details>}
      <details className="panel reference-panel" open>
        <summary>氛围参考<span className="chip">{rows.length}/4</span></summary><div className="reference-body">
          <p className="hint">Vibe Transfer 编码可能收费；仅在确认后提交，相同素材与参数优先复用缓存。</p>
          <ImageDropZone label="添加参考图" multiple disabled={!native || disabled || rows.length >= 4} onFiles={files => void importSources(files, true)}/>
          {rows.map((r, index) => <article className="vibe-row" key={r.key}>
            <div className="vibe-heading">{r.image && <img src={r.image.previewUrl} alt={`氛围参考 ${index + 1}`}/>}<div><strong>参考 {index + 1}</strong><small>{r.image ? `${r.image.width} × ${r.image.height} · ${r.image.asset ? (ready(r) ? "编码可用" : "已保存，待提取") : "未保存"}` : (ready(r) ? "编码可用" : "需要编码")}</small></div><button aria-label={`移除参考 ${index + 1}`} disabled={disabled} onClick={() => updateRows(rows.filter(v => v.key !== r.key))}>移除</button></div>
            {r.image?.name && <p className="image-file-name" title={r.image.name}>{r.image.name}</p>}
            {r.image?.error && <p className="error" role="alert">参考图未保存：{r.image.error}</p>}
            {r.image?.file && <button disabled={disabled} onClick={() => void retryReference(r)}>重新导入参考 {index + 1}</button>}
            <div className="field-grid">{r.image && <label>信息提取量<input type="number" min="0" max="1" step="0.05" disabled={disabled} value={r.information} onChange={e => updateRows(rows.map(v => v.key === r.key ? { ...v, information: Number(e.target.value), encoding: undefined } : v))}/></label>}<label>参考强度<input type="number" min="0" max="1" step="0.05" disabled={disabled} value={r.strength} onChange={e => updateRows(rows.map(v => v.key === r.key ? { ...v, strength: Number(e.target.value) } : v))}/></label></div>
            {r.image && <div className="actions"><button disabled={disabled || !native || !r.image.asset} onClick={() => void run(() => encode(r, false))}>查找缓存</button><button className="tonal" disabled={disabled || !native || !r.image.asset} onClick={() => setConfirmation({ title: "确认氛围编码", description: `连接：${selected?.name ?? "未知"} · 参考 ${index + 1} · 信息提取量 ${r.information}。未命中缓存时提交一次编码。${encodingCost()} 编码成功后即使图像生成失败也可能收费。`, run: () => encode(r, true) })}>编码 / 复用</button></div>}
          </article>)}
          <p className="hint">最多 4 张，参考强度总和 ≤ 1；不自动归一化。</p>
        </div>
      </details>
    </div>
  </div>{confirmation && <Confirm value={confirmation} onCancel={() => setConfirmation(undefined)} onAccept={() => { const action = confirmation.run; setConfirmation(undefined); void run(action); }}/>}</>;
}
