import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev server proxies /api to the Fastify API so the browser stays same-origin
// (keeps session cookies simple). LAN access: run with --host.
export default defineConfig({
  plugins: [react()],
  // The monorepo's single .env lives at the repo root, not this package's dir.
  envDir: "../..",
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
