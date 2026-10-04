// Source-only inventory; never evaluates the renderer or Electron modules.
import ts from "typescript";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const base = resolve(root, "langbai");
const source = ts.createSourceFile("types.ts", readFileSync(resolve(base,"src/types.ts"),"utf8"), ts.ScriptTarget.Latest, true);
const contract = source.statements.find(n => ts.isInterfaceDeclaration(n) && n.name.text === "NaiDesktopApi");
if (!contract) throw new Error("Missing NaiDesktopApi");
const api = contract.members.map(n => ({name:n.name.getText(source), optional:!!n.questionToken, signature:n.getText(source), uses:[]}));
const byName = new Map(api.map(n => [n.name,n]));
const dependencies = new Set();
const dynamicAccess = [];
const visitFiles = dir => readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? visitFiles(resolve(dir,e.name)) : /\.[cm]?[jt]sx?$/.test(e.name) ? [resolve(dir,e.name)] : []);
for (const file of visitFiles(resolve(base,"src")).sort((a,b)=>{const x=relative(base,a).replaceAll("\\","/"),y=relative(base,b).replaceAll("\\","/");return x<y?-1:x>y?1:0;})) {
 const tree = ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
 const scan = n => {
  if ((ts.isImportDeclaration(n)||ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.moduleSpecifier.text.startsWith(".")) {
   if (!(ts.isImportDeclaration(n) && n.importClause?.isTypeOnly)) dependencies.add(n.moduleSpecifier.text);
  }
  if (ts.isPropertyAccessExpression(n) && n.expression.getText(tree) === "window.naiDesktop") {
   const line = tree.getLineAndCharacterOfPosition(n.getStart(tree)).line+1;
   const member=byName.get(n.name.text);
   if (!member) throw new Error("Unknown desktop member: " + n.name.text);
   member.uses.push({file:relative(base,file).replaceAll("\\","/"),line});
  }
  if (ts.isElementAccessExpression(n) && n.expression.getText(tree) === "window.naiDesktop") dynamicAccess.push({file:relative(base,file).replaceAll("\\","/"),expression:n.getText(tree)});
  ts.forEachChild(n,scan);
 };
 scan(tree);
}
const result={schemaVersion:1,sourceVersion:"2.4.4",methodCount:api.length,referencedDirectly:api.filter(n=>n.uses.length).length,dependencies:[...dependencies].sort(),dynamicAccess,members:api};
const output=resolve(root,"compat/langbai-api-inventory.json");
const text=JSON.stringify(result,null,2)+"\n";
if(process.argv.includes("--check")) { if(readFileSync(output,"utf8")!==text) throw new Error("Inventory drift; regenerate with npm run inventory:langbai"); }
else writeFileSync(output,text);
const descriptors = contract.members.map(n => ({name:n.name.getText(source),optional:!!n.questionToken,kind:!ts.isFunctionTypeNode(n.type) ? "property" : ts.isFunctionTypeNode(n.type.type) ? "subscription" : ts.isTypeReferenceNode(n.type.type) && n.type.type.typeName.getText(source)==="Promise" ? "promise" : "sync"}));
const descriptorOutput=resolve(root,"compat/langbai-api-members.json");
const descriptorText=JSON.stringify(descriptors,null,2)+"\n";
if(process.argv.includes("--check")) {if(readFileSync(descriptorOutput,"utf8")!==descriptorText)throw new Error("Runtime member descriptor drift");}
else writeFileSync(descriptorOutput,descriptorText);
console.log("Langbai API:", api.length, "members;", result.referencedDirectly, "directly referenced");
