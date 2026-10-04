import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./components/icons";
import { featureText } from "./feature-text";
import { composeLayeredPrompt, parseLayeredPrompt, PROMPT_LAYERS, type LayeredPromptDraft } from "./layered-prompt";
import { DEFAULT_PROMPT_GRID, PROMPT_GRID_KEY, parsePromptGrid, type PromptGridPrefs } from "./prompt-grid";
import "./layered-prompt.css";

const STORAGE_KEY = "langbai.prompt.layers.v1";

function loadDraft(positivePrompt: string): LayeredPromptDraft {
  try { return parseLayeredPrompt(localStorage.getItem(STORAGE_KEY), positivePrompt); }
  catch { return parseLayeredPrompt(null, positivePrompt); }
}

export function LayeredPromptEditor({
  positivePrompt, stylePrompt, onPositiveChange, onStyleChange, onDraftChange, language,
}: {
  positivePrompt: string;
  stylePrompt: string;
  language?: string;
  onPositiveChange: (value: string) => void;
  onStyleChange: (value: string) => void;
  onDraftChange?: (serialized: string) => void;
}) {
  const ft = (key: string, params?: Record<string, string | number>) => featureText(language, key, params);
  const [saved, setSaved] = useState(() => loadDraft(positivePrompt));
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [grid, setGrid] = useState<PromptGridPrefs>(() => {
    try { return parsePromptGrid(localStorage.getItem(PROMPT_GRID_KEY)); }
    catch { return { ...DEFAULT_PROMPT_GRID }; }
  });
  const [showGridSettings, setShowGridSettings] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const resizing = useRef<{ index: number; x: number; y: number; span: number; height: number } | null>(null);
  useEffect(() => {
    const onExternal = (event: Event) => {
      const raw = (event as CustomEvent<string>).detail;
      if (typeof raw !== "string") return;
      try {
        const source = JSON.parse(raw) as { source?: unknown };
        if (typeof source.source === "string") setSaved(parseLayeredPrompt(raw, source.source));
      } catch { /* ignore invalid external drafts */ }
    };
    window.addEventListener("prompt-draft:external", onExternal);
    return () => window.removeEventListener("prompt-draft:external", onExternal);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PROMPT_GRID_KEY, JSON.stringify(grid)); } catch { /* optional */ }
  }, [grid]);

  function setBlockSize(index: number, span: number, height: number) {
    setGrid(current => ({ ...current, sizes: {
      ...current.sizes, [index]: {
        span: Math.max(1, Math.min(current.columns, Math.round(span))),
        height: Math.max(74, Math.min(420, Math.round(height))),
      },
    } }));
  }

  function resizeHandle(index: number, span: number, height: number) {
    return {
      role: "separator" as const, tabIndex: 0,
      "aria-label": ft("调整{layer}大小", { layer: ft(index === 9 ? "未分类原文" : PROMPT_LAYERS[index].name) }),
      title: ft("拖动调整宽度和高度；方向键也可调整"),
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizing.current = { index, x: event.clientX, y: event.clientY, span, height };
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const start = resizing.current;
        if (!start || start.index !== index) return;
        const columnWidth = (listRef.current?.clientWidth ?? 900) / grid.columns;
        setBlockSize(index, start.span + Math.round((event.clientX - start.x) / columnWidth), start.height + event.clientY - start.y);
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        resizing.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: () => { resizing.current = null; },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          setBlockSize(index, span + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0),
            height + (event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0));
        }
      },
    };
  }
  // An imported preset or a single-box edit owns the prompt now; retain it verbatim.
  const draft = saved.source === positivePrompt ? saved : parseLayeredPrompt(null, positivePrompt);
  const preview = [stylePrompt, positivePrompt].filter(Boolean).join(", ");

  function updateDraft(patch: Partial<LayeredPromptDraft>) {
    const next = { ...draft, ...patch };
    const source = composeLayeredPrompt(next);
    const updated = { ...next, source };
    setSaved(updated);
    const serialized = JSON.stringify(updated);
    try { localStorage.setItem(STORAGE_KEY, serialized); } catch { /* storage is optional */ }
    onDraftChange?.(serialized);
    window.dispatchEvent(new Event("prompt-draft:changed"));
    onPositiveChange(source);
  }

  function toggleCollapsed(index: number) {
    setCollapsed(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index]);
  }

  return (
    <div className="layered-prompt-editor">
      <div className="layered-prompt-grid-bar">
        <strong>{ft("提示词分层")}</strong>
        <button type="button" className="layered-prompt-icon" title={ft("网格设置")} aria-label={ft("网格设置")} aria-expanded={showGridSettings} onClick={() => setShowGridSettings(value => !value)}><Icon name="sliders" /></button>
        {showGridSettings && <div className="layered-prompt-grid-settings">
          <label>{ft("列数")} <input type="number" min="1" max="6" value={grid.columns} onChange={event => {
            const columns = Math.max(1, Math.min(6, Number(event.target.value) || 1));
            setGrid(current => ({ ...current, columns }));
          }} /></label>
          <label>{ft("行高")} <input type="range" min="74" max="260" step="4" value={grid.rowHeight} onChange={event => setGrid(current => ({ ...current, rowHeight: Number(event.target.value) }))} />{grid.rowHeight}px</label>
          <div className="layered-prompt-visibility" role="group" aria-label={ft("显示提示词块")}>
            {PROMPT_LAYERS.map((layer, index) => <label key={layer.name}><input type="checkbox" checked={!grid.hidden.includes(index)} onChange={event => setGrid(current => ({ ...current, hidden: event.target.checked ? current.hidden.filter(item => item !== index) : [...current.hidden, index] }))} />{ft(layer.name)}</label>)}
            {draft.legacy && <label><input type="checkbox" checked={!grid.hidden.includes(9)} onChange={event => setGrid(current => ({ ...current, hidden: event.target.checked ? current.hidden.filter(item => item !== 9) : [...current.hidden, 9] }))} />{ft("未分类原文")}</label>}
          </div>
          <button type="button" onClick={() => setGrid({ ...DEFAULT_PROMPT_GRID })}>{ft("恢复默认排列")}</button>
        </div>}
      </div>
      <div className="layered-prompt-list" ref={listRef} style={{ "--prompt-columns": grid.columns, "--prompt-row-height": `${grid.rowHeight}px` } as CSSProperties}>
        {PROMPT_LAYERS.map((layer, index) => {
          const isStyle = index === 0;
          const text = isStyle ? stylePrompt : draft.layers[index - 1];
          const enabled = isStyle || draft.enabled[index - 1];
          const isCollapsed = collapsed.includes(index);
          const size = grid.sizes[index];
          const span = Math.min(grid.columns, size?.span ?? 1);
          const height = size?.height ?? grid.rowHeight;
          return (
            <Fragment key={layer.name}>
            {!grid.hidden.includes(index) && <section className="layered-prompt-layer" style={{ "--layer-color": layer.color, gridColumn: `span ${span}`, height } as CSSProperties}>
              <div className="layered-prompt-heading">
                <span className="layered-prompt-number">{index + 1}</span>
                <label htmlFor={`layered-prompt-${index}`} className="layered-prompt-name">{ft(layer.name)}</label>
                <span className="layered-prompt-hint">{ft(layer.hint)}</span>
                {!isStyle && <label className="layered-prompt-enabled"><input type="checkbox" checked={enabled} onChange={event => {
                  const next = [...draft.enabled]; next[index - 1] = event.target.checked;
                  updateDraft({ enabled: next });
                }} />{ft("启用")}</label>}
                <button type="button" className="layered-prompt-icon" onClick={() => toggleCollapsed(index)} title={ft(isCollapsed ? "展开" : "收起")} aria-label={`${ft(isCollapsed ? "展开" : "收起")} ${ft(layer.name)}`} aria-expanded={!isCollapsed}>
                  <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} />
                </button>
              </div>
              {!isCollapsed && <div className="layered-prompt-body">
                <textarea id={`layered-prompt-${index}`} value={text} disabled={!enabled} spellCheck={false} rows={index === 0 ? 3 : 2}
                  placeholder={ft("填写{layer}标签，使用逗号分隔", { layer: ft(layer.name) })}
                  onChange={event => {
                    if (isStyle) onStyleChange(event.target.value);
                    else { const next = [...draft.layers]; next[index - 1] = event.target.value; updateDraft({ layers: next }); }
                  }} />
                <small>{text.trim() ? ft("{count} 个词 · {length} 字符", { count: text.split(",").filter(Boolean).length, length: text.length }) : ft("未填写")}</small>
              </div>}
              <div className="layered-prompt-size-handle" {...resizeHandle(index, span, height)} aria-valuenow={height} />
            </section>}
            {isStyle && draft.legacy && !grid.hidden.includes(9) && <section className="layered-prompt-legacy" style={{ gridColumn: `span ${Math.min(grid.columns, grid.sizes[9]?.span ?? 1)}`, height: grid.sizes[9]?.height ?? grid.rowHeight }}>
              <label htmlFor="layered-prompt-legacy">{ft("未分类原文")} <small>{ft("旧正面串 / 导入内容")}</small></label>
              <textarea id="layered-prompt-legacy" value={draft.legacy} rows={3} spellCheck={false}
                onChange={event => updateDraft({ legacy: event.target.value })} />
              <div className="layered-prompt-size-handle" {...resizeHandle(9, Math.min(grid.columns, grid.sizes[9]?.span ?? 1), grid.sizes[9]?.height ?? grid.rowHeight)} aria-valuenow={grid.sizes[9]?.height ?? grid.rowHeight} />
            </section>}
            </Fragment>
          );
        })}
      </div>
      <details className="layered-prompt-preview">
        <summary>{ft("合并预览")}</summary>
        <div className="layered-prompt-preview-head">
          <strong>{ft("合并预览")}</strong>
          <button type="button" className="layered-prompt-copy" title={ft("复制合并提示词")} aria-label={ft("复制合并提示词")} onClick={() => {
            void navigator.clipboard.writeText(preview).then(() => {
              setCopyFailed(false); setCopied(true); window.setTimeout(() => setCopied(false), 1500);
            }).catch(() => setCopyFailed(true));
          }}><Icon name="copy" />{ft(copyFailed ? "复制失败" : copied ? "已复制" : "复制")}</button>
        </div>
        <div className="layered-prompt-preview-text">{preview || ft("暂无提示词")}</div>
        <small>{ft("第 1 层先于第 2–9 层提交 · {count} 字符", { count: preview.length })}</small>
      </details>
    </div>
  );
}
