import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_GRID, parsePromptDockHeight, parsePromptGrid } from "./prompt-grid";

describe("prompt grid preferences", () => {
  it("defaults on absent or malformed storage", () => {
    expect(parsePromptGrid(null)).toEqual(DEFAULT_PROMPT_GRID);
    expect(parsePromptGrid("broken")).toEqual(DEFAULT_PROMPT_GRID);
    expect(parsePromptDockHeight(null)).toBe(300);
  });

  it("keeps hidden blocks independent of contents and clamps block sizes", () => {
    expect(parsePromptGrid(JSON.stringify({
      columns: 2, rowHeight: 180, hidden: [0, 4, 4, 11, -1],
      sizes: { 4: { span: 8, height: 600 }, 2: { span: 1, height: 120 }, 15: { span: 1, height: 100 } },
    }))).toEqual({
      columns: 2, rowHeight: 180, hidden: [0, 4],
      sizes: { 2: { span: 1, height: 120 }, 4: { span: 2, height: 420 } },
    });
    expect(parsePromptDockHeight("9999")).toBe(700);
  });
});
