import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The loopback engine bridge requires its capability token on /api/query and
// /api/command. The dev server adds it on the way out, so the token is never
// bundled into UI code nor served to the browser: run the shell once, copy the
// token it logs (`http_bridge.token`), and export the same value here as
// NETPULSE_BRIDGE_TOKEN. Without it the bridge answers 401 rather than serving an
// unauthenticated path to the engine.
const bridgeToken = process.env.NETPULSE_BRIDGE_TOKEN?.trim();
if (!bridgeToken) {
  console.warn(
    "[netpulse] NETPULSE_BRIDGE_TOKEN is not set: the engine bridge will refuse " +
      "browser-transport requests with 401. Start the shell, copy the logged " +
      "http_bridge.token value, and export it before running the dev server."
  );
}

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
        headers: {
          Connection: "close",
          ...(bridgeToken ? { "X-NetPulse-Token": bridgeToken } : {}),
        },
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
