// Hash router: #/path?query. Hash routing needs no server config for deep links, and magic-link
// sign-in (?code=… before the #) doesn't disturb it.
import { useEffect, useSyncExternalStore } from "react";

export interface Route {
  path: string;
  query: URLSearchParams;
}

let leaveGuard: (() => boolean) | null = null;
let currentHash = location.hash;
const listeners = new Set<() => void>();

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(qs ?? "") };
}

let snapshot = parse(currentHash);
function emit() {
  snapshot = parse(currentHash);
  listeners.forEach((l) => l());
}

window.addEventListener("hashchange", () => {
  if (location.hash === currentHash) return;
  if (leaveGuard && !leaveGuard()) {
    history.replaceState(null, "", currentHash || "#/"); // stay put
    return;
  }
  currentHash = location.hash;
  window.scrollTo(0, 0);
  emit();
});
window.addEventListener("beforeunload", (e) => {
  if (leaveGuard && !leaveGuard()) e.preventDefault();
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot,
  );
}

export function navigate(path: string, replace = false) {
  if (replace) {
    history.replaceState(null, "", "#" + path);
    currentHash = location.hash;
    emit();
  } else {
    location.hash = "#" + path;
  }
}

/** Changes the URL without re-rendering the page (e.g. a new deck that just got its id). */
export function replaceQuietly(path: string) {
  history.replaceState(null, "", "#" + path);
  currentHash = location.hash;
}

/** While mounted and `guard` returns false, leaving the page asks for confirmation. */
export function useLeaveGuard(guard: () => boolean) {
  useEffect(() => {
    leaveGuard = guard;
    return () => {
      if (leaveGuard === guard) leaveGuard = null;
    };
  }, [guard]);
}

/** Matches `/decks/:id` style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  const m = re.exec(path);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}
