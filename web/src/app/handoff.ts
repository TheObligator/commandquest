// Email sign-in links that open on a different device (convex/signinHandoff.ts). The device that
// asks for a link remembers a random `pair` id and puts it in the link (`/?pair=…&code=…`). A
// link opened in that same browser signs in as usual; anywhere else, the page asks where to sign
// in, and can hand the code back to the waiting device.

const KEY = "cq.signin.pending";
const MAX_AGE_MS = 60 * 60 * 1000;

export interface Pending {
  pair: string;
  email: string;
  at: number;
}

/** Starts waiting for a link sent to `email`: the new pair id to put in it. */
export function newPending(email: string): Pending {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const pair = Array.from(bytes, (b) => abc[b % abc.length]).join("");
  const p = { pair, email, at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: this tab still waits while it's open.
  }
  return p;
}

/** The link this browser is waiting for, if it asked for one in the last hour. */
export function pending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as Pending | null;
    return p && typeof p.pair === "string" && Date.now() - p.at < MAX_AGE_MS ? p : null;
  } catch {
    return null;
  }
}

export function clearPending() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** The sign-in link this page was opened from, read once at load (before the URL is tidied). */
export const openedLink: { pair: string; code: string } | null = (() => {
  const q = new URLSearchParams(location.search);
  const pair = q.get("pair");
  const code = q.get("code");
  return pair && code ? { pair, code } : null;
})();

/** Opened from a link another browser asked for: ask where to sign in instead of signing in here. */
export const linkFromElsewhere = !!openedLink && pending()?.pair !== openedLink.pair;

/**
 * Drops `pair` from the address bar, and `code` too with `withCode` (leave it when Convex Auth
 * still has to read it: it does so after the app's own first effects).
 */
export function tidyUrl(withCode = false) {
  const url = new URL(location.href);
  if (!url.searchParams.has("pair") && !(withCode && url.searchParams.has("code"))) return;
  url.searchParams.delete("pair");
  if (withCode) url.searchParams.delete("code");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}
