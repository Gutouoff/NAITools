# NAITools · Windows 开发预览

独立 PC 重构目录：Rust + Tauri 2 + React / TypeScript。旧版账号、图像与入口不扫描、不迁移、不覆盖。当前源码树只发布新版，旧实现保留在 Git 历史和原有本地文件中。

## 功能与边界

- 紧凑三栏工作台：提示词、图像预览、生成参数与参考图；宽窗口通过分隔条调整栏宽（方向键微调、双击重置），窄窗口保留可见生成按钮。画师串、原文、分层和负向输入框均有独立高度拖动条。
- 独立画师串及原文 / 9 层正文应用模板：原文与分层内容独立保留，当前模式决定提交正文；可启用、排序、预览，不去重、不改权重，不宣称官方排序。
- V4.5 Full / Curated、Euler / Euler a，单张非流式文生图。
- 图生图：文件选择、拖放和 Ctrl+V 本地导入；结果可一键用作底图。按目标比例中心裁剪后缩放，这是应用选择。
- 氛围参考（Vibe Transfer）：文件 / 拖放 / 粘贴导入，显式编码确认，按素材 / 模型 / 提取量 / 连接 / 凭据版本缓存；生成不会自动付费编码。
- 「设置」统一管理最多 32 套 NovelAI 官方账号 / 第三方提供商及付费任务记录。支持 API 配置切换、新增、编辑和复制；复制不包含密钥，未保存的修改须保存或确认放弃。工作台仅显示当前 API 名称与设置入口，Windows 凭据管理器按配置隔离密钥。
- 最多 32 套命名绘图配置：画师串与正向 / 负向提示词独立编辑；支持保存、更新、删除、应用及仅应用画师串。按 Langbai 工作流提供「保留画师串」「保留负向提示词」，默认启用，影响配置切换和提示词清空，不限制手动编辑。配置不包含 API、密钥、底图、氛围编码和付费同意；完整应用会清除氛围选择，保留 API 和底图。
- 尺寸预设、宽高交换、随机 / 固定 Seed、复用结果 Seed；结果 100%–800% 缩放，Ctrl+滚轮、放大后拖动平移、双击适应窗口。
- 本地草稿、PNG 保存 / 导出、历史游标分页与参数恢复；作品管理采用日期 / 网格 / 详情三栏，显示实际 PNG tEXt / 未压缩 iTXt 文本元数据（最多 128 项，每项最多 65,536 字符），保留原文空白；暂不支持压缩或隐写元数据。分页失败保留已加载记录，缩略图读取最多同时进行 6 项。示例画廊单独标记，不伪造记录。
- 参考预设库：氛围迁移 / 精准参考图像分类、本地 PNG/JPEG/WebP 导入、名称、备注、预览和删除。**暂存于 WebView IndexedDB，清理应用缓存可能丢失，请保留原始文件；尚未接入持久文件存储、.nairp / 提取文件及工作台应用。**
- 收费请求前检查任务存储，实际提交前通过 SQLite IMMEDIATE 事务落盘并复查未知任务；未知结果不重试。
- 「关于」显示来源、完整项目 MIT 许可证与折叠诊断，不在主工作台展示技术宣传。

生成模式为文生图 / 图生图二选一；仅图生图展示底图参数。底图与氛围参考先生成本地缩略图，再保存原图。若保存失败，缩略图仍可见但明确标记“未保存”，不能提交生成或编码；只有点击重新导入才再次尝试保存。API 设置中的存储错误提供分类与原数据位置，不删除数据库或自动重试。

**真实 NovelAI 文生图、图生图、氛围参考信息提取尚未付费验收；本机默认 AppData 存储仍未通过原生验收。不要把界面和本地测试通过当作生图 / 保存已正常。** 详见 [验证记录](VALIDATION.md)。

应用限制，不代表服务通用上限：每次 1 张、最多 4 个氛围参考且强度总和 ≤ 1；尺寸 256..1536 / 64 倍数 / 总像素 ≤ 1,048,576；1..28 步、Guidance 1..10。首版没有多角色独立 caption、流式、批量和完整费用估计。V4.5 是选定子集，不表示最新模型。

## 运行本机版本

双击 `启动PC新版.cmd`，或打开 `target/release/naitools.exe`。本机已完成 release 构建；无需启动 Vite、Node、Python 后台服务。其他机器从源码构建，当前没有已发布安装包。

需要 Windows WebView2 Runtime；EXE 所在文件夹必须可写，因为可丢弃的浏览器缓存位于旁边 `.webview2-cache`。此预览暂不适用于直接放入受保护的 Program Files 目录。初始化失败时显示原生弹窗，并尝试写入 EXE 旁的 `startup-error.log`。

**改名不改变持久数据身份**：仍使用 `com.langbai.studio.pc.preview` 的原 AppData 数据目录及 Windows 凭据命名空间，防止丢失草稿或绕过未核对收费任务。不要删除数据库、切换目录或重复提交来处理未知结果。Token 只输入桌面「设置」页面，不发到聊天。

## 开发与构建

需要 Node.js 24、Rust stable（MSVC）、VS 2022 Build Tools 的 C++ 桌面工具 / Windows SDK。本机已经安装，无需重复安装。其他机器首次下载依赖时不要使用 offline；之后使用 lockfile 固定依赖。

在本目录运行：

```powershell
npm ci
npm test
npm run build
& .\scripts\windows-cargo.ps1 -CargoArgs @('test','--workspace','--locked')
& .\scripts\windows-cargo.ps1 -CargoArgs @('build','-p','naitools','--release','--features','custom-protocol','--locked')
```

辅助脚本仅为当前进程加载 VS2022 x64 环境，临时文件位于 `target/build-tmp`；不改全局 PATH。参数使用数组避免 PowerShell 的 `-p` 歧义。依赖已缓存时可追加 `--offline`。

开发模式：`npm run desktop:dev`。生产构建通过 `custom-protocol` 内嵌页面，不依赖开发服务器。次级页面按需加载；启动按需读取本地连接元数据，不读 Token、不扫描历史、不发远程请求；设置页打开后才查询各配置的凭据状态。

可选浏览器验收：先运行 `npm run preview`，在另一个终端设置 `PLAYWRIGHT_MODULE` / `BROWSER_EXECUTABLE`，再运行 `npm run test:browser`。采用独立 context，阻断外部 HTTP；合成 IPC 用于错误 UI 测试，不冒充原生服务。

## 协议、许可和发布

协议依据及已知缺口见 [contracts](contracts/README.md)：公开 Swagger 快照、官网客户端观察及用户文档。客户端观察不是稳定 schema 承诺；fixture 是应用自编期望请求，不是付费抓包。官方账号固定 HTTPS endpoint；中转站地址和路径必须显式保存为连接元数据，服务端校验后使用，禁止重定向与自动重试，生成 IPC 不接受任意 URL / 远程 JSON。当前仅适配 NovelAI 原生 JSON → ZIP，不冒充 OpenAI Images / Chat 全协议兼容。配置说明及中转站核验边界见 [连接配置](CONNECTIONS.md)。

保留原作者版权、完整 MIT 许可与 Git 来源历史。第三方依赖各有许可，详见根目录 THIRD_PARTY_NOTICES.md。当前不制作安装包、签名或自动更新；发行二进制前还需收集随包第三方许可并进行端到端验收。

旧版绘图功能对照与操作入口见 [DRAWING_FEATURES.md](DRAWING_FEATURES.md)。

本机资源样本与未完成事项见 [VALIDATION.md](VALIDATION.md)，变更摘要见 [CHANGELOG.md](CHANGELOG.md)。
