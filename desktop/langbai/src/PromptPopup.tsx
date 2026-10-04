import { useEffect, useRef, useState } from "react";
import { LayeredPromptEditor } from "./LayeredPromptEditor";
import { featureText } from "./feature-text";
import { isPromptWindowSnapshot, type PromptWindowSnapshot } from "./prompt-window-contract";
import "./prompt-popup.css";

const DRAFT_KEY = "langbai.prompt.layers.v1";

export default function PromptPopup() {
  const [snapshot, setSnapshot] = useState<PromptWindowSnapshot | null>(null);
  const [layered, setLayered] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const ft = (key: string) => featureText(snapshot?.language, key);
  const revision = useRef(-1);
  useEffect(() => {
    if (snapshot) document.title = featureText(snapshot.language, "提示词编辑");
  }, [snapshot?.language]);
  useEffect(() => {
    const bridge = window.promptWindowPopup;
    if (!bridge) return;
    const stop = bridge.onSnapshot(next => {
      if (!isPromptWindowSnapshot(next) || next.revision < revision.current) return;
      revision.current = next.revision;
      if (document.hasFocus() && root.current?.contains(document.activeElement)) return;
      try {
        if (next.draft) localStorage.setItem(DRAFT_KEY, next.draft);
        else localStorage.removeItem(DRAFT_KEY);
      } catch { /* optional storage */ }
      setSnapshot(next);
      if (next.draft) window.dispatchEvent(new CustomEvent("prompt-draft:external", { detail: next.draft }));
    });
    const requestAfterBlur = () => window.setTimeout(() => bridge.request(), 75);
    window.addEventListener("blur", requestAfterBlur);
    bridge.request();
    return () => { stop(); window.removeEventListener("blur", requestAfterBlur); };
  }, []);

  const edit = (field: "positivePrompt" | "negativePrompt" | "stylePrompt" | "promptTab", value: string) => {
    setSnapshot(current => current ? { ...current, [field]: value } : current);
    window.promptWindowPopup?.edit({ field, value });
  };
  const onBlur = () => {
    window.setTimeout(() => {
      if (!root.current?.contains(document.activeElement)) window.promptWindowPopup?.request();
    }, 0);
  };

  return <div className="prompt-popup" ref={root} onBlur={onBlur}>
    <header className="prompt-popup-header"><strong>{ft("提示词编辑")}</strong><span>{ft("与主窗口同步")}</span></header>
    {!snapshot ? <div className="prompt-popup-loading">{ft("正在连接主窗口...")}</div> : <>
      <div className="prompt-popup-controls">
        <div className="prompt-popup-tabs" role="tablist" aria-label={ft("提示词类型")}>
          <button type="button" role="tab" aria-selected={snapshot.promptTab === "positive"} className={snapshot.promptTab === "positive" ? "active" : ""} onClick={() => edit("promptTab", "positive")}>{ft("正面提示词")}</button>
          <button type="button" role="tab" aria-selected={snapshot.promptTab === "negative"} className={snapshot.promptTab === "negative" ? "active" : ""} onClick={() => edit("promptTab", "negative")}>{ft("负面提示词")}</button>
        </div>
        {snapshot.promptTab === "positive" && <div className="layered-prompt-mode" role="group" aria-label={ft("编辑方式")}>
          <button type="button" className={layered ? "active" : ""} onClick={() => setLayered(true)}>{ft("分层")}</button>
          <button type="button" className={!layered ? "active" : ""} onClick={() => setLayered(false)}>{ft("单框")}</button>
        </div>}
      </div>
      <main className="prompt-popup-body">
        {snapshot.promptTab === "positive" && layered ? <LayeredPromptEditor
          language={snapshot.language}
          positivePrompt={snapshot.positivePrompt}
          stylePrompt={snapshot.stylePrompt}
          onPositiveChange={value => edit("positivePrompt", value)}
          onStyleChange={value => edit("stylePrompt", value)}
          onDraftChange={value => window.promptWindowPopup?.edit({ field: "draft", value })}
        /> : <label className="prompt-popup-field">{snapshot.promptTab === "positive" ? ft("正面提示词") : ft("负面提示词")}
          <textarea value={snapshot.promptTab === "positive" ? snapshot.positivePrompt : snapshot.negativePrompt}
            onChange={event => edit(snapshot.promptTab === "positive" ? "positivePrompt" : "negativePrompt", event.target.value)}
            spellCheck={false} />
        </label>}
        {snapshot.promptTab === "positive" && !layered && <label className="prompt-popup-field prompt-popup-style">{ft("风格提示词")}
          <textarea value={snapshot.stylePrompt} onChange={event => edit("stylePrompt", event.target.value)} spellCheck={false} />
        </label>}
      </main>
    </>}
  </div>;
}
