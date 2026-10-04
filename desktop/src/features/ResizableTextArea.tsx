import { useRef, useState } from "react";
import type { TextareaHTMLAttributes } from "react";
interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    initialHeight?: number;
    minHeight?: number;
}
export default function ResizableTextArea({ initialHeight = 240, minHeight = 110, ...props }: Props) {
    const [height, setHeight] = useState(initialHeight);
    const drag = useRef<{
        y: number;
        height: number;
    } | null>(null);
    const label = props["aria-label"] ?? (props.id === "negative" ? "负向输入区" : "正向输入区");
    const resize = (value: number) => setHeight(Math.max(minHeight, Math.min(1600, value)));
    return <div className="resizable-textarea">
    <textarea {...props} style={{ ...props.style, height, minHeight, resize: "none" }}/>
    <div className="textarea-resize-handle" role="separator" aria-orientation="horizontal" aria-label={`调整${label}高度`} aria-valuemin={minHeight} aria-valuemax={1600} aria-valuenow={height} tabIndex={0} onPointerDown={e => { if (e.button !== 0)
        return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, height }; }} onPointerMove={e => { if (drag.current)
        resize(drag.current.height + e.clientY - drag.current.y); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={e => { if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
        return; e.preventDefault(); resize(height + (e.key === "ArrowDown" ? 20 : -20)); }} onDoubleClick={() => setHeight(initialHeight)} title="拖动调整高度；方向键微调；双击重置"/>
  </div>;
}
