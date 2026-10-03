import { describe, expect, it } from "vitest";
import { composeLayeredPrompt, freshLayeredPrompt, parseLayeredPrompt } from "./layered-prompt";

describe("layered positive prompt", () => {
  it("preserves legacy text exactly until new layers are added", () => {
    const old = "  {artist:example}, [1girl],  ";
    const draft = freshLayeredPrompt(old);
    expect(composeLayeredPrompt(draft)).toBe(old);
    draft.layers[0] = "1girl";
    draft.layers[3] = "red dress, ribbon";
    expect(composeLayeredPrompt(draft)).toBe("  {artist:example}, [1girl],   1girl, red dress, ribbon");
  });

  it("joins enabled layers in order without splitting weighted tags", () => {
    const draft = freshLayeredPrompt("");
    draft.layers[0] = "1girl, solo";
    draft.layers[1] = "{character, alias}:1.2";
    draft.layers[2] = "blue eyes";
    draft.enabled[1] = false;
    expect(composeLayeredPrompt(draft)).toBe("1girl, solo, blue eyes");
    draft.enabled[1] = true;
    expect(composeLayeredPrompt(draft)).toBe("1girl, solo, {character, alias}:1.2, blue eyes");
  });

  it("restores layers only when their source matches the current prompt", () => {
    const draft = freshLayeredPrompt("");
    draft.layers[0] = "2girls";
    draft.source = composeLayeredPrompt(draft);
    expect(parseLayeredPrompt(JSON.stringify(draft), "2girls")).toEqual(draft);
    expect(parseLayeredPrompt(JSON.stringify(draft), "external preset")).toEqual(freshLayeredPrompt("external preset"));
    expect(parseLayeredPrompt("invalid json", "legacy")).toEqual(freshLayeredPrompt("legacy"));
  });
});
