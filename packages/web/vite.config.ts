import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Dev server proxies /api to the Fastify API so the browser stays same-origin
// (keeps session cookies simple). LAN access: run with --host.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" (not "autoUpdate") so a new deploy shows the update toast
      // instead of silently swapping the running app out from under an open
      // session — see UpdatePrompt.tsx.
      registerType: "prompt",
      // We register the service worker ourselves via the virtual/react hook
      // in UpdatePrompt.tsx (so the update toast has something to hook into)
      // instead of the plugin's own injected boilerplate script.
      injectRegister: null,
      // Precache only the built app shell (JS/CSS/HTML/icons) — never
      // /api/* responses. This is a live finance app backed by Postgres;
      // caching transaction data client-side and reconciling it later is a
      // correctness/security problem this app doesn't take on.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: "Panditas Wallet",
        short_name: "Panditas Wallet",
        description: "Family finance tracker",
        start_url: "/",
        display: "standalone",
        background_color: "#faf9f7",
        theme_color: "#4338ca",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
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
