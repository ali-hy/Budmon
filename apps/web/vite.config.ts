// The web app's Vite configuration (§8.1): F-22's development server, F-207's pseudo-locales and
// F-221's build number.
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { writePseudoLocales } from "./scripts/pseudoLocales.js";

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));

/** F-207: writes src/i18n/generated/{en-XA,ar-XB}.json when VITE_PSEUDO_LOCALES=1. */
function budmonPseudoLocales(enabled: boolean): Plugin {
  const enCatalogPath = path.join(WEB_DIR, "src/i18n/messages/en.json");
  const write = () => {
    writePseudoLocales({ enCatalogPath, outDir: path.join(WEB_DIR, "src/i18n/generated") });
  };
  return {
    name: "budmon-pseudo-locales",
    buildStart() {
      if (enabled) write();
    },
    // In dev, an edited English catalog regenerates the pseudo catalogs.
    handleHotUpdate(ctx) {
      if (enabled && path.resolve(ctx.file) === enCatalogPath) write();
    },
  };
}

/** F-221: VITE_BUILD_NUMBER from BUDMON_BUILD_NUMBER (default 0), and dist/version.json. */
function budmonVersion(): Plugin {
  const raw = process.env["BUDMON_BUILD_NUMBER"] ?? "0";
  if (!/^\d{1,9}$/.test(raw)) throw new Error("BUDMON_BUILD_NUMBER must be a non-negative integer");
  const buildNumber = Number.parseInt(raw, 10);
  return {
    name: "budmon-version",
    config: () => ({
      define: { "import.meta.env.VITE_BUILD_NUMBER": JSON.stringify(String(buildNumber)) },
    }),
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildNumber }),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, WEB_DIR, "VITE_");
  const pseudo = (process.env["VITE_PSEUDO_LOCALES"] ?? env["VITE_PSEUDO_LOCALES"]) === "1";
  return {
    plugins: [solid(), tailwindcss(), budmonPseudoLocales(pseudo), budmonVersion()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        // F-22: exactly /api and /health and their subpaths (a bare prefix would match /apifoo).
        "^/api(/|$)": { target: "http://127.0.0.1:3000", changeOrigin: false },
        "^/health(/|$)": { target: "http://127.0.0.1:3000", changeOrigin: false },
      },
    },
  };
});
