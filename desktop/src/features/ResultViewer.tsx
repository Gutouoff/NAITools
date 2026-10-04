import { useEffect, useRef, useState } from "react";
import type { GenerationResult } from "../platform/types";

interface Props {
    result?: GenerationResult;
    disabled: boolean;
    onExport: () => void;
    onReuseSeed: () => void;
    onUseSource: () => void;
}
interface Pan { x: number; y: number }
interface DragOrigin extends Pan { px: number; py: number }

export default function ResultViewer({ result, disabled, onExport, onReuseSeed, onUseSource }: Props) {
    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
    const stage = useRef<HTMLDivElement>(null);
    const drag = useRef<DragOrigin | null>(null);

    useEffect(() => {
        setScale(1);
        setPan({ x: 0, y: 0 });
        drag.current = null;
    }, [result?.artifactId]);

    function zoom(value: number) {
        setScale(Math.max(1, Math.min(8, value)));
        if (value <= 1) setPan({ x: 0, y: 0 });
    }

    useEffect(() => {
        const node = stage.current;
        if (!node) return;
        // React's passive wheel handler cannot cancel browser Ctrl+wheel zoom.
        const wheel = (event: WheelEvent) => {
            if (!result || !event.ctrlKey) return;
            event.preventDefault();
            zoom(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
        };
        node.addEventListener("wheel", wheel, { passive: false });
        return () => node.removeEventListener("wheel", wheel);
    }, [scale, result?.artifactId]);

    return <>
        <div ref={stage} className={"image-stage" + (scale > 1 ? " zoomed" : "")}
            onDoubleClick={() => zoom(1)}
            onPointerDown={event => {
                if (event.button !== 0 || scale <= 1 || !result) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
            }}
            onPointerMove={event => {
                const origin = drag.current;
                if (!origin) return;
                setPan({
                    x: Math.max(-2000, Math.min(2000, origin.px + event.clientX - origin.x)),
                    y: Math.max(-2000, Math.min(2000, origin.py + event.clientY - origin.y)),
                });
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onLostPointerCapture={() => { drag.current = null; }}>
            {result ? <img src={result.imageUrl} alt="NovelAI 生成结果" draggable={false}
                style={{ transform: "translate(" + pan.x + "px," + pan.y + "px) scale(" + scale + ")" }}/> :
                <div className="empty-stage"><p>暂无生成结果</p></div>}
        </div>
        {result && <div className="result-tools">
            <div className="viewer-zoom">
                <button aria-label="缩小预览" disabled={scale <= 1} onClick={() => zoom(scale / 1.25)}>−</button>
                <span>{Math.round(scale * 100)}%</span>
                <button aria-label="放大预览" disabled={scale >= 8} onClick={() => zoom(scale * 1.25)}>＋</button>
                <button onClick={() => zoom(1)}>适应窗口</button>
            </div>
            <span className="seed-result">Seed: {result.seed}</span>
            <div className="actions">
                <button disabled={disabled} onClick={onReuseSeed}>复用 Seed</button>
                <button disabled={disabled} onClick={onUseSource}>用作底图</button>
                <button disabled={disabled} onClick={onExport}>导出 PNG</button>
            </div>
        </div>}
    </>;
}
