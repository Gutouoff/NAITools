# 第三方与来源说明

## 原项目

NAITools 的来源项目为 Langbai 的 novelai-image-desktop。原版权为 `Copyright (c) 2026 Langbai`，完整 MIT 文本保留在根目录 LICENSE，原 Git 历史不改写。

旧版 Electron、Flutter、插件及其二进制不包含在本次 PC 源码树中；它们的许可证不能据本项目 MIT 推断或替换。

## PC 依赖

前端依赖由 `desktop/package-lock.json` 固定，Rust 依赖由 `desktop/Cargo.lock` 固定。

- React / React DOM：MIT，原许可证随 npm 包提供。
- Tauri 与 Tauri API：MIT / Apache-2.0，依赖包中保留原许可证。
- Rust 图像、ZIP、SQLite、HTTP、Windows 凭据及系统集成依赖：遵循各包原许可证，不能统一视为项目 MIT。

源代码仓库并非包含依赖的二进制发行包。打包发布时必须收集实际分发依赖的版权和完整许可证文本，并随软件交付；不能仅以此清单替代完整第三方许可。

NovelAI 名称与服务属于其权利人，本项目不授予其商标或服务使用权。
