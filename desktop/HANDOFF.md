# NAITools 开发交接

更新日期：2026-10-05（Asia/Singapore）。交接基线：`96a389a`，上一项功能提交为 `0366163`。

> **接手先读：默认应用已经使用 Langbai 原版 renderer，但原版生成服务和多账号配置尚未接通。旧自定义界面的功能、Rust 后端已有的功能、默认原版界面可用的功能是三个不同层级，不能混为一谈。**
>
> 本文记录当前状态，不授权启动收费请求、迁移用户数据或改变既定重构路线。

## 1. 项目与交付目标

- 项目：NAITools，当前仅推进 Windows PC 端。
- 工作目录：`D:\dsh\nai`。
- 远程仓库：`https://github.com/Gutouoff/NAITools.git`。
- 当前分支：`codex/naitools-pc`。功能及验证文档截至基线已推送同名远程分支。
- 当前产品版本：`0.1.0`；原版 renderer 基线：Langbai `2.4.4`。
- 用户要求：先完整复用 Langbai 的 UI 与交互逻辑，用 Rust/Tauri 替换宿主和服务；后续再进行细节调整。
- 用户目标：启动迅速、较低资源占用、面向生产力、术语和文案规范。当前尚无新的原生冷启动或内存测量，不能声称性能目标已经达成。
- 当前不是“整个 UI 用 Rust 重新绘制”：界面仍为冻结的 React/TypeScript，宿主与服务为 Rust/Tauri。

## 2. 必须保持的约束

1. **不得修改或批量格式化 `D:\dsh\nai\desktop\langbai\`。** 源快照受逐文件 SHA-256 清单保护。布局、样式、输入框、组件与状态逻辑直接复用原版。
2. 产品标识仅在构建插件中覆盖 `APP_NAME`、`APP_VERSION`、`PROJECT_REPOSITORY`，不要直接改冻结源文件。
3. 不恢复旧自定义提示词编辑器，也不通过重写一个近似界面冒充原版复刻。新增服务优先接入 `desktop/compat`。
4. 文生图与图生图是互斥模式。新文案使用规范术语；不用内部简称作为正式功能名称。
5. 多账号和 API 连接配置属于设置；第三方连接的称谓是“第三方提供商”。必须支持多套配置和切换，不是只增加一个密钥输入框。
6. 按官方资料和实际核验的 NovelAI 原生契约实现请求；不能从 UI 字段推断网络字段。精准参考的本地参数不等于已核验的生成请求契约。
7. OpenAI Images 格式暂不转换，应明确拒绝。不得探测多个收费路径，或失败后切换提供商、协议或模型重发。
8. 不伪造账号、余额、生成结果、历史参数或成功保存。未实现方法明确失败；可选的未实现方法继续保持缺失。
9. 不清空、替换、移动生产数据库、任务记录、素材、凭据命名空间或默认数据路径。不为消除错误而新建“空白账号/空白数据库”。
10. 收费请求不自动重试；未知结果必须保留任务记录并由用户核对。不得复用聊天中公开过的真实密钥；后续真实验收先要求用户更换密钥并明确确认费用上限。
11. 保留原作者完整 MIT 声明和提交历史。代码 MIT 不代表所有附带图片、数据库与素材均可自由再分发。
12. 分阶段 commit，明确记录验证范围。不要把“构建成功”写成“真实生图验收通过”。

## 3. 默认运行链路与代码边界

```text
D:\dsh\nai\desktop\vite.config.ts
  → D:\dsh\nai\desktop\vite.langbai.config.ts
  → D:\dsh\nai\desktop\compat\index.html / main.ts
  → window.naiDesktop 兼容桥
  → 冻结的 Langbai renderer
  → 显式 Tauri 命令与 ACL
  → Rust 本地服务 / 已核验的网络服务
```

- 默认开发/预览端口：`1420`；独立 Langbai 配置端口：`1421`。两者都是原版 renderer，不是两种 UI。
- 默认前端产物：`D:\dsh\nai\desktop\dist-langbai\`。
- 默认 Rust 宿主：`D:\dsh\nai\desktop\src-tauri\src\main.rs`。
- `D:\dsh\nai\desktop\src\App.tsx` 及其 `features` 自定义工作台不进入默认应用，仅保留供旧功能迁移和回归参考。
- 仓库根目录仍有旧 Electron 源码作为本地参考；当前发布与构建入口在 `desktop`。不要在根目录执行旧 `npm start` 后将 Electron 验收当成新版验收。
- 原版 API 清单有 244 个契约成员、209 个被前端直接引用；当前只实现 32 个方法。事件订阅能注册/取消，但尚无对应原生事件生产者，不能计入功能完成度。

## 4. 默认原版界面：已接通什么

| 功能 | 当前状态与边界 |
| --- | --- |
| 本地设置与首次运行 | 109 项原版默认值、稀疏覆盖；仅 29 项本地/界面/提示词设置可写。服务端点、凭据及未接通的服务设置不是可用连接配置。 |
| 窗口 | 最小化、最大化、关闭、标题栏拖动已接通。 |
| 凭据存在状态 | 仅返回是否存在及 stale 标记；不返回 Token，不查询/伪造余额或账号等级。 |
| 原版提示词与布局 | 使用原版输入框和状态逻辑；三栏与提示词尺寸调整、模式互斥通过隔离浏览器回归。 |
| 图像导入与元数据 | PNG/JPEG/WebP 原生选择、读取、清除；保留原始字节与尺寸。元数据使用原版解析器，缺失时不补造。任意本地路径、系统剪贴板文件和文件路径拖放尚未接通。 |
| 元数据快照 | 本地保存与恢复；损坏明确失败、不覆盖。单独读取元数据不能替换当前工作区图片。 |
| 历史读取与分组 | 日期、游标分页、分组创建/重命名/删除、归属调整；删除分组只解除归属。不能据此认定所有原版历史按钮均已适配。 |
| 历史参数 | 从已保存请求恢复；缺少请求快照时明确失败，不用当前默认参数伪造历史。点击历史图片仅预览，显式恢复/变体操作才恢复参数。 |
| 历史媒体 | 受限本地协议按需读取，列表不返回全部原图 base64。 |
| 参考预设库 | 本地保存/读取/删除、分组创建/删除/移动已接通；原版搜索、网格、分页和应用交互保持不变。 |
| 氛围预设应用 | 载入原图及保存的信息提取量、参考强度；不会自动编码或生成。浏览器已验证生成页实际状态，不只是后端读回值。 |
| 精准参考预设 | 本地保存类型、强度、保真度及尺寸，由原版载入逻辑应用；**不代表精准参考生成请求已经接通**。 |
| 内置反推模板 | 版本化资源按需加载；只提供模板，不代表反推网络服务可用。 |

### 参考预设库本轮新增的 7 个原版接口

```text
listReferencePresets
saveReferencePreset
readReferencePreset
deleteReferencePreset
createReferencePresetGroup
deleteReferencePresetGroup
moveReferencePresetToGroup
```

它们映射到四个显式 Rust 命令：`langbai_references_list`、`langbai_reference_save`、`langbai_reference_read`、`langbai_reference_edit`。

- 单图限制：16 MiB；仅 PNG/JPEG/WebP；实际解码校验格式与尺寸。
- 列表只返回元数据；应用时才读取对应原图 base64。
- 删除预设只移除库记录，保留已应用工作区可能引用的原图；当前没有孤立素材垃圾回收。
- 删除分组将条目移至未分组，不删除预设或图片。
- 素材缺失、损坏数据库、缺失保存参数明确失败，不把缺失的强度补成 1。
- 旧 IndexedDB 预设及其他预设库不自动迁移，也不被清除。
- `.nairp` 导入/导出、线上下载仍未实现；其按钮存在不代表服务已经可用。

## 5. 已有 Rust 能力，但尚未接入原版界面

以下能力在旧工作台时期已有代码和本地测试，不能直接对用户宣布默认应用已可用：

- V4.5 非流式生成子集、单张文生图/图生图请求构造。
- 图生图素材保存、氛围编码及缓存。
- 多连接元数据、官方账号与第三方 NovelAI 原生连接配置。
- 每个连接独立的 Windows 凭据及凭据版本；编码缓存按连接范围隔离。
- 生成前确认、付费任务日志、结果未知阻止新请求、人工核对。
- 结果保存、随机种子、历史请求快照、导出、绘图预设。

旧 Rust 生成子集的应用限制（不是 NovelAI 全部规格）：

- 仅 V4.5 Full/Curated；采样器仅 Euler/Euler a；当前单张请求。
- 宽高分别 256–1536，必须为 64 的倍数，总像素不超过 1,048,576。
- 步数 1–28；guidance 范围 1–10；图生图强度与噪声范围 0–1。
- 最多 4 张氛围参考，总强度不超过 1；不能自行归一化改变用户权重。
- 编码引用由本地服务解析，不能把任意 renderer JSON 直接作为原生请求发送。
- 协议证据最后记录日期为 2026-10-03，状态 observed_subset；不代表完整规格或真实付费验收。新增字段、模型与精准参考前仍需重新核验官方资料。

当前原版 `generate`、`generateCompatible`、凭据保存/验证等关键接口仍为未迁移失败路径。不可只将接口指向旧 Rust 命令而忽略 DTO、模型、参考参数、取消、事件与费用确认差异。

## 6. 数据身份与文件安全

- 应用 identifier 与凭据 namespace 继续保持 `com.langbai.studio.pc.preview`；产品显示名称已经是 NAITools，不能因改名更换数据身份。
- 持久数据 root 由 Tauri `app_local_data_dir()` 解析。未在本轮读取真实目录，**不要自行猜路径或换成工作目录**。
- 原主数据库为该 root 下 `studio.sqlite3`；现有 schema 支持 v6。此前版本已有 v4→v5→v6 保留数据的升级，旧二进制不一定能读取新版数据库。
- 本轮参考服务使用 root 下独立 `langbai/reference-presets.sqlite3`，不打开/迁移主数据库。
- 本轮预设图片保存于 root 下既有 `imports`；历史生成图像在 `outputs`，已有服务还使用 `assets`、`vibes` 等目录。
- 元数据快照：root 下 `langbai/metadata-snapshot.json`。
- WebView 缓存：EXE 所在目录下 `.webview2-cache`；这不是主数据库或图片存储。不要把复制 EXE 当作数据迁移方案。
- 启动初始化失败日志：EXE 所在目录下 `startup-error.log`；仅初始化错误，不应包含请求密钥或正文。
- renderer 持有 `naitools://imports/...` / `naitools://outputs/...` 的受限引用，不是通用文件系统访问能力。
- 本地媒体 origin 为 `http://naitools-image.localhost`，只接受允许的本地标识与图片路径；不开放任意 URL、目录遍历或任意磁盘路径。
- 修改真实数据之前，退出应用并完整备份 root：数据库及对应 WAL/SHM、任务记录、素材与快照。不要只复制一个仍在写入的 `.sqlite3` 文件。
- 遇到“无法打开或写入本地数据；请求不会自动重试。”等错误，保留数据和日志，检查权限、占用、磁盘或损坏；不能删库、删日志、修改 ACL 或自动重新发起收费请求来掩盖问题。

## 7. 关键文件导航

| 目的 | 文件 |
| --- | --- |
| 默认构建与产品标识 | `D:\dsh\nai\desktop\vite.config.ts`、`D:\dsh\nai\desktop\vite.langbai.config.ts` |
| 原版入口与兼容桥 | `D:\dsh\nai\desktop\compat\main.ts`、`D:\dsh\nai\desktop\compat\desktop-bridge.ts` |
| 原版接口、参数定义 | `D:\dsh\nai\desktop\langbai\src\types.ts`（只读） |
| 原版生成交互 | `D:\dsh\nai\desktop\langbai\src\App.tsx`、`D:\dsh\nai\desktop\langbai\src\store.ts`（只读） |
| 原版参考交互与文件格式 | `D:\dsh\nai\desktop\langbai\src\ReferencePresetManager.tsx`、`D:\dsh\nai\desktop\langbai\src\vibe-file.ts`（只读） |
| 参考兼容桥 | `D:\dsh\nai\desktop\compat\reference-presets.ts` |
| 参考存储与本地服务 | `D:\dsh\nai\desktop\crates\studio-core\src\reference_presets.rs`、`D:\dsh\nai\desktop\crates\studio-nai\src\reference_presets.rs` |
| 历史兼容桥与存储 | `D:\dsh\nai\desktop\compat\history.ts`、`D:\dsh\nai\desktop\crates\studio-core\src\langbai_history.rs` |
| 图像与元数据 | `D:\dsh\nai\desktop\compat\local-images.ts`、`D:\dsh\nai\desktop\crates\studio-nai\src\local_images.rs` |
| 宿主与原版命令 | `D:\dsh\nai\desktop\src-tauri\src\main.rs`、`D:\dsh\nai\desktop\src-tauri\src\langbai.rs` |
| 本地媒体与启动 | `D:\dsh\nai\desktop\src-tauri\src\media.rs`、`D:\dsh\nai\desktop\src-tauri\src\startup.rs` |
| ACL 注册 | `D:\dsh\nai\desktop\src-tauri\build.rs`、`D:\dsh\nai\desktop\src-tauri\capabilities\main-local.json`、`D:\dsh\nai\desktop\src-tauri\permissions\autogenerated\` |
| 生成 DTO 与请求构造 | `D:\dsh\nai\desktop\crates\studio-core\src\generation.rs` |
| 网络执行与任务回执 | `D:\dsh\nai\desktop\crates\studio-nai\src\lib.rs`、`D:\dsh\nai\desktop\crates\studio-nai\src\http.rs` |
| 连接、凭据、日志存储 | `D:\dsh\nai\desktop\crates\studio-core\src\connections.rs`、`D:\dsh\nai\desktop\crates\studio-nai\src\credentials.rs`、`D:\dsh\nai\desktop\crates\studio-core\src\store.rs` |
| 已存协议证据 | `D:\dsh\nai\desktop\contracts\novelai-evidence.json` 及该文件引用的证据资源 |
| 原版浏览器回归 | `D:\dsh\nai\desktop\tests\langbai-browser-smoke.mjs` |
| 最新迁移与验收记录 | `D:\dsh\nai\desktop\LANGBAI_PARITY.md`、`D:\dsh\nai\desktop\VALIDATION.md` |

新增命令必须同时注册 handler、AppManifest、capability 与窄权限，并补契约测试。不要通过任意方法名/命令名代理绕过类型和 ACL。

## 8. 上一轮实际验证结果

以下来自功能提交时的测试，本次交接文档修改不等于重新执行了全部测试：

| 验证 | 结果与范围 |
| --- | --- |
| 前端 `npm test` | 72/72。包括旧代码回归与默认原版兼容桥；不是 72 项全部都是原生 UI 验收。 |
| Rust workspace | 78/78：host 5、core 40、IPC 1、NAI 32，锁定依赖、离线缓存。 |
| 类型检查 | 旧源码 `typecheck`、原版 `typecheck:langbai` 通过。 |
| 原版生产构建 | `build:langbai` 通过。 |
| 冻结源与清单 | `check:langbai-source` 通过，原版文件未改动。 |
| 隔离浏览器 | 生产 CSP、合成 IPC、本地 PNG；原版布局调整、模式互斥、设置、元数据、参考创建/搜索/预览/应用通过。 |
| 参考应用参数 | 生成页实际恢复信息提取量 0.65、参考强度 0.4，未提交编码或生成。 |
| 原生 release | `cargo build -p naitools --release --features custom-protocol --locked --offline` 成功。 |
| 真实 AppData/启动 | 本轮未启动 EXE、未打开真实用户数据库；此前默认持久存储失败尚未完成原生复验。 |
| 真实生图与计费 | 未访问真实提供商，收费请求 0 次，费用 $0。 |

当前 EXE：`D:\dsh\nai\desktop\target\release\naitools.exe`，32,444,416 bytes；最后构建于 2026-10-05。EXE 大小不是运行内存；浏览器合成启动耗时不是原生冷启动数据。二进制与缓存不提交仓库。

## 9. 复验命令（PowerShell）

先检查工作区与交接基线，保留其他 agent 或用户的未提交修改：

```powershell
Set-Location 'D:\dsh\nai'
git status --short --branch
git log -6 --oneline
Set-Location 'D:\dsh\nai\desktop'
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

npm run typecheck
npm run typecheck:langbai
npm test
npm run check:langbai-source
npm run build:langbai
```

上一轮系统 Temp 写入曾被拒绝，Rust 测试使用单独的忽略目录；仅调整测试进程环境变量，**不能用此方法改变应用的持久数据目录**：

```powershell
$testTemp = 'D:\dsh\nai\desktop\target\test-temp'
New-Item -ItemType Directory -Path $testTemp -Force | Out-Null
$env:TEMP = $testTemp
$env:TMP = $testTemp
cargo test --workspace --locked --offline
cargo build -p naitools --release --features custom-protocol --locked --offline
```

原版浏览器回归需先运行预览服务，再在另一个终端执行测试。此脚本阻断外部请求，不需要真实 API Key：

```powershell
# 终端 A，工作目录为 D:\dsh\nai\desktop
npm run preview

# 终端 B，同一工作目录
# 本机已有 Playwright；其他设备应先确认实际安装位置，不要硬编码照抄。
$env:PLAYWRIGHT_MODULE = 'C:\Users\18154\AppData\Roaming\Python\Python314\site-packages\playwright\driver\package'
npm run test:browser
```

- Node.js 本机构建基线为 24；Rust stable/MSVC、VS C++ Build Tools、Windows SDK；运行需要 WebView2。
- `desktop:build` 会执行默认前端构建；直接调用 `cargo build` 前必须先重建前端，否则会嵌入旧资源。
- `desktop:build:langbai` 是独立 **debug** 构建，不是正式 release。
- 默认启动脚本：`D:\dsh\nai\启动程序.bat`、`D:\dsh\nai\start.bat`、`D:\dsh\nai\desktop\启动PC新版.cmd`。都指向 Rust release，不回退 Electron。
- 上述原生启动脚本不是本轮已通过的验收步骤。真实启动前先确认备份及权限问题，不要直接操作未备份的生产数据。

## 10. 下一轮推荐顺序与验收标准

### P0：接通原版基础生成与设置中的连接配置

1. 先阅读原版 `GenerateParams`、`generate` 的调用方、返回结果与事件消费；对照现有 Rust `GenerationInput` 和协议证据，建立显式参数映射表。
2. 原版可能选择 Rust 子集尚不支持的模型或参数。不得静默降级模型、丢弃角色提示词、参考图或采样参数；未支持项在收费前明确拒绝。
3. 在 `desktop/compat` 增加生成/连接适配，不再往旧 `desktop/src/features/Workbench.tsx` 增加用户功能。
4. 设置中接通多连接列表、配置保存、选择状态与每个连接的凭据。选择配置必须传到 Rust 请求，不能仅在界面显示“已切换”。沿用既有 namespace 与连接版本隔离，不向 renderer 回传保存的密钥。
5. 接入生成前费用确认、任务状态及事件；原版事件订阅现在只有注册外壳，需补真实原生事件生产者与取消订阅，不伪造进度。
6. 先用本地 fixtures 或测试 transport 验证文生图，再接图生图底图、氛围编码/缓存、结果与历史快照。模式切换不应丢提示词或把图生图改为额外选项。
7. 结果未知后不能重试、切连接重发或重新排队。历史、任务回执、原图和元数据均需保留。

完成标准：默认原版界面的显式操作真正到达 Rust；参数和连接映射有测试；未核对任务阻止新收费请求；取消与失败可恢复 UI；生成结果进入历史，不以旧工作台用例代替验收。

### P1：参考文件互通与精准参考契约

- `.nairp` 先对照现有原版类型和本地旧 Electron 实现确定格式，再写 Rust 兼容导入/导出。必须限制 ZIP 路径、数量、压缩/解压大小和图像解码；全部验证通过后才提交，不能半导入后伪造成功。
- `.naiv4vibe` / `.naiv4vibebundle` 对照原版 `vibe-file.ts`，保留模型与编码参数，不将已提取文件当成原图重复收费。
- 精准参考的 character/style/character&style、强度、保真度、模型支持条件必须核验官方原生字段。本地库已有这些参数，不代表请求契约已经确定。
- 在线库下载仍需单独适配与安全验证；不要以扩大 renderer CSP/开放任意网络作为快捷方案。

### P2：原生验收与性能

- 在完整备份或专门隔离的测试环境中检查白屏/退出、设置输入与保存、参考库落盘、历史原图与元数据、本地错误提示。
- 记录实际冷/热启动、Rust 进程及 WebView 相关进程资源占用；区分缓存、数据库初始化与 renderer 加载耗时。
- 真实生图只在契约、连接、日志和费用确认完整后进行，使用用户新提供的凭据与明确预算。优先单张基础文生图，之后图生图、氛围参考、精准参考、第三方原生提供商；每一步保留回执，失败或未知不自动重发。

## 11. Git 与交接注意事项

近期提交：

```text
96a389a docs: record original reference library parity and validation
0366163 feat(reference): connect original Langbai preset library to Rust
881ac8f feat(reference): apply saved vibe presets in workbench
72ca268 feat: connect Langbai history and on-demand media
```

- `881ac8f` 仅改了旧自定义工作台，不代表默认界面参考库已接通；实际默认接入在 `0366163`。
- 本地分支 upstream 当前为 `origin/main`，`git status` 因而可能显示 ahead；截至基线，同名 `origin/codex/naitools-pc` 已推送。不要据此强推或重置 main。
- 推送当前工作分支使用明确目标：`git push origin HEAD:codex/naitools-pc`。未经要求不合并 main、不删远程内容、不重写提交历史。
- 根目录发布忽略规则只保留 PC 重构等允许内容，交接文档放在 `D:\dsh\nai\desktop\HANDOFF.md` 以确保进入仓库。
- 不提交真实密钥、数据库、任务记录、用户图片、构建产物或缓存。

接手时以工作区、兼容桥实际实现、测试输出和 Git 提交为准；旧验收记录只作为历史证据，不覆盖当前未完成边界。
