# NAITools

Windows 桌面端 NovelAI 图像生成工具，基于 Langbai 开展 PC 重构。

## 当前重构路线

**默认界面已切回 Langbai 2.4.4 原版，不再加载之前自定义的提示词输入框或近似工作台。**

- 原版 React / TypeScript 渲染器、组件、样式和状态逻辑冻结在 `desktop/langbai`，逐文件校验源内容。
- Electron 桌面宿主与服务逐项替换为 Rust / Tauri 2；并非所有界面组件改用 Rust 绘制。
- 仅覆盖产品名、版本号和项目地址，其余界面交互直接复用原版，后续再调整。
- 未接通的原生接口明确报错，不伪造成功或发送付费请求。

本阶段已适配本地设置、首次运行状态、凭据存在状态、窗口操作、内置反推模板，以及 PNG / JPEG / WebP 本地图片导入、重新加载、清除与元数据快照。图片保留原始字节及尺寸，元数据复用原版解析器；没有元数据则不补造字段。

**原版生成、历史管理、参考预设库及多个账号 / 第三方提供商切换仍需接通。** 先前自定义界面中的 Rust 服务代码保留供迁移和回归，不代表当前原版界面已具备全部服务。本机默认 AppData 读写和真实生图尚未通过原生验收。详见 [迁移进度](desktop/LANGBAI_PARITY.md)及 [验收说明](desktop/VALIDATION.md)。

## 启动

本机构建成功后，运行根目录 `启动程序.bat`、`start.bat` 或 `desktop/启动PC新版.cmd`。这些入口均指向 `desktop/target/release/naitools.exe`，不再回退到旧 Electron 程序。仓库不提交本机构建的 EXE。

迁移版本首次打开数据库可能进行保留现有表的 v4 → v5 升级；旧 v4 程序不能直接读取升级后的数据库。运行前应退出应用并完整备份数据目录（包含数据库及 WAL / SHM 文件、任务记录与素材）。不要通过删除数据库、切换目录或恢复旧 EXE 处理错误。

## 开发与验证

在 `desktop` 目录执行 `npm ci`，然后：

- `npm test`：前端及适配层回归。
- `npm run build`：默认原版界面生产构建。
- `npm run check:langbai-source`：源快照、接口清单与内置默认值完整性检查。
- `npm run desktop:dev`：Rust 宿主开发入口。
- `npm run desktop:build`：构建默认原版界面 release 可执行文件，无安装包。
- `npm run preview` / `npm run test:browser`：隔离浏览器与合成 IPC 回归，不替代原生验收。
- `npm run build:langbai` / `npm run desktop:build:langbai`：保留端口 1421 的独立构建配置；后者仅生成 debug 版本。

构建环境为 Node.js 24、Rust stable（MSVC）、VS 2022 Build Tools 的 C++ 桌面工具与 Windows SDK；运行需要 WebView2。应用标识、持久数据位置及凭据命名空间保持不变。

## 协议、安全与许可

只按已核验的协议子集编写原生请求，不从界面字段推断服务契约。OpenAI Images 暂不做格式转换。收费请求不会自动重试；未知结果需人工核对。密钥使用 Windows 凭据管理器，不写入仓库或普通设置。代码仓库不包含运行凭据、个人历史或本机数据库。

保留 Langbai 原作者版权、根目录完整 MIT 许可证及 Git 历史。第三方依赖与随原版附带的资源分别核查许可，代码 MIT 不自动授予所有图像素材权利。本项目并非 NovelAI 官方产品。
