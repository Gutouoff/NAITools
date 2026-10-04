import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compilePrompt,compileLayers,newPromptDocument} from "../src/features/prompt.ts";
import type {PromptDocument} from "../src/platform/types.ts";
const fixtures=JSON.parse(readFileSync(new URL("../contracts/prompt-v1.fixture.json",import.meta.url),"utf8")) as {document:PromptDocument;expected:string}[];
for(const [index,f] of fixtures.entries())test(`shared prompt fixture ${index+1} preserves exact syntax`,()=>assert.equal(compilePrompt(f.document),f.expected));
test("layer compilation preserves raw, repeated weights and disabled blocks",()=>{const doc=newPromptDocument("  raw stays unchanged  ");doc.blocks[0].text="  1.5::artist::, repeated, repeated,  ";doc.blocks[1].text="  {subject}, -2::text::  ";doc.blocks[2].text="must not send";doc.blocks[2].enabled=false;assert.equal(compileLayers(doc),"1.5::artist::, repeated, repeated,\n{subject}, -2::text::");assert.equal(compilePrompt(doc),"  raw stays unchanged  ");});
test("Unicode whitespace and BOM follow Rust trimming",()=>{const doc=newPromptDocument();doc.mode="layered";doc.blocks[0].text="\u0085 one \u2003";doc.blocks[1].text="\ufefftwo\ufeff";assert.equal(compilePrompt(doc),"one,\n\ufefftwo\ufeff");});
