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
    proxy: {
      // Browser development transport -> local Rust engine HTTP bridge
      "/api": {
        target: "http://127.0.0.1:4040",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if ("writeHead" in res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: {
                    code: "BACKEND_UNAVAILABLE",
                    message: "NetPulse backend engine is not running on 127.0.0.1:4040",
                  },
                })
              );
            }
          });
        },
      },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
