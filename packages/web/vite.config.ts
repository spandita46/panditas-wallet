import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev server proxies /api to the Fastify API so the browser stays same-origin
// (keeps session cookies simple). LAN access: run with --host.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
