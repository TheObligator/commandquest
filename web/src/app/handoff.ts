// Email sign-in links (convex/signinHandoff.ts). The browser that asks for a link remembers a
// random `pair` id and puts it in the link (`/?pair=…&email=…&code=…`). Opened in that browser,
// the link signs it in. Opened anywhere else, it hands its code back to that browser, which signs
// itself in (and if that page is gone, the link signs in where it was opened). The email also has
// the code to type into the asking page instead.

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
  const p = { pair, email: normalizeEmail(email), at: Date.now() };
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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A typed sign-in code ("abcd efgh", "ABCD-EFGH") as the server stores it: ABCDEFGH. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface OpenedLink {
  pair: string;
  email: string;
  code: string;
  /** This browser asked for it. */
  here: boolean;
}

/** The sign-in link this page was opened from, read once at load (before the URL is tidied). */
export const openedLink: OpenedLink | null = (() => {
  const q = new URLSearchParams(location.search);
  const pair = q.get("pair");
  const email = q.get("email");
  const code = q.get("code");
  return pair && email && code ? { pair, email, code, here: pending()?.pair === pair } : null;
})();

/**
 * Drops `pair` from the address bar, and `code` too with `withCode` (leave it when Convex Auth
 * still has to read it: it does so after the app's own first effects).
 */
export function tidyUrl(withCode = false) {
  const url = new URL(location.href);
  if (!url.searchParams.has("pair") && !(withCode && url.searchParams.has("code"))) return;
  url.searchParams.delete("pair");
  url.searchParams.delete("email");
  if (withCode) url.searchParams.delete("code");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}
