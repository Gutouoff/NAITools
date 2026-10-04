// Only column ratios are persisted. Prompts, images and credentials never enter layout storage.
export interface PanelWidths {
    editor: number;
    controls: number;
}
export const DEFAULT_WIDTHS: PanelWidths = { editor: 0.34, controls: 0.22 };
export function readWidths(raw: string | null): PanelWidths {
    try {
        const value = JSON.parse(raw ?? "null");
        if (value && typeof value.editor === "number" && typeof value.controls === "number" && Number.isFinite(value.editor) && Number.isFinite(value.controls) && value.editor >= 0.1 && value.controls >= 0.1 && value.editor + value.controls <= 0.8)
            return value;
    }
    catch { /* invalid optional state */ }
    return { ...DEFAULT_WIDTHS };
}
export function fitWidths(available: number, ratios: PanelWidths): PanelWidths {
    const width = Math.max(720, available);
    const editor = Math.max(260, Math.min(width - 460, width * ratios.editor));
    const controls = Math.max(220, Math.min(width - editor - 240, width * ratios.controls));
    return { editor, controls };
}
