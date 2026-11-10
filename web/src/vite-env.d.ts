/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_CONVEX_SITE_URL: string;
  /** Game server origin, e.g. https://game.commandquest.app. Unset: same origin (dev proxy). */
  readonly VITE_GAME_SERVER?: string;
}
