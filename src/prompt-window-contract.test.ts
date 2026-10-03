import { describe, expect, it } from "vitest";
import { isPromptWindowEdit, isPromptWindowSnapshot } from "./prompt-window-contract";

describe("detached prompt IPC", () => {
  it("rejects unknown fields, oversized payloads and invalid tabs", () => {
    expect(isPromptWindowEdit({ field: "stylePrompt", value: "vivid" })).toBe(true);
    expect(isPromptWindowEdit({ field: "token", value: "secret" })).toBe(false);
    expect(isPromptWindowEdit({ field: "promptTab", value: "inpaint" })).toBe(false);
    expect(isPromptWindowEdit({ field: "positivePrompt", value: "x".repeat(60_001) })).toBe(false);
    expect(isPromptWindowEdit(null)).toBe(false);
  });

  it("validates canonical snapshots", () => {
    const snapshot = { positivePrompt: "a", negativePrompt: "b", stylePrompt: "c", promptTab: "positive", draft: null, revision: 2 };
    expect(isPromptWindowSnapshot(snapshot)).toBe(true);
    expect(isPromptWindowSnapshot({ ...snapshot, revision: -1 })).toBe(false);
    expect(isPromptWindowSnapshot({ ...snapshot, negativePrompt: undefined })).toBe(false);
  });
});
