import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, Vite proxies API and WebSocket traffic to the Java server so the
// browser only ever talks to one origin (no CORS setup needed).
const server = process.env.FORGE_SERVER ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
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
