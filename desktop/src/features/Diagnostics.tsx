import type {BootInfo} from "../platform/types";
import projectLicense from "../../licenses/PROJECT-LICENSE.txt?raw";
export default function Diagnostics({boot,rendererMs}:{boot?:BootInfo;rendererMs?:number}) {
  const ms=(value:number|null|undefined)=>value==null?"未测量":`${value.toFixed(1)} ms`;
  return <section className="panel diagnostics">
    <div className="panel-heading"><h2>NAITools</h2><span className="chip">{boot?.appVersion??"—"}</span></div>
    <p>NovelAI 图像生成桌面工具。</p>
    <dl><dt>项目</dt><dd>Gutouoff / NAITools</dd><dt>许可证</dt><dd>MIT</dd><dt>来源</dt><dd>基于 Langbai 的 novelai-image-desktop 项目重构，保留原版权声明。</dd></dl>
    <details className="about-section"><summary>开源许可</summary><pre className="license-text">{projectLicense}</pre><p className="hint">第三方依赖各自遵循原许可证，详见源码中的 THIRD_PARTY_NOTICES.md。</p></details>
    <details className="about-section"><summary>运行诊断</summary>
      <dl><dt>技术栈</dt><dd>Rust + Tauri + React</dd><dt>运行方式</dt><dd>{boot?.runtime??"未连接"}</dd><dt>本地接口版本</dt><dd>{boot?.schemaVersion??"未知"}</dd><dt>数据存储</dt><dd>{boot?.storage==="isolated_sqlite_lazy"?"SQLite（按需初始化，非可用性检测）":"不可用"}</dd>
      <dt>宿主计时</dt><dd>{ms(boot?.hostElapsedMs)}</dd><dt>宿主收到渲染通知</dt><dd>{ms(boot?.rendererReadyHostMs)}</dd><dt>页面渲染计时</dt><dd>{ms(rendererMs)}</dd></dl>
      <p className="hint">诊断计时不等于完整启动耗时；实际启动性能和内存仍需单独测量。</p>
    </details>
    <details className="about-section"><summary>功能与验证范围</summary><p className="hint">当前实现 V4.5 单图子集；真实文生图、图生图、氛围编码尚未付费验收。不代表完整官方 API 或最新模型支持。详见源码中的 VALIDATION.md。</p></details>
  </section>;
}
