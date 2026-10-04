import type { BootInfo } from "../platform/types";
export default function Diagnostics({ boot, rendererMs }: { boot?: BootInfo; rendererMs?: number }) {
  const ms = (value: number | null | undefined) => value == null ? "未测量" : `${value.toFixed(1)} ms`;
  return <section className="panel diagnostics"><div className="panel-heading"><h2>可核验的框架状态</h2><span>NO PERFORMANCE CLAIMS</span></div>
    <dl><dt>运行方式</dt><dd>{boot?.runtime ?? "未连接"}</dd><dt>IPC 版本</dt><dd>{boot?.schemaVersion ?? "未知"}</dd>
      <dt>本地存储</dt><dd>{boot?.storage ?? "未初始化"}</dd><dt>NovelAI 生图接口</dt><dd>{boot?.naiContract.generationEnabled ? "V4.5 已观察子集 · 真实付费待验收" : "浏览器预览禁用"}</dd>
      <dt>宿主计时点</dt><dd>{ms(boot?.hostElapsedMs)}</dd><dt>宿主收到界面双帧通知</dt><dd>{ms(boot?.rendererReadyHostMs)}</dd>
      <dt>网页导航至双帧通知</dt><dd>{ms(rendererMs)}</dd></dl>
    <div className="notice">这些是开发诊断计时，不等于“点击 EXE 到可操作”的完整启动耗时；浏览器数据不能证明 PC 版更快。</div>
    <h3>本阶段不启动的组件</h3><p className="muted">Electron、Node sidecar、Python、模型加载、Harness、自动更新和旧历史目录扫描。</p>
    <h3>后续验收</h3><p className="muted">在同一台机器、同一份数据上比较发行版冷启动、热启动与整个进程树的内存占用。原生编译结果见 VALIDATION；发行版性能仍需要实测。</p>
  </section>;
}
