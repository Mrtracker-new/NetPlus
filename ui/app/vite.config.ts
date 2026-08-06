import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the Tauri-hosted UI. Tauri serves this
// build in a native webview; the fixed port + no-clear keeps the Tauri CLI's
// dev integration predictable.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
