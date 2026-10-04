# NAITools 验证记录

更新：2026-10-04。以下以本机命令和真实 Windows 运行输出为准，区分“实现 / 本地测试 / 真实服务验收”。源码从新仓库原有 `f5ed6e8` 续接，不重写原作者或其他 agent 的提交历史。

## 本轮通过

| 检查 | 结果 |
| --- | --- |
| 前端测试 | `npm --prefix desktop test`：28/28 通过；增加栏宽约束、拖动组件及连接元数据 / 凭据契约检查 |
| Rust workspace | `cargo test --manifest-path desktop/Cargo.toml --workspace --locked --offline`：42/42 通过（宿主 3、core 19、IPC 集成 1、NAI 19） |
| 前端生产构建 | `npm run build`：TypeScript + Vite 通过；次级页面按需拆包 |
| Windows release | `cargo build -p naitools --release --features custom-protocol --locked --offline` 成功，页面内嵌，无开发服务器依赖 |
| 生产页面浏览器 smoke | 独立 context；1440 / 1101 / 900 宽度无溢出；实际指针 / 键盘调整三栏和原文 / 分层 / 负向输入高度通过；重载比例及 localStorage 不可用回归通过 |
| 合成 IPC 的 UI 回归 | 存储失败与未知任务拦截；多配置新增、保存凭据后清空输入、选择中转及费用确认取消通过；无收费命令 |
| 浏览器网络 / 脚本 | 外部 HTTP 0、页面脚本错误 0，不使用个人浏览器 profile |
| 原生 WebView2 / IPC | 新版 release 实际窗口、原生 IPC、新连接 ACL / 本地校验与 resize 通过；未确认的生成返回 `confirmation_required`，未读取凭据 |
| 原生延迟检查 | 页面 / IPC 等待 5 秒后仍通过；未读取 Token、未提交收费请求 |
| 前次基线普通启动稳定性（89408f1） | 不设浏览器缓存覆盖或调试参数，工作目录设为项目根；10 秒后窗口标题 NAITools、响应正常，stderr 为空 |

Rust HTTP 测试使用本机 TCP mock server，不是 NovelAI。服务测试用合成 PNG / ZIP 验证保存、seed 恢复、缓存复用及结果未知后的禁止重发。新增回归保证生图先检查存储再读凭据；Vibe 缓存未命中且确认后先检查日志，不能在存储失败时准备收费传输。SQLite 只读连接会被检查拒绝；正式提交的 IMMEDIATE 事务仍复查未知任务，防止跨连接竞态。

浏览器合成 IPC 只存在于测试 init script，不属于发行产品；它不能证明真实原生保存可用。原生 smoke 已修正为先回到工作台，避免对同一窗口重复执行时停留在「关于」而产生定位超时。

## 当前产物

- 本机 EXE：`D:\dsh\nai\desktop\target\release\naitools.exe`，14,779,392 bytes；已启用 `custom-protocol`，不依赖 Vite 服务器。文件大小不是运行内存。
- 主 JS 218.17 kB（gzip 69.75 kB），CSS 12.35 kB，设置页懒加载 9.09 kB；没有新增运行时 UI 依赖。
- 启动入口：`D:\dsh\nai\desktop\启动PC新版.cmd`。本轮原生截图：`target/naitools-connections-workbench.png`，只验证界面，不含真实出图。
- 本轮启用调试端口的单次 `rendererReadyHostMs=1727`，含测试开销，不是冷启动或性能保证。

## 前次基线资源样本（89408f1，非本轮产物）

- 本机 EXE：`target/release/naitools.exe`，14,391,296 bytes，约 13.72 MiB；这不是运行内存。
- 主 JS 构建报告 212.89 kB（gzip 67.94 kB），CSS 10.80 kB；历史 / 设置 / 关于按需加载。
- 启动入口：`启动PC新版.cmd`；本机截图 `target/naitools-native-workbench.png`、`target/naitools-native-about.png`；只显示界面，不含真实生图。
- 普通启动后第 10 秒的一次进程树快照：7 个进程（包括 WebView2），PrivateMemorySize64 总和 **195.77 MiB**，WorkingSet64 总和 **344.35 MiB**。工作集简单求和可能重复计入共享页，不代表独占物理内存。记录于忽略的 `target/normal-launch-metrics.json`。
- 一次启用测试调试端口的运行中，`rendererReadyHostMs=1808`：从 Rust main 到宿主收到双 rAF 渲染通知，包含测试调试开销，不包含所有 OS 加载过程，不是冷启动结论。

以上内存与普通启动记录来自前次基线，不是新版重复测量。这些仅是单机开发预览的样本，未做旧版同条件对照、重复冷 / 热启动、峰值和负载测量。不能宣称“内存只有 14 MB”、完整启动固定 1.8 秒或节省某个百分比。测试中的等待 10 秒是稳定性观察，不是启动耗时。

## 白屏闪退处理

此前默认浏览器缓存下 WebView2 初始化返回 `0x8000FFFF`、进程退出 101。宿主现按原配置显式创建窗口，使用 EXE 旁 `.webview2-cache`；没有修改系统 ACL、注册表、浏览器沙箱或全局环境。Preview 要求 EXE 文件夹可写；初始化错误会显示原生弹窗并尝试记录 `startup-error.log`。

SQLite、付费任务 journal、图像仍保留在原 AppData 数据身份；Token 仍在原 Windows 凭据命名空间。没有通过搬迁或清空 journal 绕过未知任务。

原生测试的回环调试端口仅为测试进程设置，已关闭测试 EXE；等待子进程退出后确认 9225 不再监听。普通启动另行使用无覆盖 / 无调试参数的环境。ShellExecute 曾弹出系统文件安全警告，已取消测试弹窗；当前进程启动测试采用输出重定向，没有关闭系统安全设置。

## 未通过：默认持久存储

新版 release 的可选 `NATIVE_SMOKE_STORAGE=1` 验收再次失败：真实 IPC `history_list` 返回 **`storage_unavailable`**。这意味着本机自动运行环境里的默认数据库当前不可用，不能将“生图结果保存正常”标记为通过。

此前 Rust 写入探针在默认 AppData 得到 Win32 5 / PermissionDenied、SQLite CannotOpen；同代码在项目目录成功；PowerShell / Python 的对照写入成功。目录权限检查不能解释所有差异，尚未锁定唯一根因。读取安全产品信息也未取得可用的相关拦截证据，不能据此断言安全软件或系统权限就是唯一原因。

本轮改善拦截顺序及错误显示，没有改系统权限、禁用安全保护、迁移持久数据或发送真实付费请求。下一优先级仍是明确默认存储的实际运行问题，并在用户正常桌面启动环境核验读写。当前 PowerShell 的 IsTokenRestricted=false，同目录 PowerShell 写入成功；尚不能据此归因沙箱或普通 ACL。新配置保存及真实生成结果保存同样未通过原生验收。

## 尚未验收 / 发布限制

- 真实 NovelAI / 中转文生图、i2i、Vibe 编码与实际扣费：未发送请求、未验收；本轮费用 **$0**。meinianda.top 原生路径 / 返回格式仍缺少明确契约，核验边界见 CONNECTIONS.md。
- 端到端保存 / 恢复 / 导出：模拟测试通过，受默认原生存储失败限制，未完成真实使用验收。
- 冷 / 热启动、全进程树内存与旧版对照：未完成；只有上述单次样本。
- Windows CI 已更新为新包名、workspace 测试和 release 构建；云端运行结果须另行确认，不能用本机通过替代。
- 旧版源码从当前 Git 树移除、本地物理文件保留；旧版整套回归未执行。
- 安装包、签名、自动更新和二进制随包第三方许可汇总：未制作，不能作为稳定正式版发布。
- 明暗主题、完整无障碍审查、多角色 caption、流式、批量和实时费用查询：未完成；中转只有手工费用估算，不是实时计价。
- `cargo fmt` 未执行成功：本机 minimal 工具链未安装 rustfmt，不把未运行检查记为通过。

## 协议证据

公开 Swagger、官网公开客户端观察、用户文档的来源 / 获取日期 / 哈希 / 已知缺口见 `contracts/novelai-evidence.json` 及 `contracts/README.md`。没有改写接口字段或臆造新规则。fixture 是应用自编期望请求，不是官方付费示例；当前只实现已观察的 V4.5 单图子集，不宣称完整官方 API 或最新模型覆盖。
