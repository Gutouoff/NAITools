import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApi } from "../platform/desktop-api";
import type { ArtifactMetadata, GenerationInput, HistoryItem, HistoryPage } from "../platform/types";
import { normalizeError } from "../platform/types";

type Selection = { item?: HistoryItem; demo?: DemoItem; url: string; metadata?: ArtifactMetadata };
type DemoItem = { id: string; name: string; url: string; note: string };
const DEMOS: DemoItem[] = [
  { id: "demo-01", name: "示例图像 01", url: "/demo-history/demo-01.png", note: "仅用于界面预览，不属于历史记录。" },
  { id: "demo-02", name: "示例图像 02", url: "/demo-history/demo-02.png", note: "仅用于界面预览，不属于历史记录。" },
  { id: "demo-03", name: "示例图像 03", url: "/demo-history/demo-03.png", note: "仅用于界面预览，不属于历史记录。" },
];
function day(ms: number) { return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }); }
function dateTime(ms: number) { return new Date(ms).toLocaleString(); }
export default function History({ api, native, onReplay }: { api: DesktopApi; native: boolean; onReplay: (input: GenerationInput) => void }) {
  const [page, setPage] = useState<HistoryPage>();
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Selection>();
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [dateFilter, setDateFilter] = useState("all");
  const loading = useRef(false);
  const selectionVersion = useRef(0);
  async function load(append = false) {
    if (!native || loading.current) return;
    const before = append ? page?.nextCursor : undefined;
    if (append && !before) return;
    loading.current = true;
    setBusy(true); setError("");
    try {
      const next = await api.listHistory({ limit: 60, before });
      setPage(current => ({
        items: append ? [...new Map([...(current?.items ?? []), ...next.items].map(item => [item.id, item])).values()] : next.items,
        nextCursor: next.nextCursor,
      }));
      if (!append) {
        setThumbs({});
        selectionVersion.current += 1;
        setSelected(undefined);
      }
      let failed = 0;
      // Bound IPC fan-out and update each batch; a missing thumbnail must not hide readable history.
      for (let offset = 0; offset < next.items.length; offset += 6) {
        const values = await Promise.all(next.items.slice(offset, offset + 6).map(async item => {
          try { return [item.id, await api.readArtifact(item.artifactId, true)] as const; }
          catch { failed += 1; return [item.id, null] as const; }
        }));
        setThumbs(current => ({ ...current, ...Object.fromEntries(values) }));
      }
      if (failed) setError(`${failed} 张缩略图读取失败；历史记录仍可浏览。`);
    } catch (e) { setError(normalizeError(e).message); }
    finally { loading.current = false; setBusy(false); }
  }
  useEffect(() => { void load(); }, [api, native]);
  async function openItem(item: HistoryItem) {
    const version = ++selectionVersion.current;
    setError("");
    try {
      const [url, metadata] = await Promise.all([api.readArtifact(item.artifactId), api.readArtifactMetadata(item.artifactId)]);
      if (version === selectionVersion.current) setSelected({ item, url, metadata });
    } catch (e) { if (version === selectionVersion.current) setError(normalizeError(e).message); }
  }
  async function exportItem(item: HistoryItem) {
    try { await api.exportArtifact(item.artifactId); }
    catch (e) { setError(normalizeError(e).message); }
  }
  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of page?.items ?? []) counts.set(day(item.createdAtMs), (counts.get(day(item.createdAtMs)) ?? 0) + 1);
    return [...counts.entries()];
  }, [page]);
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (page?.items ?? []).filter(item => (!q || `${item.prompt} ${item.id}`.toLowerCase().includes(q)) && (dateFilter === "all" || day(item.createdAtMs) === dateFilter));
    return sort === "newest" ? filtered : [...filtered].reverse();
  }, [page, search, dateFilter, sort]);
  const selectedText = selected?.metadata?.entries ?? [];
  const selectedItem = selected?.item;
  return <section className="panel history-panel">
    <header className="history-toolbar"><div><h2>作品管理</h2><p className="hint">浏览生成记录、检查原始图像元数据，或将参数恢复到工作台。恢复操作不会自动提交生成请求。</p></div><div className="actions"><button disabled={!native || busy} onClick={() => void load()}>刷新</button></div></header>
    <div className="history-filters"><input aria-label="搜索历史记录" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索已加载记录的文件标识或提示词"/><select aria-label="日期筛选" value={dateFilter} onChange={e => setDateFilter(e.target.value)}><option value="all">全部日期</option>{days.map(([value, count]) => <option key={value} value={value}>{value}（{count}）</option>)}</select><select aria-label="排序方式" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="newest">最新在前</option><option value="oldest">最早在前</option></select></div>
    {!native && <><p className="notice">浏览器预览无法查询原生数据库。</p><p className="hint">以下仅显示示例画廊。</p></>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="history-layout">
      <aside className="history-sidebar"><strong>历史记录</strong><button className={dateFilter === "all" ? "selected" : ""} onClick={() => setDateFilter("all")}>全部作品 <span>{page?.items.length ?? 0}</span></button><div className="history-side-title">日期</div>{days.map(([value, count]) => <button key={value} className={dateFilter === value ? "selected" : ""} onClick={() => setDateFilter(value)}>{value}<span>{count}</span></button>)}</aside>
      <div className="history-gallery"><div className="gallery-heading"><strong>已加载 {items.length} 项</strong><span className="muted">真实记录与示例画廊分开显示</span></div>
        {items.length > 0 && <div className="history-grid">{items.map(item => <button className={`history-card ${selected?.item?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => void openItem(item)}><div className="history-thumb">{thumbs[item.id] ? <img src={thumbs[item.id] ?? undefined} alt="历史记录缩略图"/> : <span>{thumbs[item.id] === null ? "缩略图不可用" : "读取中…"}</span>}</div><time>{dateTime(item.createdAtMs)}</time><p>{item.prompt || "（无提示词）"}</p></button>)}</div>}
        <div className="gallery-heading demo-heading"><strong>示例画廊</strong><span className="muted">不写入历史记录，不代表已生成结果</span></div><div className="history-grid demo-grid">{DEMOS.map(demo => <button className={`history-card demo-card ${selected?.demo?.id === demo.id ? "selected" : ""}`} key={demo.id} onClick={() => { selectionVersion.current += 1; setError(""); setSelected({ demo, url: demo.url }); }}><div className="history-thumb"><img src={demo.url} alt={demo.name}/><span className="demo-badge">示例</span></div><time>{demo.name}</time><p>{demo.note}</p></button>)}</div>
        {page?.nextCursor && <button disabled={busy} onClick={() => void load(true)}>{busy ? "加载中…" : "加载更多"}</button>}
      </div>
      <aside className="history-detail">{selected ? <><div className="detail-preview"><img src={selected.url} alt="选中图像预览"/></div><div className="actions"><button onClick={() => { selectionVersion.current += 1; setSelected(undefined); }}>关闭</button>{selectedItem && <><button className="tonal" onClick={() => void exportItem(selectedItem)}>导出原始 PNG</button><button onClick={() => void api.historyRequest(selectedItem.id).then(onReplay).catch(e => setError(normalizeError(e).message))}>恢复到工作台</button></>}</div>{selectedItem ? <><dl className="history-facts"><div><dt>创建时间</dt><dd>{dateTime(selectedItem.createdAtMs)}</dd></div><div><dt>尺寸</dt><dd>{selected.metadata?.width && selected.metadata.height ? `${selected.metadata.width} × ${selected.metadata.height}` : ""}</dd></div><div><dt>格式</dt><dd>{selected.metadata?.format ?? ""}</dd></div></dl><label className="detail-label">提示词<textarea readOnly value={selectedItem.prompt}/></label><details open><summary>图像元数据</summary><p className="hint">读取 PNG tEXt 与未压缩 iTXt 文本；暂不支持压缩或隐写元数据。最多显示 128 项，每项最多 65,536 个字符。</p>{selectedText.length ? <div className="metadata-list">{selectedText.map((entry, index) => <div key={`${entry.key}-${index}`}><dt>{entry.key}</dt><dd>{entry.value}</dd></div>)}</div> : <p className="muted">未读取到 NovelAI 元数据。</p>}</details></> : <p className="hint">{selected.demo?.note}</p>}</> : <div className="history-detail-empty"><strong>选择一张图像</strong><span>右侧将显示预览、提示词与实际读取到的元数据。</span></div>}</aside>
    </div>
  </section>;
}
