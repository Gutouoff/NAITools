export const PROMPT_LAYERS = [
  { name: "艺术家与风格", hint: "画师、风格、年份", color: "#667085" },
  { name: "角色数量与性别", hint: "人数、性别", color: "#2563eb" },
  { name: "角色身份与性质", hint: "角色名、身份、种族", color: "#475467" },
  { name: "身体特征", hint: "发色、眼睛、体型", color: "#7c3aed" },
  { name: "服装与配饰", hint: "服装、鞋袜、饰品", color: "#ea580c" },
  { name: "动作与表情", hint: "姿势、动作、情绪", color: "#dc2626" },
  { name: "环境与背景", hint: "场景、道具、天气", color: "#0891b2" },
  { name: "光影与视角", hint: "光线、景别、镜头", color: "#475569" },
  { name: "整体风格", hint: "画风、质量词", color: "#a855f7" },
] as const;

export type LayeredPromptDraft = {
  source: string;
  legacy: string;
  layers: string[];
  enabled: boolean[];
};

export function freshLayeredPrompt(source: string): LayeredPromptDraft {
  return { source, legacy: source, layers: Array(8).fill(""), enabled: Array(8).fill(true) };
}

export function composeLayeredPrompt(draft: Pick<LayeredPromptDraft, "legacy" | "layers" | "enabled">): string {
  const parts = draft.layers.map((text, index) => draft.enabled[index] ? text : "")
    .map(text => text.trim().replace(/^,+\s*|\s*,+$/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return draft.legacy;
  if (!draft.legacy) return parts.join(", ");
  return draft.legacy + (draft.legacy.trimEnd().endsWith(",") ? " " : ", ") + parts.join(", ");
}

export function parseLayeredPrompt(saved: string | null, positivePrompt: string): LayeredPromptDraft {
  if (!saved) return freshLayeredPrompt(positivePrompt);
  try {
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== "object") return freshLayeredPrompt(positivePrompt);
    const draft = value as Partial<LayeredPromptDraft>;
    if (draft.source !== positivePrompt || typeof draft.legacy !== "string" ||
      !Array.isArray(draft.layers) || draft.layers.length !== 8 || !draft.layers.every(item => typeof item === "string") ||
      !Array.isArray(draft.enabled) || draft.enabled.length !== 8 || !draft.enabled.every(item => typeof item === "boolean") ||
      composeLayeredPrompt(draft as LayeredPromptDraft) !== positivePrompt) {
      return freshLayeredPrompt(positivePrompt);
    }
    return draft as LayeredPromptDraft;
  } catch {
    return freshLayeredPrompt(positivePrompt);
  }
}
