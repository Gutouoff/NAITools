# NAITools

Windows 桌面端 NovelAI 图像生成工具。新版使用 Rust + Tauri 2 + React / TypeScript；只发布 PC 重构源码，不包含旧版 Electron / 移动端、用户数据或构建缓存。

## 功能范围

- 文生图：V4.5 Full / Curated、Euler / Euler a、单张非流式生成。
- 图生图（i2i）：导入底图，按目标比例中心裁剪。
- 氛围参考（Vibe Transfer）：显式编码确认与本地缓存复用。
- 提示词：原文编辑、可排序分层模板与实际提交文本预览。
- 本地草稿、历史记录、PNG 导出与付费任务状态记录。
- Token 保存在 Windows 凭据管理器，不写入仓库或草稿。

当前是开发预览：真实 NovelAI 文生图、i2i、Vibe 编码尚未付费验收，默认 AppData 本地存储的原生验收仍未通过。实现和验证不能等同于端到端验收。见 [验证记录](desktop/VALIDATION.md)。

## 开发与运行

源码位于 [`desktop/`](desktop/README.md)。在该目录执行 `npm ci`、`npm run build`，然后使用 `scripts/windows-cargo.ps1` 编译 Windows release。运行 `desktop/启动PC新版.cmd`；需要 WebView2 Runtime，不依赖 Vite、Node 或 Python 后台服务。

构建环境：Node.js 24、Rust stable（MSVC）、VS 2022 Build Tools 的 C++ 桌面工具与 Windows SDK。详见 [开发说明](desktop/README.md) 和 [贡献指南](CONTRIBUTING.md)。

## 协议与安全

以公开官方资料与客户端观察为证据，只实现已核验的子集；不宣称完整官方 API。请求不会自动重试，结果未知时需人工核对。仓库不包含凭据、个人提示词、历史图像或本机运行数据。

## 来源与许可

项目基于 Langbai 的 novelai-image-desktop 项目开展 PC 重构。保留原作者版权、MIT 许可证和 Git 历史；不代表 NovelAI 官方产品，也不与其建立隶属关系。

本项目遵循 [MIT](LICENSE)。第三方依赖各自遵循其许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。
