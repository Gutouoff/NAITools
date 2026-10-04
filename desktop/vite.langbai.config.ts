import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { version } from "./package.json";
const workspace=fileURLToPath(new URL(".",import.meta.url));
const root=fileURLToPath(new URL("./compat/",import.meta.url));
export default defineConfig({
 root, publicDir:"../langbai/public",
 plugins:[{
  name:"langbai-product-identity", enforce:"pre",
  transform(code,id) {
   if(!id.replaceAll("\\","/").endsWith("/langbai/src/types.ts"))return;
   const next=code.replace('export const APP_VERSION = packageVersion;',"export const APP_VERSION = "+JSON.stringify(version)+";")
    .replace('export const APP_NAME = "Langbai NovelAI Studio";','export const APP_NAME = "NAITools";')
    .replace('export const PROJECT_REPOSITORY = "https://github.com/2786886095/novelai-image-desktop";','export const PROJECT_REPOSITORY = "https://github.com/Gutouoff/NAITools";');
   if(next===code)throw new Error("Langbai identity override no longer matches source");
   return {code:next,map:null};
  },
 }],
 server:{host:"127.0.0.1",port:1421,strictPort:true,fs:{allow:[workspace]}},
 preview:{host:"127.0.0.1",port:1421,strictPort:true},
 clearScreen:false,
 build:{target:"es2022",outDir:"../dist-langbai",emptyOutDir:true,sourcemap:false,rollupOptions:{input:fileURLToPath(new URL("compat/index.html",import.meta.url))}},
});
