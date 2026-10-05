import { convertFileSrc } from "@tauri-apps/api/core";
import type { GenerateParams, HistoryGroup, HistoryItem, NaiDesktopApi } from "../langbai/src/types.ts";
import type { Invoke } from "../src/platform/desktop-api.ts";
import { DesktopError } from "../src/platform/types.ts";
import type { GenerationInput, HistoryCursor } from "../src/platform/types.ts";

export const HISTORY_METHODS = [
  "getHistory", "getHistoryDates", "getHistoryGroups", "createHistoryGroup",
  "renameHistoryGroup", "deleteHistoryGroup", "setHistoryGroup",
] as const;
interface Receipt { id: string; artifactId: string; createdAtMs: number; groupId: string | null; request: GenerationInput | null }
interface ReceiptPage { items: Receipt[]; nextCursor: HistoryCursor | null }
interface NativeGroup { id: string; name: string; createdAtMs: number }
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const invalid = () => new DesktopError("history_response_invalid", "历史记录数据不完整或无效；未修改记录，也未发送请求。", false);

export function localHistoryDate(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8_640_000_000_000_000) throw invalid();
  const date = new Date(ms);
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function historyDateBounds(date?: string): { fromMs: number; untilMs: number } | Record<string, never> {
  if (!date) return {};
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw invalid();
  const [year, month, day] = match.slice(1).map(Number);
  const from = new Date(year, month - 1, day);
  if (year < 1970 || localHistoryDate(from.getTime()) !== date) throw invalid();
  // Calendar arithmetic, not +24h: local days may include DST transitions.
  const until = new Date(year, month - 1, day + 1);
  return { fromMs: from.getTime(), untilMs: until.getTime() };
}
function receiptParams(input: GenerationInput | null): GenerateParams {
  if (!input) throw new DesktopError("history_receipt_unavailable", "所选历史记录缺少生成参数快照；原始记录及图片已保留，未使用默认参数替代。", false);
  if (!(input.model === "nai-diffusion-4-5-full" || input.model === "nai-diffusion-4-5-curated")
    || !(input.sampler === "k_euler" || input.sampler === "k_euler_ancestral")
    || !input.draft || typeof input.draft.prompt !== "string" || typeof input.draft.negativePrompt !== "string"
    || !Number.isInteger(input.seed) || input.seed === null || input.seed < 0 || input.seed > 0xffff_ffff
    || !Number.isInteger(input.width) || input.width <= 0 || !Number.isInteger(input.height) || input.height <= 0
    || !Number.isInteger(input.steps) || input.steps <= 0 || !Number.isFinite(input.guidance)
  ) throw invalid();
  // These values are the actual saved Rust build_wire profile, NOT DEFAULT_PARAMS.
  // UC=3/quality=none disables *additional* preset tags on replay, as in the
  // original metadata importer. The merged caption must not be split or appended twice.
  return {
    model: input.model, stylePrompt: "", positivePrompt: input.draft.prompt,
    negativePrompt: input.draft.negativePrompt, preservePromptText: true,
    width: input.width, height: input.height, steps: input.steps, cfgScale: input.guidance,
    cfgRescale: 0, sampler: input.sampler, noiseSchedule: "karras", seed: input.seed,
    seedMode: "fixed", ucPreset: 3, qualityPreset: "none", qualityToggle: false,
    transparentBackground: false, smea: false, smeaDyn: false, variety: false, fileNamePrefix: "",
  };
}
export function createHistoryMethods(call: Invoke, mediaUrl = (id: string) => convertFileSrc(id, "naitools-image")) {
  const groups = (rows: NativeGroup[]): HistoryGroup[] => rows.map(row => {
    if (!ID.test(row.id) || typeof row.name !== "string") throw invalid();
    localHistoryDate(row.createdAtMs);
    return { id: row.id, name: row.name, createdAt: new Date(row.createdAtMs).toISOString() };
  });
  const edit = async (action: "create" | "rename" | "delete", id?: string, name?: string) =>
    groups(await call<NativeGroup[]>("langbai_history_group_edit", { action, id: id ?? null, name: name ?? null }));
  return {
    getHistory: async (date?: string, groupId?: string): Promise<HistoryItem[]> => {
      if (groupId && groupId !== "__ungrouped" && !ID.test(groupId)) throw invalid();
      const filter = { ...historyDateBounds(date), groupId: groupId || null };
      const result: HistoryItem[] = [];
      const ids = new Set<string>(); const cursors = new Set<string>();
      let before: HistoryCursor | null = null;
      do {
        const page: ReceiptPage = await call("langbai_history_page", { filter: { ...filter, before } });
        if (!Array.isArray(page.items) || page.items.length > 100) throw invalid();
        for (const row of page.items) {
          if (!ID.test(row.id) || !ID.test(row.artifactId) || ids.has(row.id)) throw invalid();
          ids.add(row.id);
          const params = receiptParams(row.request);
          const day = localHistoryDate(row.createdAtMs);
          if (date && day !== date) throw invalid();
          result.push({ id: row.id, filePath: `naitools://outputs/${row.artifactId}.png`,
            fileUrl: mediaUrl(row.artifactId), date: day, createdAt: new Date(row.createdAtMs).toISOString(),
            ...(row.groupId ? { groupId: row.groupId } : {}),
            params, actualSeed: params.seed, model: params.model, width: params.width, height: params.height });
        }
        before = page.nextCursor;
        if (before) {
          if (!page.items.length || !ID.test(before.id)) throw invalid();
          const last = page.items.at(-1)!;
          if (last.id !== before.id || last.createdAtMs !== before.createdAtMs) throw invalid();
          const key = `${before.createdAtMs}:${before.id}`;
          if (cursors.has(key)) throw invalid();
          cursors.add(key);
          // Never silently truncate the original unpaged API. Choose a day/group
          // instead of allocating an unbounded all-library renderer response.
          if (result.length >= 5000) throw new DesktopError("history_result_too_large", "所选范围超过 5000 条历史记录；请选择日期或分组缩小范围。记录未被截断或删除。", false);
        }
      } while (before);
      return result;
    },
    getHistoryDates: async () => {
      const days = await call<number[]>("langbai_history_days");
      return [...new Set(days.map(localHistoryDate))].sort().reverse();
    },
    getHistoryGroups: async () => groups(await call<NativeGroup[]>("langbai_history_groups")),
    createHistoryGroup: (name: string) => edit("create", undefined, name),
    renameHistoryGroup: (id: string, name: string) => edit("rename", id, name),
    deleteHistoryGroup: (id: string) => edit("delete", id),
    setHistoryGroup: async (id: string, groupId?: string) => {
      await call<void>("langbai_history_group_set", { id, groupId: groupId || null });
      return { ok: true };
    },
  } satisfies Partial<NaiDesktopApi>;
}
