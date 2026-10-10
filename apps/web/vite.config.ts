// The web app's Vite configuration (§8.1). F-22: the development server proxies the API on the
// same origin. Later S-11a steps add F-207's pseudo-locales and F-221's version.json.
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/health": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
});
