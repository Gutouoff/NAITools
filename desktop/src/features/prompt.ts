import type { PromptDocument } from "../platform/types.ts";

/** Artist strings are separate from the positive prompt, as in Langbai. */
export function newPromptDocument(raw = ""): PromptDocument {
  return {
    mode: "raw", raw, stylePrompt: "",
    blocks: ["角色数量与身份", "外观特征", "服饰配件", "动作与表情", "场景环境", "镜头与构图", "光影", "媒介与风格", "质量词"]
      .map((title, i) => ({ id: `block-${i + 2}`, title, enabled: true, text: "" })),
  };
}
// Unicode White_Space matches Rust str::trim, unlike JS trim (which trims BOM).
const trim = (text: string) => text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
export function compileBody(doc: PromptDocument): string {
  if (doc.mode === "raw") return doc.raw;
  let result = "";
  for (const block of doc.blocks) {
    if (!block.enabled) continue;
    const text = trim(block.text);
    if (!text) continue;
    if (result) result += result.endsWith(",") || text.startsWith(",") ? "\n" : ",\n";
    result += text;
  }
  return result;
}
export function compilePrompt(doc: PromptDocument): string {
  const style = trim(doc.stylePrompt ?? "");
  const body = compileBody(doc);
  if (!style) return body;
  if (!body) return style;
  return style + (style.endsWith(",") || body.startsWith(",") ? "\n" : ",\n") + body;
}
export function compileLayers(doc: PromptDocument): string {
  return compilePrompt({ ...doc, mode: "layered" });
}
