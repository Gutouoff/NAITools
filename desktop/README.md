# NAITools · PC Preview

独立 Windows PC 重构目录：Rust + Tauri 2 + React/TypeScript。旧版入口、账号与图像目录不迁移、不扫描、不覆盖。

## 当前范围

- 轻量 M3 风格工作台，系统字体、无远程 CDN 或 Node/Python sidecar。
- 原文 / 10 层应用模板：可启用、排序、预览实际提交串；不去重、不改写权重，不宣称 NAI 官方排序。
- V4.5 Full / Curated、Euler / Euler a、单张非流式文生图请求实现。
- i2i 底图本地导入；提交前按目标比例中心裁剪（本应用选择，不是官方统一规则）。
- Vibe Transfer 显式收费确认、内容/模型/提取量缓存；生成不会自动进行收费编码。
- Windows 原生凭据存储，无明文降级，不读取旧版 Token。
- 原始 PNG 保存/导出、游标历史查询、恢复参数仅回到编辑器。
- 提交前持久化任务记录；超时/解析失败/中断记录为结果未知，未经人工核对阻止新付费任务；不自动重发。

**真实 NAI 生图、i2i 和编码尚未付费验收；本地测试不代表官方服务已成功返回。** V4.5 是首版选定子集，不表示当前最新模型。完整状态见 `VALIDATION.md`。

## 使用边界

应用限制（不是 NAI 服务通用上限）：最多 1 张结果、4 个氛围参考且总强度不超过 1，尺寸 256..1536 / 64 倍数 / 总像素 <= 1,048,576，1..28 步、Guidance 1..10。未实现多角色专属 caption、流式、批量、完整费用估计。

仅通过用户操作发起付费请求。Token 只输入 PC 新版「连接与任务」页面，不发到聊天。首次真实验收需要另行确认预算；浏览器预览禁止原生存储、凭据和生图调用，不能假装成功。

## 本机开发 / 构建

已安装的 Rust、VS2022 Build Tools、Windows SDK、WebView2 和 Node 无需重复安装。依赖已下载并生成 `Cargo.lock`；使用 `--locked` 保持版本稳定。

普通 PowerShell，在本目录运行：

```powershell
npm run build
& .\scripts\windows-cargo.ps1 -CargoArgs @('test','-p','studio-core','-p','studio-nai','--locked','--offline')
& .\scripts\windows-cargo.ps1 -CargoArgs @('build','-p','naitools','--release','--features','custom-protocol','--locked','--offline')
```

辅助脚本只在本进程加载 VS2022 x64 环境，将临时目录放在 `target/build-tmp`，不改全局 PATH。参数使用数组，避免 PowerShell 的 `-p` 通用参数歧义。开发模式用 `npm run desktop:dev`，需要对应的编译环境；生产模式使用 `custom-protocol` 内嵌构建后的界面，不依赖 Vite 服务。

本轮已重新编译 release EXE：`target/release/naitools.exe`（14,361,600 bytes，约 13.70 MiB；不是运行内存）。可双击本目录 `启动PC新版.cmd`，或直接打开 EXE，不需要运行终端命令、Vite 或 Node 服务。当前未制作安装包、签名或自动更新，运行依赖本机已安装的 WebView2。

白屏闪退修复：由宿主显式创建窗口，将可丢弃的 WebView2 缓存放在 **EXE 同目录 `.webview2-cache`**，不再使用原先启动失败的浏览器缓存位置。普通 EXE 无环境覆盖、无调试端口启动后，窗口持续运行 10 秒且响应正常；使用同一生产缓存的原生界面 / IPC smoke 通过。这是稳定性检查，不是启动耗时测量。

**Preview 的 EXE 所在文件夹必须可写**，暂不适用于直接放在 Program Files 等受保护安装目录。SQLite、付费任务记录和图像仍放在原来的用户 AppData 目录；Token 的 Windows 凭据存储位置不变，移动 EXE 不会切换付费任务记录。初始化失败会显示原生错误弹窗，并尝试在 EXE 旁写入 `startup-error.log`，无需删除旧版数据。

**本机自动验收仍有一项未通过**：默认 AppData 的 `history_list` 返回 `storage_unavailable`；本机 Rust 写入探针也得到“拒绝访问”。没有搬迁持久数据、修改系统 ACL 或重发任何付费请求；本地存储不能标记为已通过，需在实际用户启动后继续核验。详见 `VALIDATION.md`。

可选网页验收：`npm run preview`；设置 `PLAYWRIGHT_MODULE` 和 `BROWSER_EXECUTABLE` 后运行 `npm run test:browser`。脚本使用独立 context 并阻断非本机请求。

## 协议与安全

证据索引 `contracts/novelai-evidence.json`：公开 Swagger 快照 + 官网公开客户端观察 + 用户文档。客户端观察不是承诺稳定的正式 schema；fixture 是应用自编的期望请求，不是已执行付费样本。Rust 固定 HTTPS endpoint，禁重定向、显式禁重试；UI 不能提交任意 URL 或服务端 JSON。

## 性能和回退

启动不打开数据库、不读 Token、不扫描历史、不连接 NAI；次级页面按需加载。尚未测量发行版冷/热启动和全进程树内存，不声称已比旧版快若干倍。继续使用根目录旧入口即可回退。


