import { useRef, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
interface Props {
    label: string;
    disabled: boolean;
    multiple?: boolean;
    onFiles: (files: File[]) => void;
}
export function acceptedImages(files: File[]): File[] { return files.filter(f => ["image/png", "image/jpeg", "image/webp"].includes(f.type)); }
export default function ImageDropZone({ label, disabled, multiple = false, onFiles }: Props) {
    const [active, setActive] = useState(false), [error, setError] = useState("");
    const input = useRef<HTMLInputElement>(null);
    function accept(files: File[]) { if (disabled)
        return; const images = acceptedImages(files); if (!images.length) {
        setError("只支持 PNG、JPEG、WebP 图片。");
        return;
    } setError(""); onFiles(multiple ? images : images.slice(0, 1)); }
    function drop(e: DragEvent) { e.preventDefault(); setActive(false); accept(Array.from(e.dataTransfer.files)); }
    function paste(e: ClipboardEvent) { const files = Array.from(e.clipboardData.items).filter(i => i.kind === "file").map(i => i.getAsFile()).filter((f): f is File => f !== null); if (files.length) {
        e.preventDefault();
        accept(files);
    } }
    return <div className={"image-drop-zone" + (active ? " drag-over" : "")} tabIndex={disabled ? -1 : 0} role="group" aria-label={label + "拖放与粘贴区"} aria-disabled={disabled} onDragOver={e => { e.preventDefault(); if (!disabled)
        setActive(true); }} onDragLeave={() => setActive(false)} onDrop={drop} onPaste={paste}>
    <button type="button" disabled={disabled} onClick={() => input.current?.click()}>{label}</button><span className="hint">拖入图片，或聚焦此处后 Ctrl+V</span>
    <input ref={input} aria-label={label === "导入底图" ? "导入图生图底图" : "添加氛围参考"} type="file" accept="image/png,image/jpeg,image/webp" multiple={multiple} disabled={disabled} onChange={e => { accept(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = ""; }}/>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
