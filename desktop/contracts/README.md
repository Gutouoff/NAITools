# 协议证据与本地契约

当前状态：`observed_subset`（官方来源观察后实现的 V4.5 非流式子集），**不等于真实付费验收通过，也不是官方完整 schema**。

## 来源

`novelai-evidence.json` 保存来源 URL、2026-10-03 获取日期、SHA-256、分类、已知缺口和应用限制。

- `official/novelai-image-openapi-2026-10-03.json`：从图像 Swagger UI 的 `doc.json` 配置定位取得的完整 Swagger 2.0 快照。info.version=1.0 是文档版本，不是模型发布日期。
- 官网公开客户端脚本：Bearer 格式、V4.5 IDs/defaults、legacy JSON、V4 caption、i2i、encode-vibe 和已编码参考数组。脚本仅缓存于忽略目录 `.evidence-cache`；索引记录 hash/provenance，不将大段官网代码复制到仓库。
- 官方用户文档：Vibe 首次编码费用/缓存/提取量、多图参考说明。最多 4 个参考、总强度 <= 1 等是本应用保守边界，不冒充 NAI 硬上限。
- 旧版实现仅是兼容参考，不能代替官方依据。

## 本地 fixtures

- `ipc-v1.fixture.json`：旧底座提示词/历史 DTO 兼容测试，宿主握手已升为 IPC 2。
- `prompt-v1.fixture.json`：Rust/TypeScript 共享的原文与分层拼接测试。
- `generation-v1.fixture.json`：应用自编的 V4.5 期望请求字段；不是收费捕获数据、不是官方提供示例，也没有 Token。

## 首版选择

JSON POST + 单图 ZIP，不实现 streaming；Swagger 的 SSE 描述和公开客户端二进制流观察存在差异，不能猜。JSON 响应 prose/schema 不一致，首版不接该响应路径。

已编码氛围只传 reference_image_multiple / reference_strength_multiple；提取量在 encode 阶段应用，不在生成阶段重复应用。i2i 的 extra_noise_seed 按观察为 seed-1，包括 seed=0 时的 -1；本地测试不重写成臆造范围。

任意 URL / 任意远程参数被隔离于 IPC，凭据仅原生 keyring。付费操作必须明确确认、提交前落盘、结果未知不重试。真实验收与性能验证状态以 `../VALIDATION.md` 为准。
