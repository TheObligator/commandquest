import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { updateCardCategories } from "./scripts/cardcategories";
import { updateCardData } from "./scripts/carddata";
import { updateCardNames } from "./scripts/cardnames";
import { searchFiles } from "./scripts/searchfiles";

// Each build gets an id, compiled into the bundle and written to /version.json, so an open tab can
// tell when the site has been redeployed (src/app/UpdateNotice.tsx).
const buildId = `${Date.now().toString(36)}-${(process.env.GITHUB_SHA ?? "local").slice(0, 12)}`;

function versionFile(): Plugin {
  return {
    name: "version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: buildId }) + "\n" });
    },
  };
}

/** robots.txt, sitemap.xml and index.html's robots/canonical tags, per site (scripts/searchfiles.ts). */
function searchEngines(): Plugin {
  let files = searchFiles("development");
  return {
    name: "search-engines",
    configResolved(config) {
      files = searchFiles(config.mode);
    },
    transformIndexHtml(html) {
      return html.replace("</head>", `    ${files.head}\n  </head>`);
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: files.robots });
      if (files.sitemap) this.emitFile({ type: "asset", fileName: "sitemap.xml", source: files.sitemap });
    },
  };
}

/**
 * The card names and categories for the editor, and the card data for lookups by name: there before a
 * build, and brought up to date as the dev server starts.
 */
function cardData(): Plugin {
  let dev = false;
  return {
    name: "card-data",
    configResolved(config) {
      dev = config.command === "serve";
    },
    async buildStart() {
      const updated = Promise.all([updateCardNames(), updateCardCategories(), updateCardData()]);
      if (!dev) await updated;
    },
  };
}

// In dev, Vite proxies API and WebSocket traffic to the Java server so the
// browser only ever talks to one origin (no CORS setup needed).
const server = process.env.FORGE_SERVER ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), versionFile(), cardData(), searchEngines()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  server: {
    // IPv4 loopback explicitly: Node resolves "localhost" to ::1 on macOS, but
    // `tailscale serve` forwards to 127.0.0.1. Still not reachable from the network.
    host: "127.0.0.1",
    port: 5173,
    // Accept requests forwarded by `tailscale serve` (MagicDNS names end in .ts.net),
    // so the dev server can be opened from other devices on the tailnet.
    allowedHosts: [".ts.net"],
    proxy: {
      "/health": server,
      "/ws": { target: server, ws: true },
    },
  },
});
