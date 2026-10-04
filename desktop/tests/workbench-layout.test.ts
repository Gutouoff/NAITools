import test from "node:test";
import assert from "node:assert/strict";
import {fitWidths,readWidths,DEFAULT_WIDTHS} from "../src/features/workbench-layout.ts";
test("layout state rejects malformed and overflowing ratios",()=>{
  for(const value of [null,"bad","{}",'{"editor":9,"controls":8}','{"editor":-1,"controls":0.3}'])assert.deepEqual(readWidths(value),DEFAULT_WIDTHS);
});
test("column widths fit actual container and retain preview minimum",()=>{
  for(const width of [720,800,1100,1600])for(const ratio of [{editor:.7,controls:.1},{editor:.1,controls:.7},DEFAULT_WIDTHS]){
    const fitted=fitWidths(width,ratio);assert.ok(fitted.editor>=260);assert.ok(fitted.controls>=220);assert.ok(width-fitted.editor-fitted.controls>=240);
  }
});
