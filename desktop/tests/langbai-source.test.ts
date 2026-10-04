import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
import ts from "typescript";
const base = fileURLToPath(new URL("../langbai/", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(base,"source-manifest.json"),"utf8"));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
test("frozen Langbai renderer and assets retain every captured source byte", () => {
 assert.equal(manifest.backendCopied,false);
 for (const record of manifest.records) {
  const bytes = readFileSync(resolve(base,record.path));
  assert.equal(bytes.length,record.bytes,record.path);
  assert.equal(hash(bytes),record.sha256,record.path);
 }
 const stub=readFileSync(resolve(base,manifest.declarationOnly.target));
 assert.equal(hash(stub),manifest.declarationOnly.sha256);
 assert.equal(hash(readFileSync(resolve(base,manifest.derivedMetadata.path))),manifest.derivedMetadata.sha256);
});
test("snapshot contains no unmanifested runtime or Electron implementation", () => {
 const walk=(dir:string):string[] => readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory()?walk(resolve(dir,e.name)):[relative(base,resolve(dir,e.name)).replaceAll("\\","/")]);
 const expected=[...manifest.records.map((r:{path:string})=>r.path),manifest.declarationOnly.target,manifest.derivedMetadata.path,"source-manifest.json"].sort();
 assert.deepEqual(walk(base).sort(),expected);
 for (const record of manifest.records.filter((r:{path:string})=>/\.[jt]sx?$/.test(r.path))) {
  const tree=ts.createSourceFile(record.path,readFileSync(resolve(base,record.path),"utf8"),ts.ScriptTarget.Latest,true);
  const scan=(node:ts.Node) => {
   if(ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly)
    assert.ok(!/^(electron|node:|sharp|@huggingface\/)/.test(node.moduleSpecifier.text),record.path);
   ts.forEachChild(node,scan);
  };
  scan(tree);
 }
});
