// Which of a deck's cards Scryfall Tagger puts in each "at a glance" category (src/brackets.ts).
//
// Card objects don't carry Tagger's tags, so we ask Scryfall's search: for each category, one
// query like `otag:tutor (!"Sol Ring" or !"Demonic Tutor" or …)` per batch of names. Scryfall cuts
// queries off at about 1,000 characters, so the names go in batches that fit. Answers (yes and no)
// are kept per card name in localStorage for a week, so a deck only asks about cards it hasn't
// seen; new cards cost one query per category.

import { GLANCE, batchQueries } from "./brackets";
import { matchingNames } from "./scryfall";

const STORE = "cq.cardtags.v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STORED_NAMES = 4000;

/** The tag categories looked up on Scryfall (the rest are worked out from card data). */
export const TAG_CATEGORIES = GLANCE.filter((c) => c.query);

/** category → lower-cased name → [in it, when we asked] */
type Store = Record<string, Record<string, [boolean, number]>>;

let store: Store | null = null;

function load(): Store {
  if (store) return store;
  store = {};
  try {
    const raw = localStorage.getItem(STORE);
    const now = Date.now();
    for (const [cat, names] of Object.entries(raw ? (JSON.parse(raw) as Store) : {})) {
      store[cat] = Object.fromEntries(Object.entries(names).filter(([, [, at]]) => now - at < TTL_MS));
    }
  } catch {
    // unreadable or blocked: ask Scryfall again
  }
  return store;
}

function save() {
  const s = load();
  try {
    // Keep the most recent answers per category if it grows large.
    const trimmed: Store = {};
    for (const [cat, names] of Object.entries(s)) {
      trimmed[cat] = Object.fromEntries(Object.entries(names).sort((a, z) => z[1][1] - a[1][1]).slice(0, MAX_STORED_NAMES));
    }
    localStorage.setItem(STORE, JSON.stringify(trimmed));
  } catch {
    // full or blocked: memory only
  }
}

/** What's known so far: category → lower-cased names Tagger puts in it. */
export function knownTags(names: string[]): Map<string, Set<string>> {
  const s = load();
  const tagged = new Map<string, Set<string>>();
  for (const cat of TAG_CATEGORIES) {
    const known = s[cat.id] ?? {};
    tagged.set(cat.id, new Set(names.map((n) => n.toLowerCase()).filter((n) => known[n]?.[0])));
  }
  return tagged;
}

/** The Scryfall queries still needed for these names. */
export function pendingQueries(names: string[]): { category: string; query: string; names: string[] }[] {
  const s = load();
  return TAG_CATEGORIES.flatMap((cat) => {
    const known = s[cat.id] ?? {};
    const unknown = [...new Set(names.map((n) => n.toLowerCase()))].filter((n) => !known[n]);
    const original = new Map(names.map((n) => [n.toLowerCase(), n]));
    return batchQueries(cat.query!, unknown.map((n) => original.get(n)!)).map((b) => ({ category: cat.id, ...b }));
  });
}

/**
 * Asks Scryfall about every name not known yet, calling `onProgress(done, total)` after each
 * query. Stops early (without throwing) when `cancelled()` turns true.
 */
export async function lookUpTags(names: string[], onProgress: (done: number, total: number) => void, cancelled: () => boolean): Promise<void> {
  const queries = pendingQueries(names);
  const s = load();
  let done = 0;
  for (const q of queries) {
    if (cancelled()) return;
    const hits = new Set((await matchingNames(q.query)).map((n) => n.toLowerCase()));
    const at = Date.now();
    const cat = (s[q.category] ??= {});
    for (const n of q.names) cat[n.toLowerCase()] = [hits.has(n.toLowerCase()), at];
    save();
    onProgress(++done, queries.length);
  }
}
