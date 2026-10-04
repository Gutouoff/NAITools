import type {PromptDocument} from "../platform/types.ts";
export function newPromptDocument(raw=""):PromptDocument {return {mode:"raw",raw,blocks:["画师","角色数量与身份","外观特征","服饰配件","动作与表情","场景环境","镜头与构图","光影","媒介与风格","质量词"].map((title,i)=>({id:`block-${i+1}`,title,enabled:true,text:""}))};}
// Unicode White_Space matches Rust str::trim, unlike JS trim (which trims BOM).
const trim=(text:string)=>text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu,"");
export function compilePrompt(doc:PromptDocument):string {
  if(doc.mode==="raw")return doc.raw;
  let result="";for(const b of doc.blocks){if(!b.enabled)continue;const text=trim(b.text);if(!text)continue;if(result)result+=(result.endsWith(",")||text.startsWith(","))?"\n":",\n";result+=text;}return result;
}
export function compileLayers(doc:PromptDocument):string {return compilePrompt({...doc,mode:"layered"});}
