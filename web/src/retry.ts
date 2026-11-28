// Trying again by itself: how long to wait before attempt `n` (0 = the first retry), backing off
// from a couple of seconds to once a minute. Pure, so `npm test` covers it.

const STEPS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export function retryDelay(n: number): number {
  return STEPS_MS[Math.min(Math.max(0, n), STEPS_MS.length - 1)];
}

/**
 * The address to fetch on attempt `n`: the same picture, but past attempts' failures can't be
 * served again from a cache (a CDN or the browser can keep an error for a while).
 */
export function retryUrl(src: string, n: number): string {
  if (n <= 0 || !/^https?:/.test(src)) return src;
  return `${src}${src.includes("?") ? "&" : "?"}retry=${n}`;
}
