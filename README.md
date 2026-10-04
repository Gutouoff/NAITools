# NAITools

Windows 桌面端 NovelAI 图像生成工具，基于 Langbai 开展 PC 重构。

## 当前重构路线

按原版 Langbai 2.4.4 的界面与交互迁移，不再另行设计近似工作台：

- 原版 React / TypeScript 渲染器、组件、样式和状态逻辑冻结在 desktop/langbai，逐文件校验源内容。
- Electron 桌面宿主与服务逐项替换为 Rust / Tauri 2；**并非所有界面组件改用 Rust 绘制**。
- 仅覆盖产品名、版本号和项目地址，其余原版界面暂不微调。
- 原版界面通过独立迁移入口构建；尚未成为默认入口，未接入的原生功能明确报错，不伪造成功。

本阶段已实现本地设置、首次运行状态、凭据存在状态及窗口操作的适配，以及原版内置反推模板读取。生成、历史、参考文件和多配置管理仍需完成原版接口适配，**不宣称完整复刻或真实生图已正常**。详见 [迁移进度](desktop/LANGBAI_PARITY.md)及 [验收说明](desktop/VALIDATION.md)。

## 现有 PC 开发预览

默认入口暂时保留先前的自定义工作台，已有 V4.5 单图文生图、图生图、氛围参考信息提取、提示词、API 多配置和本地历史等代码。真实服务生成及默认 AppData 的原生保存仍未通过验收；实现、模拟测试与端到端可用性需要区分。

## 开发与验证

在 desktop 目录执行 npm ci：

- npm run build：构建现有默认入口。
- npm run build:langbai：构建冻结的原版界面迁移入口。
- npm run check:langbai-source：检查源快照、契约清单及原版内置默认值。
- npm run desktop:dev:langbai：使用 Rust 宿主开发迁移入口。
- npm run desktop:build:langbai：构建迁移入口的 debug 可执行文件，不替换现有 release 程序。

构建环境为 Node.js 24、Rust stable（MSVC）、VS 2022 Build Tools 的 C++ 桌面工具与 Windows SDK；运行需要 WebView2。迁移版本首次打开数据库会进行保留现有表的 v4 → v5 升级，不能直接回退到仅支持 v4 的旧程序；升级前应退出程序并完整备份数据。应用标识、持久数据位置及凭据命名空间不变，不通过清库或切换目录规避错误。

## 协议、安全与许可

只按已核验的协议子集编写原生请求，不从界面字段推断服务契约。收费请求不会自动重试；未知结果需人工核对。密钥使用 Windows 凭据管理器，不写入仓库或普通设置。代码仓库不包含运行凭据、个人历史或本机数据库。

保留 Langbai 原作者版权、根目录完整 MIT 许可证及 Git 历史。第三方依赖与随原版附带的资源分别核查许可，代码 MIT 不自动授予所有图像素材权利。本项目并非 NovelAI 官方产品。
