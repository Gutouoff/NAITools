# 验证记录

本轮续接验证（以本机编译和运行输出为准）。旧版源码基线：`0665afb`。

## 已执行并通过

| 检查 | 结果 |
| --- | --- |
| Cargo 依赖下载 | `cargo fetch --target x86_64-pc-windows-msvc -v` 成功；已生成 `Cargo.lock`，随后使用 `--locked --offline` |
| 前端测试 | `npm test`：19/19 通过；包括提示词原文/分层一致性、重复与权重保留、浏览器隔离、IPC 映射、权限/CSP、错误脱敏与不重试 |
| Rust 测试 | `cargo test --workspace --locked --offline`：27/27 通过（宿主启动 3、core 13、IPC 集成 1、NAI 10）；包括不同 SQLite 连接同时提交的互斥检查 |
| 前端生产构建 | `npm run build`：TypeScript 类型检查 + Vite 生产构建通过 |
| 原生宿主检查 | `cargo check -p langbai-studio-pc --locked --offline` 成功；Tauri 宿主和权限生成能编译 |
| Windows release 构建 | 首次、SQLite 修复与本轮 WebView2 启动修复后的构建均成功；`custom-protocol` 嵌入生产页面，不依赖开发服务器 |
| 生产页面浏览器 smoke | Chrome 独立 context；提示词编辑/分层预览/原文保持、按需页面切换、浏览器禁用 Token/生图/上传、1440/900px 无横向溢出，全部通过 |
| 浏览器网络与脚本 | 上述 smoke 中外部 HTTP 请求 0，页面脚本错误 0；未使用个人 Chrome profile |

Rust HTTP 测试使用本机 TCP mock server，不是 NovelAI 服务。验证单次 POST、JSON/Auth 头、401/429/500/302 不重试不跳转、超时不重发、响应类型/体积检查与错误脱敏。服务测试使用本地合成 PNG/ZIP，验证结果保存、恢复 seed、氛围缓存及未知结果阻止新提交；不能当作真实收费验收。

前次 `npm audit --json` 查询报告 0 已知漏洞；本轮未重新查询。不代表 Rust 或全部依赖没有漏洞。

## 实际产物

- Windows EXE：`target/release/langbai-studio-pc.exe`，14,361,600 bytes（约 13.70 MiB）。
- 便捷启动：本目录的 `启动PC新版.cmd`；不调用旧版入口，不需要先开 Vite/Node 服务。
- 主 JS：213,522 bytes（构建报告 gzip 68.46 kB）；CSS：9,473 bytes。
- 历史、设置、诊断页面分别拆包，按需加载。
- 浏览器截图：`target/workbench-browser.png`，只代表界面预览，没有真实生图。

EXE 大小、前端大小和诊断页面的计时均不能直接当作总内存或完整启动性能结论。开发目录中的 `target` 包含工具链构建中间文件，不是最终发行包。

## Windows 运行验证

### 白屏闪退：已修复并重新编译

原默认 AppData 浏览器缓存启动曾退出 101，WebView2 返回 `HRESULT(0x8000FFFF)`，不能创建可用窗口。对照测试中，仅改变浏览器缓存到项目目录就可以启动；仅改变 TEMP/TMP 不足以解决。证据不足以断言 WebView2 安装损坏或唯一原因是 ACL。

本轮修复：配置窗口 `create=false`，在宿主 setup 中使用原配置显式构造主窗口，指定 EXE 旁 `.webview2-cache`。不改变 SQLite、付费任务 journal、图像或 Windows 凭据位置，不禁用浏览器沙箱，不修改系统 ACL、注册表或全局环境。Preview 要求 EXE 目录可写。宿主初始化错误写 `startup-error.log` 并显示原生错误弹窗，替代无声退出。

### 普通启动：已通过稳定性检查

- 最新 release EXE，没有 `WEBVIEW2_USER_DATA_FOLDER` 或额外浏览器参数，没有调试端口。
- 工作目录刻意设为项目根，而非 EXE 目录；浏览器缓存仍跟随 EXE 目录。
- 运行 10 秒后主窗口仍存活、响应正常，标题 `Langbai Studio · PC Preview`；stderr 为空。
- 这是本机进程启动验证，不是资源管理器双击验收，也不是“启动耗时 10 秒”的测量。ShellExecute 测试出现系统“打开文件 - 安全警告”，已取消本次测试弹窗；后续通过重定向输出的直接进程启动验收，未取消系统安全设置。

### 同一生产缓存下的原生界面 / IPC：已通过

- 同一个 release EXE，实际 WebView2 加载内嵌生产页面；没有启动 Vite，没有覆盖浏览器缓存目录或 TEMP/TMP。
- 仅本次测试进程临时启用 127.0.0.1 调试端口；测试完已关闭自己启动的 EXE 并检查端口释放。
- `desktop_bootstrap` 返回原生 `tauri`、IPC 版本 2、协议状态 `observed_subset`。
- 正向提示词可编辑，生图按钮可用。
- `generation_submit` 传 `confirmPaid=false`，真实 IPC 返回 `confirmation_required`；发生在凭据读取及传输初始化之前。
- 按需打开诊断页，等待 5 秒再完成原生 handshake；页面脚本错误 0。
- 截图：`target/native-fixed-workbench.png`（已查看，不是白屏）、`target/native-fixed-diagnostics.png`。没有真实生图。
- 测试没有读取 Token、保存草稿或发送收费请求；上述结果不是完整生图验收或性能 benchmark。

### 默认持久存储：自动验收未通过

- `NATIVE_SMOKE_STORAGE=1` 经真实 IPC 调用 `history_list`，只检查结果结构，不输出历史提示词或图片；返回 `storage_unavailable`，测试正确报告失败。
- PowerShell 普通文件写入与 Python SQLite WAL 探针通过；同路径的独立 Rust 文件写入探针返回 Win32 5（拒绝访问），SQLite 返回 CannotOpen。
- 该结果说明自动启动环境中的原生存储访问仍需核验，不在证据不足时归因于数据库 schema 或断言用户正常桌面会话一定成功。
- 没有把持久存储迁到 EXE 旁，没有覆盖旧版或清空任务，不修改系统权限。探针源码和自行创建的探针数据库已清理；原持久路径保留。
- 启动 / 界面 / IPC 通过与持久存储失败分别记录，不能合并声称“基础生图已端到端正常”。

## 未验收 / 不声称通过

- 真实 NAI 文生图、i2i、Vibe 编码：未发送；`realPaidAcceptance=false`。官方服务上的端到端成功仍需用户确认预算并单独验收。
- 新旧发行版冷/热启动、全进程树内存对比：未测量。不能宣称达到某个秒数或节省某个比例。
- Windows CI：配置已添加，本轮未提交/推送，CI 未运行。
- 旧版全套回归测试：未执行；旧版 tracked 文件保持不变，未安装其整套依赖。
- 完整 NAI 功能：仅实现观察到的 V4.5 单图子集，不代表最新模型、完整官方协议或所有模型/采样器/费用规则；未实现多角色 caption、流式、批量与完整费用估计。
- 安装包、签名、自动更新：未制作；当前是本机 preview EXE，不应作为稳定正式版发布。
- `cargo fmt`：minimal Rust 未安装 rustfmt，未执行成功；不把未运行的格式检查记为通过。

## 证据与边界

官网公开 Swagger 快照、公开客户端与用户文档的来源/哈希/观察分类见 `contracts/novelai-evidence.json` 和 `contracts/README.md`。fixture 是应用自编期望请求，不是付费请求抓包。公开客户端观察不是服务方稳定性保证。

界面采用 M3 风格颜色角色与轻量 CSS，不加载远程 CDN，不宣称完整 M3 组件或无障碍认证。提示词分层是应用模板，不是 NAI 官方排序；不去重、不改权重，可查看最终提交原文。

## 本轮解决的问题

- 已安装 Rust、VS2022 Build Tools、Windows SDK、WebView2 和 Node，无需用户重复安装。
- Cargo 缓存锁：只核实并结束上轮遗留的构建任务，不泛杀其他 agent 的服务。
- PowerShell `-p` 参数歧义：辅助脚本采用 `-CargoArgs @(...)` 明确传数组。
- MSVC D8050 临时文件写入失败：辅助脚本将 TEMP/TMP 指向 `target/build-tmp`，只影响当前进程，不修改全局环境。
- 沙箱中的编译/预览限制：按权限流程获准后执行，没有绕过审批。
- 提交记录改用 SQLite IMMEDIATE 事务，防止两个连接同时越过未解决任务检查；已通过竞争测试。
- HTTP 显式关闭自动重试和重定向；超时/解析失败/中断保持“结果未知”，不假装取消成功或自动补发。
- Rust fixture 路径、Debug 派生和 f64 fixture 类型差异已修复，随后全部测试通过。
- 本轮 WebView2 缓存初始化闪退已修复；添加宿主启动测试、缓存与持久数据分离的回归检查，以及原生 smoke 延迟检查和可选真实存储验收。



