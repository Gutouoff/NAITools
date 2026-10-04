# NAITools 验证记录

更新：2026-10-04。以下以本机命令和真实 Windows 运行输出为准，区分“实现 / 本地测试 / 真实服务验收”。源码从新仓库原有 `f5ed6e8` 续接，不重写原作者或其他 agent 的提交历史。

## 原版 Langbai 界面迁移：独立构建入口

以下覆盖独立迁移入口，不取代后文旧自定义工作台的历史验收记录。

| 检查 | 结果 |
| --- | --- |
| 冻结源及契约 | SHA-256 源内容检查、AST 接口清单与默认值 / 内置反推模板检查通过；244 个契约成员，209 个直接引用 |
| 前端单元测试 | 55 / 55 通过，包括全部必需接口存在、未接通操作不触发 IPC、原版反推模板、设置失败不回退 / 不重试 |
| TypeScript / Vite | 默认入口与独立 Langbai 入口生产构建通过；Langbai 构建包含原版组件及公共资源 |
| Rust workspace | 60 / 60 通过（host 3、core 34、IPC 1、NAI 22），锁定依赖及离线缓存 |
| 数据库 | 临时 SQLite v4→v5 迁移保留草稿、历史、账号、凭据版本、绘图预设和未核对任务；设置重开保留、损坏设置不覆盖 |
| 浏览器隔离回归 | 独立 Edge context，生产 CSP；左右分隔拖动 / 双击复位、提示词高度拖动 / 键盘调整、文生图 / 图生图互斥并保留提示词、可编辑凭据字段、原版外观 / 主题控制通过 |
| 错误与资源 | 无 Rust 宿主时明确失败；合成存储失败显示“无法打开或写入本地数据；请求不会自动重试。”；原版图标可解码，页面脚本错误与资源失败为 0 |
| 外网和费用 | 外部网络请求 0；未接通生成仅本地拒绝，原生生成调用 0，收费调用 0，费用 $0 |
| 迁移原生构建 | compact TAURI_CONFIG 覆盖 + custom-protocol debug 编译通过；未运行 EXE，未修改 release 产物 |
| 原生端到端 | **未验收**：真实设置保存、窗口拖动 / 控制、启动时间、资源占用、历史 / 参考 / 账号与真实生图 |

浏览器 fixture 使用原版默认值及明确合成的 IPC，不连接个人数据库或真实凭据；截图仅作为界面回归证据。浏览器渲染用时不是原生启动耗时，不据此宣称已解决 10 秒启动问题。事件订阅只有本地注册 / 清理，无原生生产者，不计入服务验收。设置目前按顶层类型、枚举、载荷大小和递归敏感键检查；复杂预设及 lastGenerationState 尚非完整嵌套 DTO 验证。

编译初次失败是 multiline TAURI_CONFIG 经 MSVC 环境导入被截断，改为压缩单行 JSON 后编译通过；此编译问题不说明默认存储故障已经解除。此前原生启动被执行策略阻止，本轮未改用其他启动方式绕过；真实 AppData 未打开 / 迁移，系统 ACL 和持久路径不变。

本轮没有 cargo fmt 通过记录：minimal 工具链未安装 rustfmt，新增 Rust 文件人工整理，不把它当作工具验收。迁移方案及 v5 数据回滚限制见 [LANGBAI_PARITY.md](LANGBAI_PARITY.md)。

## 既有自定义工作台：绘图配置与 API 设置（de1b78a / f6a11f3 / 9d78f44）

| 检查 | 结果 |
| --- | --- |
| 前端 | 42/42 单元测试通过；最终 TypeScript + Vite 生产构建通过 |
| Rust workspace | 48/48 通过（宿主 3、core 25、IPC 集成 1、NAI 19） |
| 提示词兼容 | 共享 fixture 覆盖独立画师串与旧文档；旧原文模式中未激活的画师层不会因配置切换而自动提交；画师串仅编译到原有 provider 提示词字段，没有增加请求字段 |
| 绘图配置 | 保存 / 更新 / 应用、默认保留画师串及负向提示词、关闭保留后替换、仅应用画师串及按策略清空，通过 |
| 设置职责 | API 多配置选择 / 复制 / 未保存修改处理归入设置；工作台仅显示 API 名称和设置入口，通过 |
| 生产界面回归 | 1440 / 1101 / 900px 布局；栏宽及画师串 / 原文 / 分层 / 负向高度调整；底图导入、氛围拖放 / 粘贴、结果缩放 / 平移 / 转底图，通过 |
| 费用与外网 | 外部 HTTP 0，真实付费调用 0，页面脚本错误 0；本轮消费 $0 |
| 最终 release 原生 | WebView2 渲染、IPC 2 handshake、画师串编辑、分隔调整、命令权限与校验、未确认生成拒绝通过；延迟 5 秒后 IPC 仍响应 |
| 真实持久存储 | **未通过**：最终 EXE 读取连接、绘图配置及历史均返回 storage_unavailable；Rust 写入探针仍为 Win32 5 / PermissionDenied |

上述绘图配置保存及 API 切换使用合成 IPC，不代表真实账号保存或服务验收。保留选项仅作用于配置应用及提示词清空，不限制手动编辑、草稿读取或历史恢复。

最终主 JS 230,913 bytes（gzip 72,584 bytes），CSS 15,125 bytes（gzip 3,787 bytes）；设置页按需拆包 10,483 bytes（gzip 3,961 bytes）。无新增运行时依赖。合成截图：`target/drawing-settings-smoke.png`、`target/api-settings-smoke.png`，不含真实凭据或真实生成图。

### 该阶段构建产物

- EXE：`D:\dsh\nai\desktop\target\release\naitools.exe`，**14,938,112 bytes**，2026-10-04 17:55:58 本机修改时间；最终前端资源已通过 `custom-protocol` 内嵌，无需 Vite。启动入口仍为 `启动PC新版.cmd`。
- 首次编译因用户正在运行旧 EXE 而拒绝访问；没有强制结束用户进程。另目录验证编译通过；原窗口关闭后，标准 release 路径已重新构建并完成原生验收。
- 单次调试启动 `rendererReadyHostMs=1723`，含调试开销，起点为 Rust main；不是重复冷启动测试或完整启动时间结论。文件大小不代表内存占用。
- 原生截图：`target/drawing-settings-native.png`、`target/drawing-settings-native-diagnostics.png`；真实存储失败提示仍保留。原生 smoke 允许 storage_unavailable，只证明渲染、IPC 与拒绝机制，不证明保存正常。
- 本轮没有读取 Token、改 ACL、关闭安全措施、清理或迁移持久数据。测试原生进程与临时调试端口 9225 已关闭，浏览器测试服务器已停止。

## 前次绘图增量（e2c5815 / 6bafcaf）

| 检查 | 结果 |
| --- | --- |
| 前端 | 32/32 单元测试通过；TypeScript + Vite 生产构建通过 |
| Rust workspace | 46/46 通过（宿主 3、core 23、IPC 集成 1、NAI 19） |
| 预设安全与迁移 | 32 套上限、允许更新 / 拒绝超限新增、拒绝账号 / 凭据 / 收费状态字段；SQLite v3 → v4 保留草稿、账号和未知任务 |
| 生产页面真实交互 | 1440 / 1101 / 900px 布局、栏宽与三类输入高度的指针 / 键盘调整、可选布局存储失败、最小 PC 窗口生成按钮可见，通过 |
| 合成 IPC 回归 | 顶部配置切换与复制、空密钥、未保存更改禁用选用；预设保存 / 应用；尺寸 / Seed；底图导入、氛围拖放 / 粘贴；结果按钮缩放 / Ctrl+滚轮 / 指针平移 / Seed 复用 / 转底图，通过 |
| 收费与外网 | 只在模拟 IPC 中返回一次合成结果，远程编码 0；外部 HTTP 0，真实付费调用 0，页面脚本错误 0 |
| 新 release 原生 | WebView2 真实渲染、IPC 2 handshake、连接 / 预设 ACL 与无效输入校验、未确认生成拒绝、输入与分隔调整通过；5 秒后 IPC 仍响应 |
| 原生存储 | **未通过**：工具环境的 Rust 写入诊断继续返回 Win32 5 / PermissionDenied，history 为 storage_unavailable；新 release 顶部连接读取也显示本地数据失败 |

合成预览只使用本地纯色 PNG，不是真实 NovelAI / 中转生图。原生 smoke 允许“命令有权限，但数据目录不可用”的结果，不把它算作持久化验收。没有读取真实凭据、改 ACL、清 journal 或将收费任务切到空目录。

### 前次构建产物（历史记录）

- EXE：`D:\dsh\nai\desktop\target\release\naitools.exe`，**14,935,040 bytes**，2026-10-04 16:59:23 本机修改时间；已启用 `custom-protocol`，不依赖 Vite 服务器。文件大小不是进程内存。
- 主 JS 229.63 kB（gzip 73.10 kB），CSS 15.30 kB（gzip 3.82 kB）；连接编辑器按需拆包 7.00 kB。没有新增运行时 UI 依赖。
- 原生截图：`target/naitools-compact-native.png`，包含当前真实存储失败提示；合成交互截图：`target/drawing-tools-synthetic.png`、`target/connections-dialog-synthetic.png`。截图不含真实凭据或真实生成图。
- 本轮调试启动单次 `rendererReadyHostMs=1802`，从 Rust main 到宿主收到渲染通知，含测试开销；未做重复冷 / 热启动与旧版对照，不是“启动固定 1.8 秒”或内存结论。
- 测试自己的原生进程已关闭，9225 调试端口已关闭。功能入口见 DRAWING_FEATURES.md。

## 前次连接与布局基线（8e52187）

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

## 前次连接与布局产物（8e52187）

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


## 2026-10-04 历史与参考预设增量回归

- `npm --prefix desktop test`：44 / 44 通过；`npm --prefix desktop run build`：TypeScript 与生产构建通过。
- Windows Rust workspace：52 / 52 通过（host 3、core 26、IPC 1、NAI 22），使用锁定依赖及离线缓存。
- 生产 CSP 下的隔离浏览器回归通过：未保存配置凭据输入、保存失败保留输入和重试；真实 IndexedDB 导入 / 重载 / 分类 / 删除确认；非法图像及存储不可用错误。
- 历史使用合成 IPC 数据验证游标分页、重复标识去重、失败下一页保留数据与重试、缩略图单项失败、导出失败、预览实际解码和存在 / 缺失元数据；没有连接用户账号或数据库。此项不代表原生历史存储验收。
- PNG 单元测试覆盖 tEXt Latin-1、未压缩 iTXt 中文 / emoji / 语言字段、原始空白 / 空值与非法 / 不支持内容。仅解析文本块；压缩与隐写元数据尚未实现。
- 本轮收费调用 0 次，费用 $0。参考库目前是 WebView 本地图像归档，不支持工作台应用、.nairp 或已提取氛围文件；缓存清理仍可能丢失预设。
- 最终 release 重建成功，使用上述最新前端产物和 PNG 解析修复。原生启动 / WebView2 回归调用被执行策略阻止，本次未运行，不能记录为通过；新增 metadata ACL 回归脚本仅通过语法检查。前次默认存储的 `storage_unavailable` 限制尚未解除，真实生图仍未验收。


## 2026-10-04 至 2026-10-05 生成模式与导入失败回归

- 前端 `npm --prefix desktop test`：47 / 47；TypeScript 与 Vite 生产构建通过。
- Windows Rust workspace：54 / 54（host 3、core 28、IPC 1、NAI 22）；锁定依赖，使用离线缓存。
- 生产 CSP 隔离浏览器通过：文生图 / 图生图互斥、底图区域显示与隐藏、模式切换保留底图、隐藏原生文件输入、非法图像拒绝、保存失败仍显示实际解码的缩略图、仅一次导入调用、未保存底图拒绝生成、手动重新导入、未保存参考禁止编码、拖放与粘贴。
- API 配置失败通过合成 IPC 验证错误分类展示、保留配置与凭据输入、手动重新读取不丢失编辑内容。本轮不使用真实密钥，不发送外部 HTTP，收费调用 0 次，费用 $0。
- Rust 验证损坏数据库保持原字节；氛围提取在读取凭据或准备付费传输前因损坏任务存储而拒绝。没有重建 / 删除数据库、修改 ACL 或更换持久数据目录。
- 原生启动验证前次被执行策略拒绝，本轮未通过其他启动方式规避。此前默认 AppData 写入失败仍未确认解除；浏览器合成 IPC 不算原生配置保存、图片存储或服务生图验收。
- 最终 release 构建成功（`--features custom-protocol --locked --offline`），包含本轮前端产物与 Rust 错误分类；更新 `desktop/target/release/naitools.exe`。仅确认构建，不代表原生启动或 AppData 写入通过。
