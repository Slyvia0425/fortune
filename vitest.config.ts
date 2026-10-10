import path from "node:path";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } } });

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
