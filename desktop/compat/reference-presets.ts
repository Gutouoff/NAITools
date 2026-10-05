import type { NaiDesktopApi, ReferencePreset, ReferencePresetLibrary, ReferencePresetOperationResult, ReferencePresetSaveRequest } from "../langbai/src/types.ts";
import type { Invoke } from "../src/platform/desktop-api.ts";
import { DesktopError, normalizeError } from "../src/platform/types.ts";

export const REFERENCE_METHODS = ["listReferencePresets", "saveReferencePreset", "readReferencePreset", "deleteReferencePreset", "createReferencePresetGroup", "deleteReferencePresetGroup", "moveReferencePresetToGroup"] as const;
type NativePreset = Omit<ReferencePreset, "createdAt" | "filePath" | "fileUrl"> & { createdAtMs: number; extension: "png" | "jpg" | "webp" };
type NativeLibrary = { groups: string[]; presets: NativePreset[] };
const invalid = () => new DesktopError("reference_response_invalid", "参考预设数据不符合本地接口约束；未应用预设。", false);
function preset(row: NativePreset): ReferencePreset {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(row.id) || !["png", "jpg", "webp"].includes(row.extension)
      || !Number.isSafeInteger(row.createdAtMs) || row.createdAtMs < 0 || row.createdAtMs > 8_640_000_000_000_000
      || !["vibe", "precise"].includes(row.kind) || !["character", "style", "character&style"].includes(row.preciseType)
      || typeof row.name !== "string" || !row.name.trim() || typeof row.group !== "string"
      || [row.infoExtracted, row.strength, row.fidelity, row.informationExtracted].some(n => !Number.isFinite(n) || n < 0 || n > 1)
      || !Number.isInteger(row.width) || !Number.isInteger(row.height) || row.width <= 0 || row.height <= 0
      || row.width > 8192 || row.height > 8192 || row.width * row.height > 16_777_216) throw invalid();
  const { createdAtMs, extension, ...parameters } = row;
  return { ...parameters, createdAt: new Date(createdAtMs).toISOString(),
    filePath: `naitools://imports/${row.id}.${extension}`,
    fileUrl: `http://naitools-image.localhost/imports/${row.id}.${extension}` };
}
function library(result: NativeLibrary): ReferencePresetLibrary {
  if (!Array.isArray(result.groups) || result.groups.some(g => typeof g !== "string" || !g.trim())
      || !Array.isArray(result.presets) || result.presets.length > 5000) throw invalid();
  const presets = result.presets.map(preset);
  if (new Set(presets.map(p => p.id)).size !== presets.length) throw invalid();
  return { groups: result.groups, presets };
}
export function createReferenceMethods(call: Invoke) {
  // Original write handlers consume OperationResult rather than exceptions.
  // Preserve errors as failed operations so busy state is released; no retries.
  async function operation(run: () => Promise<ReferencePresetOperationResult>): Promise<ReferencePresetOperationResult> {
    try { return await run(); } catch (error) { return { ok: false, message: normalizeError(error).message }; }
  }
  const edit = (action: "delete" | "create_group" | "delete_group" | "move", id?: string, group?: string) => operation(async () => ({
    ok: true, library: library(await call<NativeLibrary>("langbai_reference_edit", { action, id: id ?? null, group: group ?? null })),
  }));
  return {
    listReferencePresets: async () => library(await call<NativeLibrary>("langbai_references_list")),
    saveReferencePreset: (request: ReferencePresetSaveRequest) => operation(async () => ({ ok: true,
      library: library(await call<NativeLibrary>("langbai_reference_save", { request })),
    })),
    readReferencePreset: (id: string) => operation(async () => {
      const result = await call<{ preset: NativePreset; base64: string }>("langbai_reference_read", { id });
      if (typeof result.base64 !== "string" || !result.base64.length || result.base64.length > Math.ceil(16*1024*1024/3)*4) throw invalid();
      return { ok: true, preset: preset(result.preset), base64: result.base64 };
    }),
    deleteReferencePreset: (id: string) => edit("delete", id),
    createReferencePresetGroup: (group: string) => edit("create_group", undefined, group),
    deleteReferencePresetGroup: (group: string) => edit("delete_group", undefined, group),
    moveReferencePresetToGroup: (id: string, group: string) => edit("move", id, group),
  } satisfies Partial<NaiDesktopApi>;
}
