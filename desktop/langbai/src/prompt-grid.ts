export const PROMPT_GRID_KEY = "langbai.prompt.grid.v1";
export const PROMPT_DOCK_KEY = "langbai.prompt.dock.height.v1";

export type PromptGridPrefs = {
  columns: number;
  rowHeight: number;
  hidden: number[];
  sizes: Record<number, { span: number; height: number }>;
};

export const DEFAULT_PROMPT_GRID: PromptGridPrefs = {
  columns: 3, rowHeight: 98, hidden: [], sizes: {},
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

export function parsePromptGrid(raw: string | null): PromptGridPrefs {
  if (!raw) return { ...DEFAULT_PROMPT_GRID };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { ...DEFAULT_PROMPT_GRID };
    const input = value as Partial<PromptGridPrefs>;
    const columns = Number.isFinite(input.columns) ? clamp(input.columns!, 1, 6) : 3;
    const rowHeight = Number.isFinite(input.rowHeight) ? clamp(input.rowHeight!, 74, 260) : 98;
    const hidden = Array.isArray(input.hidden)
      ? [...new Set(input.hidden.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 9))]
      : [];
    const sizes: PromptGridPrefs["sizes"] = {};
    if (input.sizes && typeof input.sizes === "object" && !Array.isArray(input.sizes)) {
      for (const [key, size] of Object.entries(input.sizes)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index > 9 || !size || typeof size !== "object") continue;
        if (!Number.isFinite(size.span) || !Number.isFinite(size.height)) continue;
        sizes[index] = { span: clamp(size.span, 1, columns), height: clamp(size.height, 74, 420) };
      }
    }
    return { columns, rowHeight, hidden, sizes };
  } catch {
    return { ...DEFAULT_PROMPT_GRID };
  }
}

export function parsePromptDockHeight(raw: string | null): number {
  const height = Number(raw);
  return raw && Number.isFinite(height) ? clamp(height, 180, 700) : 300;
}
