import type { DrawingPreset, GenerationInput } from "../platform/types.ts";
import { compilePrompt } from "./prompt.ts";
export const SIZE_PRESETS = [
    { name: "竖图", width: 832, height: 1216 }, { name: "横图", width: 1216, height: 832 },
    { name: "方图", width: 1024, height: 1024 }, { name: "小方图", width: 512, height: 512 },
    { name: "竖图 2:3", width: 768, height: 1152 }, { name: "横图 3:2", width: 1152, height: 768 },
];
export function localParameterError(i: GenerationInput): string | null {
    if (![i.width, i.height].every(v => Number.isInteger(v) && v >= 256 && v <= 1536 && v % 64 === 0) || i.width * i.height > 1048576)
        return "宽高须为 256–1536 之间的 64 倍数，总像素不得超过 1,048,576。";
    if (!Number.isInteger(i.steps) || i.steps < 1 || i.steps > 28)
        return "采样步数须为 1–28 的整数。";
    if (!Number.isFinite(i.guidance) || i.guidance < 1 || i.guidance > 10)
        return "提示词引导强度须为 1–10。";
    if (i.seed !== null && (!Number.isInteger(i.seed) || i.seed < 0 || i.seed > 4294967295))
        return "Seed 须为 0–4,294,967,295 的整数。";
    if (![i.strength, i.noise].every(v => Number.isFinite(v) && v >= 0 && v <= 1))
        return "图生图重绘强度与噪声须为 0–1。";
    return null;
}
export function makeDrawingPreset(i: GenerationInput, id: string, name: string): DrawingPreset {
    const draft = structuredClone(i.draft);
    if (draft.promptDocument)
        draft.prompt = compilePrompt(draft.promptDocument);
    return { id, name: name.trim(), draft, model: i.model, width: i.width, height: i.height, steps: i.steps, guidance: i.guidance, sampler: i.sampler, seed: i.seed, strength: i.strength, noise: i.noise };
}
export function applyDrawingPreset(i: GenerationInput, p: DrawingPreset): GenerationInput {
    // Explicit whitelist: never adopt credentials, routing, images or paid consent from a preset.
    return { ...i, draft: structuredClone(p.draft), model: p.model, width: p.width, height: p.height, steps: p.steps, guidance: p.guidance, sampler: p.sampler, seed: p.seed, strength: p.strength, noise: p.noise, vibes: [], confirmPaid: false };
}
const SELECTION_KEY = "naitools.activeConnection";
export function readSelectedConnection(): string {
    try {
        const id = localStorage.getItem(SELECTION_KEY);
        if (id && /^[A-Za-z0-9_-]{1,80}$/.test(id))
            return id;
    }
    catch { /* optional UI preference */ }
    return "default-novelai";
}
export function rememberConnection(id: string): void { try {
    localStorage.setItem(SELECTION_KEY, id);
}
catch { /* do not block account switching */ } }
