export type PromptWindowField = "positivePrompt" | "negativePrompt" | "stylePrompt" | "promptTab" | "draft";

export type PromptWindowEdit = { field: PromptWindowField; value: string };

export type PromptWindowSnapshot = {
  positivePrompt: string;
  negativePrompt: string;
  stylePrompt: string;
  promptTab: "positive" | "negative";
  draft: string | null;
  revision: number;
  language?: string;
};

export interface PromptMainWindowApi {
  open: () => Promise<void>;
  publish: (snapshot: PromptWindowSnapshot) => void;
  onEdit: (listener: (change: PromptWindowEdit) => void) => () => void;
}

export interface PromptPopupWindowApi {
  edit: (change: PromptWindowEdit) => void;
  request: () => void;
  onSnapshot: (listener: (snapshot: PromptWindowSnapshot) => void) => () => void;
}

export function isPromptWindowEdit(value: unknown): value is PromptWindowEdit {
  if (!value || typeof value !== "object") return false;
  const edit = value as Partial<PromptWindowEdit>;
  if (typeof edit.value !== "string") return false;
  if (edit.field === "promptTab") return edit.value === "positive" || edit.value === "negative";
  if (edit.field === "draft") return edit.value.length <= 120_000;
  return (edit.field === "positivePrompt" || edit.field === "negativePrompt" || edit.field === "stylePrompt")
    && edit.value.length <= 60_000;
}

export function isPromptWindowSnapshot(value: unknown): value is PromptWindowSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PromptWindowSnapshot>;
  return Number.isSafeInteger(snapshot.revision) && snapshot.revision! >= 0
    && (snapshot.draft === null || (typeof snapshot.draft === "string" && snapshot.draft.length <= 120_000))
    && ["positivePrompt", "negativePrompt", "stylePrompt"].every(field =>
      typeof snapshot[field as keyof PromptWindowSnapshot] === "string"
      && (snapshot[field as keyof PromptWindowSnapshot] as string).length <= 60_000)
    && (snapshot.promptTab === "positive" || snapshot.promptTab === "negative")
    && (snapshot.language === undefined || (typeof snapshot.language === "string" && snapshot.language.length <= 24));
}
