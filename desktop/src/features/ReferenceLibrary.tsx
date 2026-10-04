import { useEffect, useMemo, useState } from "react";

type ReferenceKind = "vibe" | "precise";
type ReferencePreset = { id: string; kind: ReferenceKind; name: string; note: string; createdAt: number; blob: Blob };
const DB_NAME = "naitools-reference-library";
const STORE = "presets";
function openLibrary(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("无法打开本地预设库。")); }); }
async function readAll(): Promise<ReferencePreset[]> { const db = await openLibrary(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE, "readonly"); const request = tx.objectStore(STORE).getAll(); request.onsuccess = () => resolve((request.result as ReferencePreset[]).sort((a, b) => b.createdAt - a.createdAt)); request.onerror = () => reject(request.error); }); }
async function putPreset(value: ReferencePreset) { const db = await openLibrary(); return new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
async function removePreset(id: string) { const db = await openLibrary(); return new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
function label(kind: ReferenceKind) { return kind === "vibe" ? "氛围迁移" : "精准参考"; }
function BlobImage({ blob, alt }: { blob: Blob; alt: string }) { const [url, setUrl] = useState(""); useEffect(() => { const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]); return url ? <img src={url} alt={alt}/> : <span>读取中…</span>; }
export default function ReferenceLibrary() {
  const [kind, setKind] = useState<ReferenceKind>("vibe");
  const [rows, setRows] = useState<ReferencePreset[]>([]);
  const [selected, setSelected] = useState<ReferencePreset>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);
  async function refresh() { setBusy(true); setError(""); try { setRows(await readAll()); setLoaded(true); } catch (e) { setError(e instanceof Error ? e.message : "预设库读取失败。"); } finally { setBusy(false); } }
  useEffect(() => { void refresh(); }, []);
  const visible = useMemo(() => rows.filter(row => row.kind === kind), [rows, kind]);
  async function importFile(file: File) { if (!file.type.startsWith("image/")) { setError("仅支持图像文件。未导入其他文件。"); return; } if (file.size > 16 * 1024 * 1024) { setError("参考文件不得超过 16 MB。"); return; } const preset: ReferencePreset = { id: crypto.randomUUID(), kind, name: name.trim() || file.name.replace(/\.[^.]+$/, ""), note: note.trim(), createdAt: Date.now(), blob: file }; setBusy(true); setError(""); try { await putPreset(preset); setRows(await readAll()); setSelected(preset); setName(""); setNote(""); } catch (e) { setError(e instanceof Error ? e.message : "预设保存失败。"); } finally { setBusy(false); } }
  async function remove(id: string) { if (!window.confirm("删除此参考预设？不会删除已生成图像，也不会向服务商发送请求。")) return; setBusy(true); try { await removePreset(id); setRows(await readAll()); if (selected?.id === id) setSelected(undefined); } catch (e) { setError(e instanceof Error ? e.message : "预设删除失败。"); } finally { setBusy(false); } }
  return <section className="panel reference-library"><header className="library-heading"><div><h2>参考预设库</h2><p className="hint">集中管理氛围迁移与精准参考文件。当前仅负责本地归档与预览，不臆造第三方接口字段，也不会自动提交服务请求。</p></div><button disabled={busy} onClick={() => void refresh()}>刷新</button></header>
    <div className="library-tabs"><button className={kind === "vibe" ? "selected" : ""} onClick={() => setKind("vibe")}>氛围迁移 <span>{rows.filter(r => r.kind === "vibe").length}</span></button><button className={kind === "precise" ? "selected" : ""} onClick={() => setKind("precise")}>精准参考 <span>{rows.filter(r => r.kind === "precise").length}</span></button></div>
    <div className="library-import"><div><strong>导入{label(kind)}文件</strong><p className="hint">支持 PNG、JPEG、WebP。文件保存在当前设备的应用本地存储中。</p></div><label className="file-button">选择文件<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void importFile(file); }}/></label><input value={name} onChange={e => setName(e.target.value)} placeholder="可选：预设名称"/><input value={note} onChange={e => setNote(e.target.value)} placeholder="可选：备注"/></div>
    {error && <p className="error" role="alert">{error}</p>}{!loaded && <p className="muted">正在读取预设库…</p>}{loaded && visible.length === 0 && <div className="library-empty">暂无{label(kind)}文件。导入后可在此集中查看和维护。</div>}
    <div className="library-body"><div className="reference-grid">{visible.map(row => <button className={`reference-card ${selected?.id === row.id ? "selected" : ""}`} key={row.id} onClick={() => setSelected(row)}><div className="reference-thumb"><BlobImage blob={row.blob} alt={row.name}/></div><strong>{row.name}</strong><small>{new Date(row.createdAt).toLocaleString()}</small></button>)}</div>{selected && <aside className="reference-detail"><BlobImage blob={selected.blob} alt={selected.name}/><h3>{selected.name}</h3><p className="hint">类型：{label(selected.kind)}</p>{selected.note && <p>{selected.note}</p>}<p className="hint">文件大小：{Math.ceil(selected.blob.size / 1024)} KB</p><button disabled={busy} onClick={() => void remove(selected.id)}>删除预设</button></aside>}</div>
  </section>;
}
