import { useEffect } from "react";
import { parseLayeredPrompt } from "./layered-prompt";
import type { PromptWindowSnapshot } from "./prompt-window-contract";
import { useAppStore } from "./store";

const DRAFT_KEY = "langbai.prompt.layers.v1";

export function PromptMainSync() {
  useEffect(() => {
    const bridge = window.promptWindowMain;
    if (!bridge) return;
    let revision = 0;
    let lastContents = "";
    const publish = () => {
      const { params, promptTab, settings } = useAppStore.getState();
      const language = settings?.language;
      let draft: string | null = null;
      try { draft = localStorage.getItem(DRAFT_KEY); } catch { /* optional storage */ }
      const contents = JSON.stringify([params.positivePrompt, params.negativePrompt, params.stylePrompt, promptTab, draft, language]);
      if (contents === lastContents) return;
      lastContents = contents;
      bridge.publish({
        positivePrompt: params.positivePrompt,
        negativePrompt: params.negativePrompt,
        stylePrompt: params.stylePrompt ?? "",
        promptTab,
        draft,
        revision: ++revision,
        language,
      } satisfies PromptWindowSnapshot);
    };
    const unsubscribeStore = useAppStore.subscribe(publish);
    const unsubscribeEdit = bridge.onEdit(({ field, value }) => {
      if (field === "draft") {
        try {
          const source = JSON.parse(value) as { source?: unknown };
          if (typeof source.source !== "string" ||
              JSON.stringify(parseLayeredPrompt(value, source.source)) !== JSON.stringify(source)) return;
          localStorage.setItem(DRAFT_KEY, value);
          window.dispatchEvent(new CustomEvent("prompt-draft:external", { detail: value }));
          publish();
        } catch { /* invalid or unavailable draft */ }
      } else if (field === "promptTab") {
        useAppStore.getState().setPromptTab(value as "positive" | "negative");
      } else {
        useAppStore.getState().setParam(field, value);
      }
    });
    window.addEventListener("prompt-draft:changed", publish);
    publish();
    return () => {
      unsubscribeStore();
      unsubscribeEdit();
      window.removeEventListener("prompt-draft:changed", publish);
    };
  }, []);
  return null;
}
