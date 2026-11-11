/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_CONVEX_SITE_URL: string;
  /** Game server origin, e.g. https://game.commandquest.app. Unset: same origin (dev proxy). */
  readonly VITE_GAME_SERVER?: string;
}

/** This build's id (vite.config.ts), matching the `build` field of the `/version.json` it ships with. */
declare const __BUILD_ID__: string;
