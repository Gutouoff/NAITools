# 第三方与来源说明

## 原项目

NAITools 的来源项目为 Langbai 的 novelai-image-desktop。原版权为 `Copyright (c) 2026 Langbai`，完整 MIT 文本保留在根目录 LICENSE，原 Git 历史不改写。

desktop/langbai 保存原版渲染器与附带资源的冻结快照，源版本 2.4.4；另含用于类型检查的声明文件，不含 Electron 服务实现。资源清单与 SHA-256 见 source-manifest.json。Flutter、Electron 服务运行时、插件二进制不纳入 PC 构建。图像、音频和其他独立素材的权利必须单独核查，不因代码 MIT 自动获得分发授权。

## PC 依赖

前端依赖由 `desktop/package-lock.json` 固定，Rust 依赖由 `desktop/Cargo.lock` 固定。

- React / React DOM：MIT，原许可证随 npm 包提供。
- @tanstack/react-virtual、clsx、date-fns、react-markdown、rehype-sanitize、remark-gfm、zustand：安装包声明为 MIT；完整版权和许可随各依赖包提供。
- react-icons：包装代码声明为 MIT；实际包含的图标集合遵循各自来源许可，发行时需核查使用的集合并附带相关声明。
- Tauri 与 Tauri API：MIT / Apache-2.0，依赖包中保留原许可证。
- Rust 图像、ZIP、SQLite、HTTP、Windows 凭据及系统集成依赖：遵循各包原许可证，不能统一视为项目 MIT。

源代码仓库并非包含依赖的二进制发行包。打包发布时必须收集实际分发依赖的版权和完整许可证文本，并随软件交付；不能仅以此清单替代完整第三方许可。

NovelAI 名称与服务属于其权利人，本项目不授予其商标或服务使用权。
