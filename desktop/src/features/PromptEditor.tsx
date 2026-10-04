import ResizableTextArea from "./ResizableTextArea";
import type { PromptDocument, PromptBlock } from "../platform/types";
import { compilePrompt, compileBody } from "./prompt";

export default function PromptEditor({ doc, onChange, disabled = false }: {
    doc: PromptDocument;
    onChange: (doc: PromptDocument) => void;
    disabled?: boolean;
}) {
    function edit(id: string, patch: Partial<PromptBlock>) {
        onChange({ ...doc, blocks: doc.blocks.map(block => block.id === id ? { ...block, ...patch } : block) });
    }
    function move(index: number, delta: number) {
        const blocks = [...doc.blocks];
        const next = index + delta;
        if (next < 0 || next >= blocks.length) return;
        [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
        onChange({ ...doc, blocks });
    }
    return <section className="panel prompt-editor">
        <div className="panel-heading"><h2>提示词</h2><span className="chip">{compilePrompt(doc).length} 字符</span></div>
        <label htmlFor="artist-string">画师串</label>
        <ResizableTextArea id="artist-string" aria-label="画师串" initialHeight={70} minHeight={50} value={doc.stylePrompt ?? ""} disabled={disabled}
            onChange={e => onChange({ ...doc, stylePrompt: e.target.value })} placeholder="画师标签及权重，独立于正向提示词" spellCheck={false}/>
        <div className="segmented" aria-label="提示词编辑模式">
            <button className={doc.mode === "raw" ? "selected" : ""} disabled={disabled} onClick={() => onChange({ ...doc, mode: "raw" })}>原文编辑</button>
            <button className={doc.mode === "layered" ? "selected" : ""} disabled={disabled} onClick={() => onChange({ ...doc, mode: "layered" })}>分层编辑</button>
        </div>
        <p className="hint">画师串置于正向提示词之前。原文与分层内容独立保留，按当前编辑模式提交。</p>
        {doc.mode === "raw" ? <>
            <label htmlFor="prompt">正向提示词</label>
            <ResizableTextArea id="prompt" className="raw-prompt" value={doc.raw} disabled={disabled}
                onChange={e => onChange({ ...doc, raw: e.target.value })} placeholder="输入标签或描述，保留原始顺序与权重语法" spellCheck={false}/>
        </> : <div className="prompt-blocks">{doc.blocks.map((block, index) =>
            <details className={block.enabled ? "prompt-block" : "prompt-block off"} key={block.id} open={block.text !== "" || index < 2}>
                <summary>
                    <input aria-label={`启用${block.title}`} type="checkbox" checked={block.enabled} disabled={disabled}
                        onClick={e => e.stopPropagation()} onChange={e => edit(block.id, { enabled: e.target.checked })}/>
                    <span>{block.title}</span><small>{block.text.length || "空"}</small>
                </summary>
                <div className="block-body">
                    <div className="block-tools">
                        <button type="button" aria-label={`上移${block.title}`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑ 上移</button>
                        <button type="button" aria-label={`下移${block.title}`} disabled={disabled || index === doc.blocks.length - 1} onClick={() => move(index, 1)}>↓ 下移</button>
                    </div>
                    <ResizableTextArea initialHeight={110} aria-label={block.title} value={block.text} disabled={disabled}
                        onChange={e => edit(block.id, { text: e.target.value })} spellCheck={false}/>
                </div>
            </details>
        )}</div>}
        <details className="prompt-preview"><summary>查看提交文本</summary><pre data-testid="compiled-prompt">{compilePrompt(doc) || "（空）"}</pre></details>
        {doc.mode === "layered" && <button className="text-button" disabled={disabled} onClick={() => {
            if (doc.raw && !window.confirm("确认以分层内容替换正向提示词原文？画师串与分层内容保持不变。")) return;
            onChange({ ...doc, raw: compileBody({ ...doc, mode: "layered" }), mode: "raw" });
        }}>将分层内容写入原文</button>}
    </section>;
}
