// localStorage holds a few MB per site (about 5.2 million characters in Chrome), shared by the
// signed-in session and our card caches. If the caches ever fill it, saving a session fails and
// sign-in breaks, so anything that must be saved can throw the caches out and try again.

/** Keys of caches that are safe to drop: they refill from Scryfall as needed. */
export const CACHE_PREFIXES = ["cq.scryfall.", "cq.cardtags."];

/** Sets `key`, dropping our caches first if storage is full. Throws if it still doesn't fit. */
export function setItemMakingRoom(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
    return;
  } catch {
    // Probably over quota: make room below.
  }
  for (let i = storage.length - 1; i >= 0; i--) {
    const k = storage.key(i);
    if (k && CACHE_PREFIXES.some((p) => k.startsWith(p))) storage.removeItem(k);
  }
  storage.setItem(key, value);
}

/** `items` (newest first) as JSON, keeping only as many as fit in `maxChars`. */
export function capJson(items: readonly unknown[], maxChars: number): string {
  let n = items.length;
  let json = JSON.stringify(items);
  while (json.length > maxChars && n > 0) {
    n = Math.min(n - 1, Math.floor((n * maxChars) / json.length));
    json = JSON.stringify(items.slice(0, n));
  }
  return json;
}
