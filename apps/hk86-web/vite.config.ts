import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const base = process.env.BASE || "/";
const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base,
  build: {
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(appRoot, "index.html"),
        design: path.resolve(appRoot, "design.html"),
      },
    },
  },
});
