import { defineConfig } from "vite";
import langbai from "./vite.langbai.config";
// The original renderer is the default. The retired custom editor is not loaded.
export default defineConfig({
  ...langbai,
  server: { ...langbai.server, port: 1420 },
  preview: { ...langbai.preview, port: 1420 },
});
