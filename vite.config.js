import { defineConfig } from "vite";
import { cpSync } from "node:fs";
export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "offline-pdf-assets",
      closeBundle() {
        for (const directory of ["cmaps", "standard_fonts"]) {
          cpSync(`node_modules/pdfjs-dist/${directory}`, `dist/${directory}`, {
            recursive: true,
          });
        }
      },
    },
  ],
  build: { target: "es2022", outDir: "dist", chunkSizeWarningLimit: 1800 },
});
