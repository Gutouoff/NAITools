import { useEffect, useState, lazy, Suspense } from "react";
import { getDesktopApi, type DesktopApi } from "./platform/desktop-api";
import type { BootInfo, GenerationInput } from "./platform/types";
import { normalizeError } from "./platform/types";
import Workbench from "./features/Workbench";
import { readSelectedConnection, rememberConnection } from "./features/generation-tools";
import { newPromptDocument } from "./features/prompt";
const History = lazy(() => import("./features/History"));
const ReferenceLibrary = lazy(() => import("./features/ReferenceLibrary"));
const Diagnostics = lazy(() => import("./features/Diagnostics"));
const Settings = lazy(() => import("./features/Settings"));
type Tab = "workbench" | "history" | "library" | "settings" | "diagnostics";
const initial: GenerationInput = { draft: { prompt: "", negativePrompt: "", promptDocument: newPromptDocument() }, model: "nai-diffusion-4-5-full", mode: "txt2img", width: 832, height: 1216, steps: 23, guidance: 5, sampler: "k_euler_ancestral", seed: null, imageId: null, strength: 0.7, noise: 0, vibes: [], confirmPaid: false };
export default function App() {
    const [api, setApi] = useState<DesktopApi>(), [boot, setBoot] = useState<BootInfo>(), [tab, setTab] = useState<Tab>("workbench"), [error, setError] = useState(""), [input, setInput] = useState<GenerationInput>(() => ({ ...initial, connectionId: readSelectedConnection() })), [rendererMs, setRendererMs] = useState<number>(), [replaySignal, setReplaySignal] = useState(0), [taskSignal, setTaskSignal] = useState(0), [connectionSignal, setConnectionSignal] = useState(0);
    const [taskStatus, setTaskStatus] = useState<"none" | "unknown" | "unavailable">("none");
    useEffect(() => {
        let active = true;
        void getDesktopApi().then(async (service) => {
            const b = await service.bootstrap();
            if (!active)
                return;
            setApi(service);
            setBoot(b);
            requestAnimationFrame(() => requestAnimationFrame(() => { if (active) {
                setRendererMs(performance.now());
                void service.markReady().then(v => { if (active)
                    setBoot(v); }).catch(e => { if (active)
                    setError(normalizeError(e).message); });
            } }));
        }).catch(e => { if (active)
            setError(normalizeError(e).message); });
        return () => { active = false; };
    }, []);
    useEffect(() => { if (input.connectionId)
        rememberConnection(input.connectionId); }, [input.connectionId]);
    const native = boot?.runtime === "tauri";
    useEffect(() => {
        let active = true;
        if (api && native) void api.listTasks().then(tasks => {
            if (active) setTaskStatus(tasks.some(task => task.state === "outcome_unknown" && !task.acknowledged) ? "unknown" : "none");
        }, () => { if (active) setTaskStatus("unavailable"); });
        return () => { active = false; };
    }, [api, native, taskSignal]);
    const titles = { workbench: "图像生成", history: "历史记录", library: "参考预设库", settings: "设置", diagnostics: "关于 NAITools" };
    return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">N</span><span className="brand-text">NAITools</span></div>
      <nav aria-label="主导航">{([["workbench", "工作台", "◈"], ["history", "历史记录", "▤"], ["library", "参考预设库", "▦"], ["settings", "设置", "⚙"], ["diagnostics", "关于", "ⓘ"]] as const).map(([id, title, icon]) => <button className={`nav-item ${tab === id ? "active" : ""}`} aria-label={title} aria-current={tab === id ? "page" : undefined} title={title} key={id} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span><span className="nav-label">{title}</span></button>)}
      </nav>
    </aside>
    <main className="main">
      <header className="page-header"><h1>{titles[tab]}</h1></header>
      {!native && boot && <div className="notice preview-notice">浏览器预览：本地保存、素材导入与生成不可用。</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {taskStatus !== "none" && tab !== "settings" && <div className="notice">{taskStatus === "unknown" ? "存在结果待核对的付费任务，新请求已暂停。" : "付费任务记录不可用，无法提交生成请求。"}<button onClick={() => setTab("settings")}>查看任务记录</button></div>}
      <div className="page-content">
        {api && <div className="workbench-page" hidden={tab !== "workbench"}><Workbench api={api} native={native} input={input} setInput={setInput} replaySignal={replaySignal} connectionSignal={connectionSignal} onOpenSettings={() => setTab("settings")} onTasks={() => setTaskSignal(s => s + 1)}/></div>}
        <Suspense fallback={<p className="muted">加载中…</p>}>
          {tab === "history" && api && <History api={api} native={native} onReplay={i => { setInput(i); setReplaySignal(s => s + 1); setTab("workbench"); }}/> }
          {tab === "library" && <ReferenceLibrary />}
          {tab === "settings" && api && <Settings api={api} native={native} taskSignal={taskSignal} onTasks={() => setTaskSignal(s => s + 1)} onConnections={() => setConnectionSignal(s => s + 1)} selectedId={input.connectionId ?? "default-novelai"} onSelect={id => { if (id === input.connectionId) return; setInput(i => ({ ...i, connectionId: id, vibes: [], confirmPaid: false })); setReplaySignal(s => s + 1); }}/> }
          {tab === "diagnostics" && <Diagnostics boot={boot} rendererMs={rendererMs}/>}
        </Suspense>
      </div>
    </main>
  </div>;
}
