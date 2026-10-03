import { Fragment, useState, type CSSProperties } from "react";
import { Icon } from "./components/icons";
import { composeLayeredPrompt, parseLayeredPrompt, PROMPT_LAYERS, type LayeredPromptDraft } from "./layered-prompt";
import "./layered-prompt.css";

const STORAGE_KEY = "langbai.prompt.layers.v1";

function loadDraft(positivePrompt: string): LayeredPromptDraft {
  try { return parseLayeredPrompt(localStorage.getItem(STORAGE_KEY), positivePrompt); }
  catch { return parseLayeredPrompt(null, positivePrompt); }
}

export function LayeredPromptEditor({
  positivePrompt, stylePrompt, onPositiveChange, onStyleChange,
}: {
  positivePrompt: string;
  stylePrompt: string;
  onPositiveChange: (value: string) => void;
  onStyleChange: (value: string) => void;
}) {
  const [saved, setSaved] = useState(() => loadDraft(positivePrompt));
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // An imported preset or a single-box edit owns the prompt now; retain it verbatim.
  const draft = saved.source === positivePrompt ? saved : parseLayeredPrompt(null, positivePrompt);
  const preview = [stylePrompt, positivePrompt].filter(Boolean).join(", ");

  function updateDraft(patch: Partial<LayeredPromptDraft>) {
    const next = { ...draft, ...patch };
    const source = composeLayeredPrompt(next);
    const updated = { ...next, source };
    setSaved(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* storage is optional */ }
    onPositiveChange(source);
  }

  function toggleCollapsed(index: number) {
    setCollapsed(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index]);
  }

  return (
    <div className="layered-prompt-editor">
      <div className="layered-prompt-list">
        {PROMPT_LAYERS.map((layer, index) => {
          const isStyle = index === 0;
          const text = isStyle ? stylePrompt : draft.layers[index - 1];
          const enabled = isStyle || draft.enabled[index - 1];
          const isCollapsed = collapsed.includes(index);
          return (
            <Fragment key={layer.name}>
            <section className="layered-prompt-layer" style={{ "--layer-color": layer.color } as CSSProperties}>
              <div className="layered-prompt-heading">
                <span className="layered-prompt-number">{index + 1}</span>
                <label htmlFor={`layered-prompt-${index}`} className="layered-prompt-name">{layer.name}</label>
                <span className="layered-prompt-hint">{layer.hint}</span>
                {!isStyle && <label className="layered-prompt-enabled"><input type="checkbox" checked={enabled} onChange={event => {
                  const next = [...draft.enabled]; next[index - 1] = event.target.checked;
                  updateDraft({ enabled: next });
                }} />启用</label>}
                <button type="button" className="layered-prompt-icon" onClick={() => toggleCollapsed(index)} title={isCollapsed ? "展开" : "收起"} aria-label={`${isCollapsed ? "展开" : "收起"}${layer.name}`} aria-expanded={!isCollapsed}>
                  <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} />
                </button>
              </div>
              {!isCollapsed && <div className="layered-prompt-body">
                <textarea id={`layered-prompt-${index}`} value={text} disabled={!enabled} spellCheck={false} rows={index === 0 ? 3 : 2}
                  placeholder={`填写${layer.name}标签，使用逗号分隔`}
                  onChange={event => {
                    if (isStyle) onStyleChange(event.target.value);
                    else { const next = [...draft.layers]; next[index - 1] = event.target.value; updateDraft({ layers: next }); }
                  }} />
                <small>{text.trim() ? `${text.split(",").filter(Boolean).length} 个词 · ${text.length} 字符` : "未填写"}</small>
              </div>}
            </section>
            {isStyle && draft.legacy && <section className="layered-prompt-legacy">
              <label htmlFor="layered-prompt-legacy">未分类原文 <small>旧正面串 / 导入内容，保留在第 2 层之前</small></label>
              <textarea id="layered-prompt-legacy" value={draft.legacy} rows={3} spellCheck={false}
                onChange={event => updateDraft({ legacy: event.target.value })} />
            </section>}
            </Fragment>
          );
        })}
      </div>
      <div className="layered-prompt-preview">
        <div className="layered-prompt-preview-head">
          <strong>合并预览</strong>
          <button type="button" className="layered-prompt-copy" title="复制合并提示词" aria-label="复制合并提示词" onClick={() => {
            void navigator.clipboard.writeText(preview).then(() => {
              setCopyFailed(false); setCopied(true); window.setTimeout(() => setCopied(false), 1500);
            }).catch(() => setCopyFailed(true));
          }}><Icon name="copy" />{copyFailed ? "复制失败" : copied ? "已复制" : "复制"}</button>
        </div>
        <div className="layered-prompt-preview-text">{preview || "暂无提示词"}</div>
        <small>第 1 层先于第 2–9 层提交 · {preview.length} 字符</small>
      </div>
    </div>
  );
}
