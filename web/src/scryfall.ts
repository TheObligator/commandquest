// Scryfall API client (called straight from the browser; Scryfall allows CORS).
//
// Follows https://scryfall.com/docs/api and https://scryfall.com/docs/api/rate-limits:
//  - Rate limits: /cards/search, /cards/named, /cards/random and /cards/collection allow 2 requests
//    per second; everything else 10 per second. Every request goes through one queue, shared by all
//    of the site's tabs (src/scryfallQueue.ts), that spaces their starts by the right gap. Images and
//    symbols come from *.scryfall.io, which has no rate limit, so they never go through the API.
//  - On HTTP 429, or a request that can't get through at all (a block can look like that), we pause
//    all requests in every tab, for 30 seconds and longer if it happens again, then try that one again.
//  - The browser's own User-Agent is left intact and an Accept header is sent.
//  - Card data is cached in localStorage for 7 days (Scryfall asks for at least 24h).
//  - Cards looked up by name come from our own copy of Scryfall's bulk data when the site has one
//    (src/carddata.ts), so most of them need no API request at all.

import { capJson } from "./app/storageRoom";
import { CARD_DATA_VERSION, decode, isTokenLike, lookupNames, shardOf, trimCard, type CardDataManifest, type StoredCard } from "./carddata";
import { createQueue } from "./scryfallQueue";
import type { DeckCard } from "../convex/model/deckRules";
import { probes, rank } from "./didyoumean";
import { choosePrinting, type Print, type PrintingPref } from "./printings";
import { restrictToNames } from "./searchquery";

const API = "https://api.scryfall.com";
const SLOW = /^\/cards\/(search|named|random|collection)\b/;

export interface ImageUris {
  small: string;
  normal: string;
  large: string;
  png?: string;
  art_crop: string;
  border_crop?: string;
}

export interface CardFace {
  name: string;
  oracle_id?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  artist?: string;
  color_indicator?: string[];
  image_uris?: ImageUris;
}

export interface RelatedPart {
  id: string;
  component: string;
  name: string;
  type_line?: string;
}

export interface ScryCard {
  id: string;
  /** On the Commander Game Changers list (Commander Brackets). */
  game_changer?: boolean;
  /** Colors of mana the card can make (W, U, B, R, G, C). */
  produced_mana?: string[];
  name: string;
  /** The same for every printing of a card. On reversible cards it's on the faces. */
  oracle_id?: string;
  layout: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  color_identity: string[];
  color_indicator?: string[];
  colors?: string[];
  /** Related cards; we keep only the tokens this printing makes (`component: "token"`). */
  all_parts?: RelatedPart[];
  keywords?: string[];
  reserved?: boolean;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  artist?: string;
  /** "nonfoil", "foil", "etched": a print with no "nonfoil" exists only as a foil variant. */
  finishes?: string[];
  illustration_id?: string;
  released_at?: string;
  scryfall_uri: string;
  legalities: Record<string, string>;
  image_uris?: ImageUris;
  card_faces?: CardFace[];
}

export interface SearchPage {
  cards: ScryCard[];
  total: number;
  nextPage?: string;
}

// ---- Request queue ------------------------------------------------------------

// Requests are spaced by when they start, not chained on finishing: Scryfall limits how many
// arrive per second, so a slow response needn't hold up the next request.
const queue = createQueue({
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  storage: typeof localStorage === "undefined" ? undefined : localStorage,
  lock: typeof navigator !== "undefined" && navigator.locks ? (fn) => navigator.locks.request("cq-scryfall-queue", () => fn()) : undefined,
});

class ScryfallError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** How long Scryfall has us waiting before the next request (after a 429), in ms; 0 when it doesn't. */
export const pauseLeft = () => queue.pauseLeft();

/** A user-facing message for a failed request: Scryfall's own words, or that it couldn't be reached at all. */
export function lookupError(e: unknown): string {
  return e instanceof ScryfallError ? e.message : "Couldn't reach Scryfall.";
}

const MAX_429_RETRIES = 2;

async function getJson<T>(url: string, init?: RequestInit, retries = MAX_429_RETRIES): Promise<T> {
  const slow = SLOW.test(new URL(url).pathname);
  return queue.run(slow, async () => {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // Offline, or blocked (a reply without CORS headers looks the same): pause like a 429.
      await queue.strike();
      if (retries > 0) return getJson<T>(url, init, retries - 1);
      throw e;
    }
    if (res.status === 429) {
      await queue.strike();
      // Back in the queue, behind the pause (the page says how long: src/components/Spinner.tsx).
      if (retries > 0) return getJson<T>(url, init, retries - 1);
      throw new ScryfallError(429, "Scryfall says we're sending too many requests. Try again in a few minutes.");
    }
    queue.ok();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ScryfallError(res.status, (data as { details?: string }).details ?? `Scryfall error ${res.status}`);
    return data as T;
  });
}

// ---- Cache (memory + localStorage, 7 days) ---------------------------------------

// Bump the version when `trim` keeps new fields, so old entries without them are dropped.
const STORE_KEY = "cq.scryfall.cards.v6"; // v6 keeps oracle_id
// Card data rarely changes (a ban updates legality), and a deck opened again within the week then
// needs no lookups. The size caps, not the age, keep this well within localStorage's limit (about
// 5.2 million characters in Chrome), which the signed-in session shares: a full one broke sign-in.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STORED = 1500;
/** Most characters the card cache may take (a card is about 2,600). */
export const MAX_STORED_CHARS = 1_500_000;

const byId = new Map<string, ScryCard>();
const byName = new Map<string, ScryCard>();
const storedAt = new Map<string, number>();

export { isTokenLike };

function index(c: ScryCard) {
  byId.set(c.id, c);
  if (isTokenLike(c)) return;
  for (const n of lookupNames(c)) byName.set(n, c);
}

function loadStore() {
  try {
    localStorage.removeItem("cq.scryfall.cards.v1");
    localStorage.removeItem("cq.scryfall.cards.v2");
    localStorage.removeItem("cq.scryfall.cards.v3");
    localStorage.removeItem("cq.scryfall.cards.v4");
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const now = Date.now();
    for (const [at, card] of JSON.parse(raw) as [number, ScryCard][]) {
      if (now - at < TTL_MS) {
        index(card);
        storedAt.set(card.id, at);
      }
    }
    if (raw.length > MAX_STORED_CHARS) saveStore(); // saved before the cap: shrink it now
  } catch {
    // Storage blocked or corrupt: just use the network.
  }
}

let saveTimer: number | undefined;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const entries = [...storedAt.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_STORED)
      .map(([id, at]) => [at, byId.get(id)] as const)
      .filter(([, c]) => c);
    try {
      localStorage.setItem(STORE_KEY, capJson(entries, MAX_STORED_CHARS));
    } catch {
      // Over quota or blocked: the memory cache still works for this visit.
    }
  }, 500);
}

function remember(c: ScryCard) {
  const t = trimCard(c);
  index(t);
  storedAt.set(t.id, Date.now());
  saveStore();
  return t;
}

loadStore();

// ---- Our own card data (src/carddata.ts) ------------------------------------------------
// Cards by name, from the site's copy of Scryfall's bulk data: no API request, and no rate limit.
// Without it (a dev server that couldn't download it, a tab left open across a deploy), lookups
// go to Scryfall's API as before. Its cards aren't kept in localStorage: the browser caches them.

const CARD_DATA = "/card-data";
/**
 * Older card data than this isn't used: a site that hasn't been deployed for a while would show old
 * legalities (bans), so it asks the API instead, as Scryfall's own data is a week old at most here.
 */
const CARD_DATA_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
/** How long to wait before asking for the manifest again after it couldn't be had. */
const MANIFEST_RETRY_MS = 5 * 60_000;
let manifest: Promise<CardDataManifest | undefined> | undefined;
let manifestMissedAt: number | undefined;
const shardLoads = new Map<string, Promise<StoredCard[]>>();

function cardData(): Promise<CardDataManifest | undefined> {
  if (manifest && !(manifestMissedAt !== undefined && Date.now() - manifestMissedAt > MANIFEST_RETRY_MS)) return manifest;
  manifestMissedAt = undefined;
  manifest = fetch(`${CARD_DATA}.json`, { cache: "no-cache" })
    .then((res) => (res.ok ? (res.json() as Promise<CardDataManifest>) : undefined))
    .then((m) => (m?.version === CARD_DATA_VERSION && m.tag && Array.isArray(m.formats) && Date.now() - Date.parse(m.built) < CARD_DATA_MAX_AGE_MS ? m : undefined))
    .catch(() => undefined) // no data on this server (a dev server answers with index.html, which isn't JSON)
    .then((m) => {
      if (!m) manifestMissedAt = Date.now();
      return m;
    });
  return manifest;
}

function shard(m: CardDataManifest, name: string): Promise<StoredCard[]> {
  const key = `${m.tag}/${name}`;
  let hit = shardLoads.get(key);
  if (!hit) {
    hit = fetch(`${CARD_DATA}/${key}.json`).then((res) => {
      // Every shard of a build exists, so a missing one means the site was deployed since the
      // manifest came: ask for the new one next time.
      if (res.status === 404) manifest = undefined;
      if (!res.ok) throw new Error(`card data ${key}: HTTP ${res.status}`);
      return res.json() as Promise<StoredCard[]>;
    });
    hit.catch(() => shardLoads.delete(key)); // try again next time
    shardLoads.set(key, hit);
  }
  return hit;
}

/**
 * Looks these card names up in our own card data, keyed by lowercased name: only names it has, and
 * not ones already known. The cards are indexed like any other, so `cached()` finds them afterwards.
 */
async function fromCardData(names: string[]): Promise<Map<string, ScryCard>> {
  const found = new Map<string, ScryCard>();
  const want = new Set(names.map((n) => n.toLowerCase()).filter((n) => n && !byName.has(n)));
  if (!want.size) return found;
  const m = await cardData();
  if (!m) return found;
  const lists = await Promise.all([...new Set([...want].map(shardOf))].map((s) => shard(m, s).catch(() => [] as StoredCard[])));
  for (const list of lists) {
    for (const stored of list) {
      const keys = lookupNames(stored).filter((n) => want.has(n));
      if (!keys.length) continue;
      const card = decode(stored, m.formats);
      for (const k of keys) found.set(k, card);
      // A printing someone already has stays: this one only fills names nobody has.
      if (!byId.has(card.id)) byId.set(card.id, card);
      for (const k of lookupNames(card)) if (!byName.has(k)) byName.set(k, card);
    }
  }
  return found;
}

/** The card for a deck entry: its printing, else any printing by name. Never a token. */
export function cached(card: DeckCard): ScryCard | undefined {
  const hit = card.scryfallId ? byId.get(card.scryfallId) : undefined;
  return hit && !isTokenLike(hit) ? hit : byName.get(card.name.toLowerCase());
}

export function cachedById(id: string): ScryCard | undefined {
  return byId.get(id);
}

/** A cached printing by set and collector number. */
export function cachedPrinting(set: string, collectorNumber: string): ScryCard | undefined {
  const s = set.toLowerCase();
  for (const c of byId.values()) if (c.set === s && c.collector_number === collectorNumber) return c;
  return undefined;
}

/** A cached printing of this card from this set (any collector number). */
export function cachedInSet(name: string, set: string): ScryCard | undefined {
  const s = set.toLowerCase();
  const n = name.toLowerCase();
  for (const c of byId.values()) {
    if (c.set === s && (c.name.toLowerCase() === n || c.card_faces?.[0]?.name.toLowerCase() === n)) return c;
  }
  return undefined;
}

/** The cached card for exactly the printing a deck entry asks for (id, set + number, or set), else by name. */
export function cachedExact(card: DeckCard): ScryCard | undefined {
  const hit = exactPrinting(card);
  return hit && !isTokenLike(hit) ? hit : undefined;
}

/** True when a deck entry's printing is a token (an old bug): it needs its card again. */
export function printingIsToken(card: DeckCard): boolean {
  const hit = exactPrinting(card);
  return !!hit && isTokenLike(hit);
}

const withoutPrinting = (c: DeckCard): DeckCard => ({ ...c, scryfallId: undefined, set: undefined, collectorNumber: undefined });

function exactPrinting(card: DeckCard): ScryCard | undefined {
  if (card.scryfallId) return byId.get(card.scryfallId);
  if (card.set && card.collectorNumber) return cachedPrinting(card.set, card.collectorNumber);
  if (card.set) return cachedInSet(card.name, card.set);
  return byName.get(card.name.toLowerCase());
}

// ---- Endpoints ----------------------------------------------------------------

/** Full-text Scryfall search (supports Scryfall syntax like `t:dragon c:r`). */
export async function search(query: string, unique: "cards" | "prints" = "cards"): Promise<SearchPage> {
  const url = `${API}/cards/search?${new URLSearchParams({ q: query, unique, order: unique === "prints" ? "released" : "edhrec" })}`;
  return page(url);
}

/**
 * Every card name a search matches (all pages), without caching the cards: used for tag lookups
 * (src/cardtags.ts), whose results are other printings of cards the deck already has.
 * Double-faced cards give their full name and each face's name.
 */
export async function matchingNames(query: string): Promise<string[]> {
  const names: string[] = [];
  let url: string | undefined = `${API}/cards/search?${new URLSearchParams({ q: query, unique: "cards" })}`;
  while (url) {
    let data: { data: ScryCard[]; has_more: boolean; next_page?: string };
    try {
      data = await getJson(url);
    } catch (e) {
      if (e instanceof ScryfallError && e.status === 404) break; // "no cards found"
      throw e;
    }
    for (const c of data.data) names.push(c.name, ...(c.card_faces?.map((f) => f.name) ?? []));
    url = data.has_more ? data.next_page : undefined;
  }
  return names;
}

export async function nextPage(url: string): Promise<SearchPage> {
  return page(url);
}

const pageCache = new Map<string, SearchPage>();

async function page(url: string): Promise<SearchPage> {
  const hit = pageCache.get(url);
  if (hit) return hit;
  let result: SearchPage;
  try {
    const data = await getJson<{ data: ScryCard[]; total_cards: number; has_more: boolean; next_page?: string }>(url);
    // Art cards ("X // X", layout art_series) aren't cards you can play. Scryfall leaves them out of
    // searches, except ones with a color-identity filter (art cards have no colors, so they pass).
    const cards = data.data.filter((c) => c.layout !== "art_series");
    result = { cards: cards.map(remember), total: data.total_cards - (data.data.length - cards.length), nextPage: data.has_more ? data.next_page : undefined };
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) result = { cards: [], total: 0 }; // "no cards found"
    else throw e;
  }
  if (pageCache.size > 100) pageCache.clear();
  pageCache.set(url, result);
  return result;
}

const autocompleted = new Map<string, Promise<string[]>>();

/** Card names containing the text (Scryfall's autocomplete); remembered for the session. */
export function autocomplete(q: string): Promise<string[]> {
  const key = q.trim().toLowerCase();
  if (key.length < 2) return Promise.resolve([]);
  let hit = autocompleted.get(key);
  if (!hit) {
    hit = getJson<{ data: string[] }>(`${API}/cards/autocomplete?${new URLSearchParams({ q: key })}`).then((d) => d.data);
    hit.catch(() => autocompleted.delete(key)); // don't remember a failure
    if (autocompleted.size > 500) autocompleted.clear();
    autocompleted.set(key, hit);
  }
  return hit;
}

/**
 * Card names close to text that autocomplete found nothing for, closest first: Scryfall's fuzzy
 * name match first, then autocomplete on shortened forms of the text, ranked by spelling distance.
 */
export async function didYouMean(q: string): Promise<string[]> {
  let trouble: unknown;
  const none = (e: unknown) => {
    if (!(e instanceof ScryfallError && e.status === 404)) trouble = e; // 404: nothing that close
    return [] as string[];
  };
  const fuzzy = getJson<ScryCard>(`${API}/cards/named?${new URLSearchParams({ fuzzy: q })}`)
    .then((c) => [remember(c).name])
    .catch(none);
  const loose = probes(q).map((p) => autocomplete(p).catch(none));
  const [best, ...rest] = await Promise.all([fuzzy, ...loose]);
  // Found nothing because it couldn't ask, rather than because there's nothing.
  if (trouble && !best.length && !rest.flat().length) throw trouble;
  // Scryfall's own best guess leads even when it's spelled further off than our threshold allows.
  return [...new Set([...best, ...rank(q, rest.flat())])].slice(0, 5);
}

/** One card by its exact name (front-face names work too); cached. */
export async function named(name: string): Promise<ScryCard> {
  const hit = byName.get(name.toLowerCase()) ?? (await fromCardData([name])).get(name.toLowerCase());
  if (hit) return hit;
  return remember(await getJson<ScryCard>(`${API}/cards/named?${new URLSearchParams({ exact: name })}`));
}

/** One card by a loose name ("sol ring", "atraxa praetors voice"): Scryfall's best match; cached. */
export async function fuzzyNamed(name: string): Promise<ScryCard> {
  const hit = byName.get(name.toLowerCase()) ?? (await fromCardData([name])).get(name.toLowerCase());
  if (hit) return hit;
  return remember(await getJson<ScryCard>(`${API}/cards/named?${new URLSearchParams({ fuzzy: name })}`));
}

/** One printing by set code and collector number; cached. */
export async function printing(set: string, collectorNumber: string): Promise<ScryCard> {
  const hit = cachedPrinting(set, collectorNumber);
  if (hit) return hit;
  return remember(await getJson<ScryCard>(`${API}/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(collectorNumber)}`));
}

/** One printing by Scryfall id; cached. */
export async function byScryfallId(id: string): Promise<ScryCard> {
  const hit = byId.get(id);
  if (hit) return hit;
  return remember(await getJson<ScryCard>(`${API}/cards/${encodeURIComponent(id)}`));
}

export interface Ruling {
  source: string;
  published_at: string;
  comment: string;
}

const rulingsByName = new Map<string, Promise<Ruling[]>>();

/** A card's official rulings (Gatherer and Scryfall's notes), oldest first; cached for the session. */
export function rulings(name: string): Promise<Ruling[]> {
  const key = name.toLowerCase();
  let hit = rulingsByName.get(key);
  if (!hit) {
    hit = (async () => {
      const card = byName.get(key) ?? (await named(name));
      const data = await getJson<{ data: Ruling[] }>(`${API}/cards/${card.id}/rulings`);
      return data.data;
    })();
    hit.catch(() => rulingsByName.delete(key)); // try again next time
    rulingsByName.set(key, hit);
  }
  return hit;
}

/** All printings of a card, newest first. */
export async function printings(name: string): Promise<ScryCard[]> {
  const res = await search(`!"${name.replace(/"/g, "")}"`, "prints");
  return res.cards;
}

/**
 * The printing `pref` picks for each of these card names (Forge names), keyed by lowercased name.
 * Names Scryfall doesn't know are left out. "default" is Scryfall's own pick for the name.
 * Only the chosen printings are cached; a batch of names costs one search per ~40 names (more for
 * cards with many printings).
 */
export async function preferredPrintings(names: string[], pref: PrintingPref, onProgress?: (done: number, total: number) => void): Promise<Map<string, ScryCard>> {
  const want = [...new Set(names.map((n) => n.toLowerCase()))];
  const out = new Map<string, ScryCard>();
  if (!want.length) return out;
  const wanted = new Set(want);
  const keys = (c: ScryCard) => [c.name, deckName(c), c.name.split(" // ")[0]].map((n) => n.toLowerCase()).filter((n) => wanted.has(n));
  if (pref === "default") {
    // Our card data has Scryfall's own pick for each name; the API only for names it doesn't have.
    const local = await fromCardData(want);
    for (const [k, c] of local) out.set(k, c);
    const rest = want.filter((n) => !local.has(n));
    for (let i = 0; i < rest.length; i += 75) {
      onProgress?.(i, rest.length);
      const data = await getJson<{ data: ScryCard[] }>(`${API}/cards/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: rest.slice(i, i + 75).map((name) => ({ name })) }),
      });
      for (const c of data.data) for (const k of keys(c)) out.set(k, remember(c));
    }
    return out;
  }
  const prints = new Map<string, (ScryCard & Print)[]>();
  const queries = restrictToNames("game:paper", want);
  for (let i = 0; i < queries.length; i++) {
    onProgress?.(i, queries.length);
    let url: string | undefined = `${API}/cards/search?${new URLSearchParams({ q: queries[i], unique: "prints", order: "released" })}`;
    while (url) {
      let data: { data: (ScryCard & Print)[]; has_more: boolean; next_page?: string };
      try {
        data = await getJson(url);
      } catch (e) {
        if (e instanceof ScryfallError && e.status === 404) break; // none of these names
        throw e;
      }
      for (const c of data.data) for (const k of keys(c)) prints.set(k, [...(prints.get(k) ?? []), c]);
      url = data.has_more ? data.next_page : undefined;
    }
  }
  for (const [k, ps] of prints) {
    const pick = choosePrinting(ps, pref);
    if (pick) out.set(k, remember(pick));
  }
  return out;
}

type Identifier = { id: string } | { set: string; collector_number: string } | { name: string; set?: string };

function identifier(c: DeckCard): Identifier {
  if (c.scryfallId) return { id: c.scryfallId };
  if (c.set && c.collectorNumber) return { set: c.set.toLowerCase(), collector_number: c.collectorNumber };
  // Scryfall's collection lookup doesn't know split cards' "A // B" names, only "A".
  const name = c.name.split(" // ")[0];
  if (c.set) return { name, set: c.set.toLowerCase() };
  return { name };
}

/**
 * Looks up card data for a decklist (75 cards per request, Scryfall's limit). Returns the names of
 * cards Scryfall didn't recognise. Results are cached, so call `cachedExact()` (falling back to
 * `cached()` for printings Scryfall didn't know) afterwards.
 */
export async function resolve(cards: DeckCard[]): Promise<string[]> {
  const unique = new Map<string, DeckCard>();
  // A named entry whose printing is a token wants the card: ask by name. (Token lookups by id, with
  // no name, are the token list's and stay as they are.)
  const asked = cards.map((c) => (c.name && printingIsToken(c) ? withoutPrinting(c) : c));
  // Cards asked for by name alone come from our own card data when it has them.
  const byNameAlone = asked.filter((c) => c.name && !c.scryfallId && !c.set && !c.collectorNumber);
  if (byNameAlone.length) await fromCardData(byNameAlone.map((c) => c.name));
  for (const c of asked) if (!exactPrinting(c)) unique.set(JSON.stringify(identifier(c)), c);
  // Cards another caller is already looking up (the editor and its token list open together) share
  // that request instead of sending a second one.
  const waits = new Set<Promise<string[]>>();
  const mine: [string, DeckCard][] = [];
  for (const [k, c] of unique) {
    const p = inFlight.get(k);
    if (p) waits.add(p);
    else mine.push([k, c]);
  }
  if (mine.length) {
    const p = lookUp(mine.map(([, c]) => c));
    for (const [k] of mine) inFlight.set(k, p);
    p.finally(() => mine.forEach(([k]) => inFlight.get(k) === p && inFlight.delete(k))).catch(() => undefined);
    waits.add(p);
  }
  const names = new Set(cards.map((c) => c.name));
  return [...new Set((await Promise.all(waits)).flat().filter((n) => names.has(n)))];
}

const inFlight = new Map<string, Promise<string[]>>();

// ---- Cards shown by name ---------------------------------------------------------
// The game table shows a card's image by its name. `wantCard` looks up any name nobody has asked
// about yet (a tick's worth together), and `cardLookup` says how that's going, so a card that's on
// its way looks different from one that isn't coming.

/** `missing`: Scryfall doesn't have it. `failed`: Scryfall couldn't be asked. */
export type CardLookup = "loading" | "found" | "missing" | "failed";

const noCard = new Map<string, "missing" | "failed">();
const watchers = new Set<() => void>();
let lookups = 0;
let wanted = new Set<string>();
const AUTO_RETRY_MS = 15_000;
const MAX_AUTO_RETRIES = 4;
let autoRetries = 0;

export const onLookup = (fn: () => void) => {
  watchers.add(fn);
  return () => void watchers.delete(fn);
};
/** Changes whenever a lookup by name finishes. */
export const lookupVersion = () => lookups;

export function cardLookup(name: string): CardLookup {
  if (cached({ name, quantity: 1, board: "main" })) return "found";
  return noCard.get(name.toLowerCase()) ?? "loading";
}

/** Looks this card up unless that's been done (or, with `again`, even if it failed before). */
export function wantCard(name: string, again = false) {
  const key = name.toLowerCase();
  if (again && noCard.delete(key)) changed();
  if (cardLookup(name) !== "loading" || wanted.has(name)) return;
  wanted.add(name);
  if (wanted.size > 1) return;
  setTimeout(() => {
    const names = [...wanted];
    wanted = new Set();
    const done = (state: "missing" | "failed") => {
      const without = names.filter((n) => !cached({ name: n, quantity: 1, board: "main" }));
      for (const n of without) noCard.set(n.toLowerCase(), state);
      changed();
      // Couldn't ask: a few more tries by themselves. (The card also offers one.)
      if (state === "failed" && without.length && autoRetries < MAX_AUTO_RETRIES) {
        autoRetries++;
        setTimeout(() => without.forEach((n) => noCard.get(n.toLowerCase()) === "failed" && wantCard(n, true)), AUTO_RETRY_MS);
      } else if (state === "missing") autoRetries = 0;
    };
    resolve(names.map((n) => ({ name: n, quantity: 1, board: "main" as const }))).then(() => done("missing"), () => done("failed"));
  });
}

function changed() {
  lookups++;
  for (const fn of [...watchers]) fn();
}

async function lookUp(list: DeckCard[]): Promise<string[]> {
  const missing: string[] = [];
  const retry: DeckCard[] = [];
  for (let i = 0; i < list.length; i += 75) {
    const batch = list.slice(i, i + 75);
    const data = await getJson<{ data: ScryCard[]; not_found: Identifier[] }>(`${API}/cards/collection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map(identifier) }),
    });
    data.data.forEach(remember);
    for (const nf of data.not_found) {
      const card = batch.find((c) => JSON.stringify(identifier(c)) === JSON.stringify(nf));
      // A stale printing: try again by name (batched, below).
      if (card && ("set" in nf || "id" in nf)) retry.push({ ...card, scryfallId: undefined, set: undefined, collectorNumber: undefined });
      else missing.push(card?.name ?? ("name" in nf ? nf.name : "?"));
    }
  }
  // A printing that turned out to be a token: look the card up by name instead.
  for (const c of list) if (c.name && printingIsToken(c) && !byName.has(c.name.toLowerCase())) retry.push(withoutPrinting(c));
  if (retry.length) missing.push(...(await resolve(retry)));
  return missing;
}

/** Card data for these Scryfall ids (from cache when possible). */
export async function cardsById(ids: string[]): Promise<void> {
  await resolve(ids.map((id) => ({ name: "", quantity: 1, board: "main", scryfallId: id })));
}

// ---- Helpers --------------------------------------------------------------------

/**
 * The name Forge uses for a card: the front face for double-faced, flip, adventure and similar
 * cards, the full "A // B" name for split cards.
 */
export function deckName(c: ScryCard): string {
  const front = ["transform", "modal_dfc", "flip", "adventure", "meld", "reversible_card", "prepare"];
  if (front.includes(c.layout) && c.card_faces?.[0]) return c.card_faces[0].name;
  return c.name;
}

/** Image of one face (0 = front). Single-image layouts (split, flip, adventure) have one image for all faces. */
export function imageUrl(c: ScryCard, size: keyof ImageUris = "normal", face = 0): string | undefined {
  return c.card_faces?.[face]?.image_uris?.[size] ?? c.image_uris?.[size] ?? c.card_faces?.[0]?.image_uris?.[size];
}

/** True when the card has a separate image for its back face. */
/**
 * Whether this face is printed sideways, so it reads turned a quarter clockwise: a battle's front,
 * split cards and Rooms (one image for both halves). Not Aftermath, whose top half reads upright.
 */
export function isSideways(c: ScryCard, face = 0): boolean {
  if (c.layout === "split") return !c.keywords?.includes("Aftermath");
  return face === 0 && /\bBattle\b/.test(c.card_faces?.[0]?.type_line ?? c.type_line ?? "");
}

export function hasBackImage(c: ScryCard): boolean {
  return Boolean(c.card_faces?.[1]?.image_uris);
}

/** The artist credit for the front face (needed wherever an art crop is shown). */
export function artistOf(c: ScryCard): string | undefined {
  return c.card_faces?.[0]?.artist ?? c.artist;
}

/** Which group a card goes in when the deck view is grouped by type. */
export { primaryType } from "./deckGroups";

// ---- Token art -----------------------------------------------------------------------------------
// Tokens are their own printings on Scryfall (set "t" + the set code, e.g. "tm19"). The game server
// sends Forge's token image key, "t:<script>|<SET>|<collector number>|<n>" when Forge knows the
// printing, else "t:<script>". The script name is "<colors>_<power>_<toughness>_<name>" (e.g.
// "r_1_1_goblin"). Look up the exact printing first, then search by name, colors and base P/T.
// Results (including "none found") are cached in localStorage for 24 hours.

export interface TokenSpec {
  name: string;
  /** Forge's token image key, when the game server sent one. */
  key?: string;
  /** The exact printing (Scryfall set code and collector number), from the card that made it. */
  set?: string;
  number?: string;
  /** The printing the token's owner picked for their deck (Scryfall id): wins over everything. */
  art?: string;
}

const TOKEN_STORE = "cq.scryfall.tokens.v2";
const tokenArtMem = new Map<string, { url: string | null; at: number }>();
const tokenArtInflight = new Map<string, Promise<string | undefined>>();
let tokenStoreLoaded = false;

const tokenId = (s: TokenSpec) => (s.art ? `art|${s.art}` : `${s.name.toLowerCase()}|${s.key ?? ""}|${s.set ?? ""}|${s.number ?? ""}`);

function loadTokenStore() {
  if (tokenStoreLoaded) return;
  tokenStoreLoaded = true;
  try {
    const raw = localStorage.getItem(TOKEN_STORE);
    const now = Date.now();
    for (const [k, v] of Object.entries(raw ? (JSON.parse(raw) as Record<string, { url: string | null; at: number }>) : {})) {
      if (now - v.at < TTL_MS) tokenArtMem.set(k, v);
    }
  } catch {
    // unreadable or blocked storage: start empty
  }
}

function saveTokenStore() {
  try {
    localStorage.setItem(TOKEN_STORE, JSON.stringify(Object.fromEntries([...tokenArtMem].slice(-400))));
  } catch {
    // full or blocked: memory only
  }
}

/** The token's art if already looked up: a URL, null (Scryfall has none), or undefined (not yet). */
export function cachedTokenArt(spec: TokenSpec): string | null | undefined {
  loadTokenStore();
  return tokenArtMem.get(tokenId(spec))?.url;
}

/** Finds a token's art on Scryfall (rate-limited like every other call). */
export function tokenArt(spec: TokenSpec): Promise<string | undefined> {
  const id = tokenId(spec);
  const known = cachedTokenArt(spec);
  if (known !== undefined) return Promise.resolve(known ?? undefined);
  let p = tokenArtInflight.get(id);
  if (!p) {
    p = findTokenArt(spec)
      .catch(() => undefined)
      .then((url) => {
        tokenArtMem.set(id, { url: url ?? null, at: Date.now() });
        saveTokenStore();
        tokenArtInflight.delete(id);
        return url;
      });
    tokenArtInflight.set(id, p);
  }
  return p;
}

/**
 * Some sets list a token twice: the regular one and a foil-only collector variant (Star Trek
 * Commander's surge foils), and Forge picks either. Show the regular print of the same art, so one
 * player's tokens don't come out in two different finishes.
 */
async function regularPrint(c: ScryCard): Promise<string | undefined> {
  if (!c.finishes || c.finishes.includes("nonfoil")) return undefined;
  try {
    // Raw search (not `search`): its cards are trimmed and lose `finishes`.
    const q = `set:${c.set} t:token !"${c.name.replace(/"/g, "")}"`;
    const page = await getJson<{ data: ScryCard[] }>(`${API}/cards/search?${new URLSearchParams({ q, unique: "prints" })}`);
    const regular = page.data.filter((p) => p.finishes?.includes("nonfoil") && imageUrl(p, "normal"));
    const hit = regular.find((p) => p.illustration_id && p.illustration_id === c.illustration_id) ?? regular.find((p) => p.artist === c.artist);
    return hit ? imageUrl(hit, "normal") : undefined;
  } catch {
    return undefined;
  }
}

async function findTokenArt(spec: TokenSpec): Promise<string | undefined> {
  if (spec.art) {
    if (!cachedById(spec.art)) await cardsById([spec.art]);
    const picked = cachedById(spec.art);
    if (picked) return imageUrl(picked, "normal");
  }
  const [script, forgeSet, forgeNumber] = (spec.key ?? "").replace(/^t:/, "").split("|");
  // The exact printing: the server's Scryfall code for it, then Forge's set code as Scryfall's token set.
  const prints: [string, string][] = [];
  if (spec.set && spec.number) prints.push([spec.set, spec.number]);
  if (forgeSet && forgeNumber) prints.push([`t${forgeSet.toLowerCase()}`, forgeNumber]);
  for (const [set, number] of prints) {
    try {
      const c = await getJson<ScryCard>(`${API}/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`);
      const url = imageUrl(c, "normal");
      if (url && /token/i.test(c.type_line ?? c.card_faces?.[0]?.type_line ?? "")) return (await regularPrint(c)) ?? url;
    } catch {
      // not on Scryfall under that number: try the next, then search
    }
  }
  const m = /^([a-z]+)_(\d+|x)_(\d+|x)_/.exec(script ?? "");
  const name = spec.name.replace(/ token$/i, "").replace(/"/g, "");
  const tries: string[] = [];
  if (m) {
    const colors = m[1] === "c" ? "c" : m[1] === "all" ? "wubrg" : m[1];
    const pt = m[2] !== "x" && m[3] !== "x" ? ` pow=${m[2]} tou=${m[3]}` : "";
    tries.push(`t:token !"${name}" c=${colors}${pt}`);
  }
  tries.push(`t:token !"${name}"`);
  for (const q of tries) {
    const page = await search(q, "prints");
    const hit = page.cards.find((c) => imageUrl(c, "normal"));
    if (hit) return imageUrl(hit, "normal");
  }
  return undefined;
}
