// Scryfall API client (called straight from the browser; Scryfall allows CORS).
//
// Follows https://scryfall.com/docs/api and https://scryfall.com/docs/api/rate-limits:
//  - Rate limits: /cards/search, /cards/named, /cards/random and /cards/collection allow 2 requests
//    per second; everything else 10 per second. Every request goes through one queue that waits
//    the right gap. Images and symbols come from *.scryfall.io, which has no rate limit, so
//    they never go through the API.
//  - On HTTP 429 we pause all requests for 30 seconds, as Scryfall requires.
//  - The browser's own User-Agent is left intact and an Accept header is sent.
//  - Card data is cached in localStorage for 24 hours (Scryfall asks for at least 24h).

import type { DeckCard } from "../convex/model/deckRules";

const API = "https://api.scryfall.com";
const SLOW = /^\/cards\/(search|named|random|collection)\b/;
const SLOW_GAP_MS = 520;
const FAST_GAP_MS = 110;
const BACKOFF_MS = 30_000;

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

export interface ScryCard {
  id: string;
  name: string;
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
  keywords?: string[];
  reserved?: boolean;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  artist?: string;
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

let lastAt = 0;
let lastGap = 0;
let pausedUntil = 0;
let chain: Promise<unknown> = Promise.resolve();

function queued<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const gap = SLOW.test(path) ? SLOW_GAP_MS : FAST_GAP_MS;
  const run = chain.then(async () => {
    // Wait for whichever is longer: the previous request's gap or this one's.
    const wait = Math.max(lastAt + Math.max(gap, lastGap), pausedUntil) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    lastGap = gap;
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

class ScryfallError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const path = new URL(url).pathname;
  return queued(path, async () => {
    const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
    if (res.status === 429) {
      pausedUntil = Date.now() + BACKOFF_MS;
      throw new ScryfallError(429, "Scryfall says we're sending too many requests. Pausing card lookups for 30 seconds.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ScryfallError(res.status, (data as { details?: string }).details ?? `Scryfall error ${res.status}`);
    return data as T;
  });
}

// ---- Cache (memory + localStorage, 24h) -----------------------------------------

// Bump the version when `trim` keeps new fields, so old entries without them are dropped.
const STORE_KEY = "cq.scryfall.cards.v2";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORED = 1500;

const byId = new Map<string, ScryCard>();
const byName = new Map<string, ScryCard>();
const storedAt = new Map<string, number>();

/** Only the fields we display, so the cache stays small. */
function trim(c: ScryCard): ScryCard {
  const pick = <O extends object>(o: O, keys: (keyof O)[]) =>
    Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as O;
  const card = pick(c, ["id", "name", "layout", "mana_cost", "cmc", "type_line", "oracle_text", "flavor_text", "power", "toughness", "loyalty", "defense", "color_identity", "color_indicator", "keywords", "reserved", "set", "set_name", "collector_number", "rarity", "artist", "released_at", "scryfall_uri", "legalities", "image_uris"]);
  if (c.card_faces) {
    card.card_faces = c.card_faces.map((f) => pick(f, ["name", "mana_cost", "type_line", "oracle_text", "flavor_text", "power", "toughness", "loyalty", "defense", "artist", "color_indicator", "image_uris"]));
  }
  return card;
}

function index(c: ScryCard) {
  byId.set(c.id, c);
  byName.set(c.name.toLowerCase(), c);
  if (c.card_faces?.[0]) byName.set(c.card_faces[0].name.toLowerCase(), c);
}

function loadStore() {
  try {
    localStorage.removeItem("cq.scryfall.cards.v1");
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const now = Date.now();
    for (const [at, card] of JSON.parse(raw) as [number, ScryCard][]) {
      if (now - at < TTL_MS) {
        index(card);
        storedAt.set(card.id, at);
      }
    }
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
      localStorage.setItem(STORE_KEY, JSON.stringify(entries));
    } catch {
      // Over quota or blocked: the memory cache still works for this visit.
    }
  }, 500);
}

function remember(c: ScryCard) {
  const t = trim(c);
  index(t);
  storedAt.set(t.id, Date.now());
  saveStore();
  return t;
}

loadStore();

export function cached(card: DeckCard): ScryCard | undefined {
  return (card.scryfallId && byId.get(card.scryfallId)) || byName.get(card.name.toLowerCase());
}

export function cachedById(id: string): ScryCard | undefined {
  return byId.get(id);
}

// ---- Endpoints ----------------------------------------------------------------

/** Full-text Scryfall search (supports Scryfall syntax like `t:dragon c:r`). */
export async function search(query: string, unique: "cards" | "prints" = "cards"): Promise<SearchPage> {
  const url = `${API}/cards/search?${new URLSearchParams({ q: query, unique, order: unique === "prints" ? "released" : "edhrec" })}`;
  return page(url);
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
    result = { cards: data.data.map(remember), total: data.total_cards, nextPage: data.has_more ? data.next_page : undefined };
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) result = { cards: [], total: 0 }; // "no cards found"
    else throw e;
  }
  if (pageCache.size > 100) pageCache.clear();
  pageCache.set(url, result);
  return result;
}

export async function autocomplete(q: string): Promise<string[]> {
  if (q.trim().length < 2) return [];
  const data = await getJson<{ data: string[] }>(`${API}/cards/autocomplete?${new URLSearchParams({ q })}`);
  return data.data;
}

/** One card by its exact name (front-face names work too); cached. */
export async function named(name: string): Promise<ScryCard> {
  const hit = byName.get(name.toLowerCase());
  if (hit) return hit;
  return remember(await getJson<ScryCard>(`${API}/cards/named?${new URLSearchParams({ exact: name })}`));
}

/** All printings of a card, newest first. */
export async function printings(name: string): Promise<ScryCard[]> {
  const res = await search(`!"${name.replace(/"/g, "")}"`, "prints");
  return res.cards;
}

type Identifier = { id: string } | { set: string; collector_number: string } | { name: string };

function identifier(c: DeckCard): Identifier {
  if (c.scryfallId) return { id: c.scryfallId };
  if (c.set && c.collectorNumber) return { set: c.set.toLowerCase(), collector_number: c.collectorNumber };
  return { name: c.name };
}

/**
 * Looks up card data for a decklist (75 cards per request, Scryfall's limit). Returns the names of
 * cards Scryfall didn't recognise. Results are cached, so call `cached()` afterwards.
 */
export async function resolve(cards: DeckCard[]): Promise<string[]> {
  const todo = cards.filter((c) => !cached(c));
  const unique = new Map<string, DeckCard>();
  for (const c of todo) unique.set(JSON.stringify(identifier(c)), c);
  const list = [...unique.values()];
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
      if (card && !("name" in nf)) retry.push({ ...card, scryfallId: undefined, set: undefined, collectorNumber: undefined });
      else missing.push(card?.name ?? ("name" in nf ? nf.name : "?"));
    }
  }
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
export function hasBackImage(c: ScryCard): boolean {
  return Boolean(c.card_faces?.[1]?.image_uris);
}

/** The artist credit for the front face (needed wherever an art crop is shown). */
export function artistOf(c: ScryCard): string | undefined {
  return c.card_faces?.[0]?.artist ?? c.artist;
}

/** Which group a card goes in when the deck view is grouped by type. */
export function primaryType(c: ScryCard | undefined): string {
  if (!c) return "Other";
  const front = (c.card_faces?.[0]?.type_line ?? c.type_line).split("—")[0];
  for (const t of ["Creature", "Planeswalker", "Battle", "Land", "Instant", "Sorcery", "Artifact", "Enchantment"]) {
    if (front.includes(t)) return t;
  }
  return "Other";
}

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
}

const TOKEN_STORE = "cq.scryfall.tokens.v1";
const tokenArtMem = new Map<string, { url: string | null; at: number }>();
const tokenArtInflight = new Map<string, Promise<string | undefined>>();
let tokenStoreLoaded = false;

const tokenId = (s: TokenSpec) => `${s.name.toLowerCase()}|${s.key ?? ""}|${s.set ?? ""}|${s.number ?? ""}`;

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

async function findTokenArt(spec: TokenSpec): Promise<string | undefined> {
  const [script, forgeSet, forgeNumber] = (spec.key ?? "").replace(/^t:/, "").split("|");
  // The exact printing: the server's Scryfall code for it, then Forge's set code as Scryfall's token set.
  const prints: [string, string][] = [];
  if (spec.set && spec.number) prints.push([spec.set, spec.number]);
  if (forgeSet && forgeNumber) prints.push([`t${forgeSet.toLowerCase()}`, forgeNumber]);
  for (const [set, number] of prints) {
    try {
      const c = await getJson<ScryCard>(`${API}/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`);
      const url = imageUrl(c, "normal");
      if (url && /token/i.test(c.type_line ?? c.card_faces?.[0]?.type_line ?? "")) return url;
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
