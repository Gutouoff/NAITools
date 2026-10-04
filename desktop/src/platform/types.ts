// App-local DTOs, not NovelAI's wire schema.
export interface NaiContractStatus { verification: "unverified" | "observed_subset"; generationEnabled: boolean; reason: string; evidenceFile: string }
export interface BootInfo { schemaVersion: 2; appVersion: string; runtime: "tauri" | "browser_preview"; storage: "isolated_sqlite_lazy" | "unavailable"; hostElapsedMs: number | null; rendererReadyHostMs: number | null; naiContract: NaiContractStatus }
export interface PromptBlock { id: string; title: string; enabled: boolean; text: string }
export interface PromptDocument { mode: "raw" | "layered"; raw: string; blocks: PromptBlock[] }
export interface EditorDraft { prompt: string; negativePrompt: string; promptDocument?: PromptDocument }
export interface HistoryCursor { createdAtMs: number; id: string }
export interface HistoryQuery { limit?: number; before?: HistoryCursor | null }
export interface HistoryItem { id: string; createdAtMs: number; prompt: string; artifactId: string }
export interface HistoryPage { items: HistoryItem[]; nextCursor: HistoryCursor | null }
export interface GenerationInput { draft: EditorDraft; model: string; mode: "txt2img" | "i2i"; width: number; height: number; steps: number; guidance: number; sampler: string; seed: number | null; imageId: string | null; strength: number; noise: number; vibes: { encodingId: string; strength: number }[]; confirmPaid: boolean }
export interface GenerationResult { taskId: string; artifactId: string; seed: number; imageUrl: string }
export interface ImageAsset { id: string; width: number; height: number; previewUrl: string }
export interface VibeAsset { id: string; model: string; informationExtracted: number; cacheHit: boolean }
export interface EncodeInput { imageId: string; model: string; informationExtracted: number; confirmPaid: boolean }
export interface TaskRecord { id: string; kind: string; state: "queued" | "submitting" | "running" | "completed" | "failed" | "cancelled" | "outcome_unknown"; createdAtMs: number; acknowledged: boolean; errorCode: string | null }
export class DesktopError extends Error { readonly code: string; readonly retryable: boolean; constructor(code: string, message: string, retryable: boolean) { super(message); this.name="DesktopError"; this.code=code; this.retryable=retryable; } }
export function normalizeError(value: unknown): DesktopError { if (value instanceof DesktopError) return value; if (value!==null && typeof value==="object" && "code" in value && "message" in value && typeof value.code==="string" && typeof value.message==="string") return new DesktopError(value.code,value.message,"retryable" in value && value.retryable===true); return new DesktopError("ipc_failed","本地服务调用失败；未自动重试。",false); }
