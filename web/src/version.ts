/**
 * Spotting a new deploy. Each build stamps its id into the bundle (`__BUILD_ID__`) and writes the
 * same id to `/version.json` (vite.config.ts). The open page polls that file: a different id means
 * the site was redeployed since this tab loaded.
 */

/** Reads the build id out of a `/version.json` body. Null when it isn't one (e.g. an error page). */
export function parseBuildId(body: string): string | null {
  try {
    const data: unknown = JSON.parse(body);
    if (data && typeof data === "object" && "build" in data) {
      const build = (data as { build: unknown }).build;
      if (typeof build === "string" && build) return build;
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/** True only when the server reports a real build id that differs from the running one. */
export function isNewBuild(running: string, body: string): boolean {
  const served = parseBuildId(body);
  return served !== null && served !== running;
}
