import { useEffect, useMemo, useRef, useState } from "react";
import { deleteReference, readReferences, saveReference, validateReferenceFile } from "./reference-library-store";
import type { ReferenceKind, ReferencePreset } from "./reference-library-store";

function label(kind: ReferenceKind) {
  return kind === "vibe" ? "氛围迁移" : "精准参考";
}

function BlobImage({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <img src={url} alt={alt} loading="lazy"/> : <span>读取中…</span>;
}

async function verifyImage(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
  } catch {
    throw new Error("无法解码参考图像。请检查文件是否完整及格式是否正确。");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ReferenceLibrary() {
  const [kind, setKind] = useState<ReferenceKind>("vibe");
  const [rows, setRows] = useState<ReferencePreset[]>([]);
  const [selected, setSelected] = useState<ReferencePreset>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);
  const lock = useRef(false);
  const visible = useMemo(() => rows.filter(row => row.kind === kind), [rows, kind]);

  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "预设库操作失败。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function refresh() {
    await run(async () => {
      try {
        const next = await readReferences();
        setRows(next);
        setSelected(current => next.find(row => row.id === current?.id));
      } finally {
        setLoaded(true);
      }
    });
  }

  useEffect(() => { void refresh(); }, []);

  async function importFile(file: File) {
    await run(async () => {
      validateReferenceFile(file);
      await verifyImage(file);
      const preset: ReferencePreset = {
        id: crypto.randomUUID(), kind,
        name: name.trim() || file.name.replace(/\.[^.]+$/, "") || file.name,
        note: note.trim(), createdAt: Date.now(), blob: file,
      };
      await saveReference(preset);
      setRows(await readReferences());
      setSelected(preset);
      setName("");
      setNote("");
      setLoaded(true);
    });
  }

  async function remove(id: string) {
    if (lock.current || !window.confirm("删除此参考预设？不会删除已生成图像，也不会向服务商发送请求。")) return;
    await run(async () => {
      await deleteReference(id);
      setRows(await readReferences());
      setSelected(current => current?.id === id ? undefined : current);
    });
  }

  function switchKind(next: ReferenceKind) {
    setKind(next);
    setSelected(undefined);
  }

  return <section className="panel reference-library">
    <header className="library-heading">
      <div><h2>参考预设库</h2><p className="hint">集中管理氛围迁移与精准参考文件。本地归档与预览不会发送服务请求；尚未接入工作台参数应用。</p></div>
      <button disabled={busy} onClick={() => void refresh()}>刷新</button>
    </header>
    <div className="library-tabs">
      <button className={kind === "vibe" ? "selected" : ""} disabled={busy} onClick={() => switchKind("vibe")}>氛围迁移 <span>{rows.filter(r => r.kind === "vibe").length}</span></button>
      <button className={kind === "precise" ? "selected" : ""} disabled={busy} onClick={() => switchKind("precise")}>精准参考 <span>{rows.filter(r => r.kind === "precise").length}</span></button>
    </div>
    <div className="library-import">
      <div><strong>导入{label(kind)}文件</strong><p className="hint">支持 PNG、JPEG、WebP。文件暂存于当前设备的 WebView 本地存储；清理应用缓存可能删除预设，请保留原始文件。</p></div>
      <label className="file-button">选择文件<input aria-label="导入参考预设文件" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) void importFile(file);
      }}/></label>
      <input aria-label="参考预设名称" maxLength={80} disabled={busy} value={name} onChange={e => setName(e.target.value)} placeholder="可选：预设名称"/>
      <input aria-label="参考预设备注" maxLength={512} disabled={busy} value={note} onChange={e => setNote(e.target.value)} placeholder="可选：备注"/>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!loaded && <p className="muted">正在读取预设库…</p>}
    {loaded && !error && visible.length === 0 && <div className="library-empty">暂无{label(kind)}文件。导入后可在此集中查看和维护。</div>}
    <div className="library-body">
      <div className="reference-grid">{visible.map(row => <button className={`reference-card ${selected?.id === row.id ? "selected" : ""}`} key={row.id} onClick={() => setSelected(row)}>
        <div className="reference-thumb"><BlobImage blob={row.blob} alt={row.name}/></div>
        <strong>{row.name}</strong><small>{new Date(row.createdAt).toLocaleString()}</small>
      </button>)}</div>
      {selected && <aside className="reference-detail">
        <BlobImage blob={selected.blob} alt={selected.name}/><h3>{selected.name}</h3>
        <p className="hint">类型：{label(selected.kind)}</p>{selected.note && <p>{selected.note}</p>}
        <p className="hint">文件大小：{Math.ceil(selected.blob.size / 1024)} KB</p>
        <button disabled={busy} onClick={() => void remove(selected.id)}>删除预设</button>
      </aside>}
    </div>
  </section>;
}
