// Card data served from our own site, so looking a card up by name needs no Scryfall API request
// (its rate limit is per IP address, and a table of four or a few open tabs can hit it).
//
// scripts/carddata.ts builds it from Scryfall's daily bulk data (one printing per card, the one
// Scryfall picks), in two parts:
//   /card-data.json                 the manifest: which build is current and the format list
//   /card-data/<tag>/<shard>.json   the cards, split into SHARDS files by a hash of their name
// A shard is a few KB, so a deck's lookups fetch about one small file per card, from our own
// domain, cached for good (a new build has a new tag). Cards are stored compactly (see `encode`)
// and come back as the same trimmed ScryCard that a Scryfall lookup gives (`trimCard`).
//
// Pure logic with no DOM or browser APIs, so `node --test` can run it.

import type { ImageUris, ScryCard } from "./scryfall";

/** The format of the card data. Raise it when `encode` or `trimCard` changes. */
export const CARD_DATA_VERSION = 1;
/** How many shard files the cards are split into. */
export const SHARDS = 4096;

export interface CardDataManifest {
  version: number;
  /** When it was made from Scryfall's data (ISO date and time). */
  built: string;
  /** The folder the shards are in: changes with every build, so shards can be cached for good. */
  tag: string;
  /** The formats in `legalities`, in the order the encoded legalities string lists them. */
  formats: string[];
}

/** A card as a shard stores it: the ScryCard with its images, link and legalities shortened. */
export type StoredCard = Omit<ScryCard, "image_uris" | "scryfall_uri" | "legalities" | "card_faces"> & {
  /** The image path shared by every size, e.g. "front/a/4/a471….jpg?1783907750" (see `imagesFrom`). */
  img?: string;
  image_uris?: ImageUris;
  /** scryfall_uri without "https://scryfall.com/card/" and "?utm_source=api", when it has both. */
  uri?: string;
  scryfall_uri?: string;
  /** One letter per format in the manifest's order: l legal, n not legal, b banned, r restricted. */
  legal: string;
  card_faces?: (Omit<NonNullable<ScryCard["card_faces"]>[number], "image_uris"> & { img?: string; image_uris?: ImageUris })[];
};

/** The shard a card name is in: three hex digits from an FNV-1a hash of the lowercased name. */
export function shardOf(name: string): string {
  let h = 0x811c9dc5;
  const s = name.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % SHARDS).toString(16).padStart(3, "0");
}

/** The names a card can be looked up by (lowercased): its full name and its front face's. */
export function lookupNames(c: Pick<ScryCard, "name" | "card_faces">): string[] {
  return [...new Set([c.name, c.card_faces?.[0]?.name].filter((n): n is string => !!n).map((n) => n.toLowerCase()))];
}

/**
 * Tokens, emblems and art cards. Some share a card's name (Angel of Sanctions makes an Angel of
 * Sanctions token), so they're only ever looked up by id, never by name, and a deck card never
 * takes one as its printing.
 */
export function isTokenLike(c: { layout?: string; type_line?: string }): boolean {
  return ["token", "double_faced_token", "emblem", "art_series"].includes(c.layout ?? "") || /^(Token|Emblem)\b/.test(c.type_line ?? "");
}

// ---- Trimming (what we keep of a Scryfall card) ----------------------------------------------

const IMAGE_SIZES = ["small", "normal", "large", "png", "art_crop", "border_crop"] as const;

function pick<O extends object>(o: O, keys: readonly (keyof O)[]): O {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as O;
}

/** Only the image sizes we show (Scryfall lists a dozen). */
function trimImages(u: ImageUris | undefined): ImageUris | undefined {
  return u && pick(u, IMAGE_SIZES);
}

/** Only the fields we display, so cached cards stay small. */
export function trimCard(c: ScryCard): ScryCard {
  const card = pick(c, ["id", "oracle_id", "game_changer", "produced_mana", "name", "layout", "mana_cost", "cmc", "type_line", "oracle_text", "flavor_text", "power", "toughness", "loyalty", "defense", "color_identity", "color_indicator", "colors", "keywords", "reserved", "set", "set_name", "collector_number", "rarity", "artist", "released_at", "scryfall_uri", "legalities", "image_uris"]);
  if (card.image_uris) card.image_uris = trimImages(card.image_uris);
  const tokens = c.all_parts?.filter((p) => p.component === "token" && p.id !== c.id);
  if (tokens?.length) card.all_parts = tokens.map((p) => ({ id: p.id, component: p.component, name: p.name, type_line: p.type_line }));
  else delete card.all_parts;
  if (c.card_faces) {
    card.card_faces = c.card_faces.map((f) => {
      const face = pick(f, ["name", "oracle_id", "mana_cost", "type_line", "oracle_text", "flavor_text", "power", "toughness", "loyalty", "defense", "artist", "color_indicator", "image_uris"]);
      if (face.image_uris) face.image_uris = trimImages(face.image_uris);
      return face;
    });
  }
  return card;
}

// ---- Encoding --------------------------------------------------------------------------------

const IMAGE_HOST = "https://cards.scryfall.io/";
const URI_START = "https://scryfall.com/card/";
const URI_END = "?utm_source=api";
const LEGAL = ["legal", "not_legal", "banned", "restricted"];
const LEGAL_CODES = "lnbr";

/** Every size's URL from the path they share. */
export function imagesFrom(path: string): ImageUris {
  const at = path.lastIndexOf(".jpg");
  const [base, query] = at < 0 ? [path, ""] : [path.slice(0, at), path.slice(at + 4)];
  const url = (size: string) => `${IMAGE_HOST}${size}/${base}.${size === "png" ? "png" : "jpg"}${query}`;
  return { small: url("small"), normal: url("normal"), large: url("large"), png: url("png"), art_crop: url("art_crop"), border_crop: url("border_crop") };
}

/** The shared path of a card's images, when every size's URL follows the usual pattern. */
function imagePath(u: ImageUris): string | undefined {
  const m = /^https:\/\/cards\.scryfall\.io\/normal\/(.+\.jpg(?:\?\d+)?)$/.exec(u.normal ?? "");
  if (!m) return undefined;
  const same = (a: ImageUris, b: ImageUris) => IMAGE_SIZES.every((s) => a[s] === b[s]);
  return same(imagesFrom(m[1]), u) ? m[1] : undefined;
}

/** The formats Scryfall lists legalities for, in a fixed order. */
export function formatsOf(cards: Iterable<Pick<ScryCard, "legalities">>): string[] {
  const all = new Set<string>();
  for (const c of cards) for (const f of Object.keys(c.legalities ?? {})) all.add(f);
  return [...all].sort();
}

/** A trimmed card as a shard stores it. */
export function encode(c: ScryCard, formats: string[]): StoredCard {
  const { image_uris, scryfall_uri, legalities, card_faces, ...rest } = c;
  const out: StoredCard = { ...rest, legal: formats.map((f) => LEGAL_CODES[Math.max(0, LEGAL.indexOf(legalities?.[f] ?? "not_legal"))]).join("") };
  if (image_uris) {
    const path = imagePath(image_uris);
    if (path) out.img = path;
    else out.image_uris = image_uris;
  }
  if (scryfall_uri?.startsWith(URI_START) && scryfall_uri.endsWith(URI_END)) out.uri = scryfall_uri.slice(URI_START.length, -URI_END.length);
  else if (scryfall_uri) out.scryfall_uri = scryfall_uri;
  if (card_faces) {
    out.card_faces = card_faces.map(({ image_uris: faceImages, ...face }) => {
      if (!faceImages) return face;
      const path = imagePath(faceImages);
      return path ? { ...face, img: path } : { ...face, image_uris: faceImages };
    });
  }
  return out;
}

/** A stored card back as the trimmed ScryCard it came from. */
export function decode(s: StoredCard, formats: string[]): ScryCard {
  const { img, uri, legal, card_faces, ...rest } = s;
  const legalities: Record<string, string> = {};
  formats.forEach((f, i) => (legalities[f] = LEGAL[LEGAL_CODES.indexOf(legal[i] ?? "n")] ?? "not_legal"));
  const card = { ...rest, legalities, scryfall_uri: uri !== undefined ? `${URI_START}${uri}${URI_END}` : (s.scryfall_uri ?? "") } as ScryCard;
  if (img) card.image_uris = imagesFrom(img);
  if (card_faces) {
    card.card_faces = card_faces.map(({ img: faceImg, ...face }) => (faceImg ? { ...face, image_uris: imagesFrom(faceImg) } : face));
  }
  return card;
}

// ---- Building --------------------------------------------------------------------------------

export interface CardData {
  manifest: CardDataManifest;
  /** Shard name -> its cards, for every shard (an empty one too, so a missing shard means an old tag). */
  shards: Map<string, StoredCard[]>;
}

/** The card data for a bulk download (Scryfall's oracle_cards: one printing per card). */
export function buildCardData(bulk: Iterable<ScryCard>, tag: string, built = new Date()): CardData {
  const cards = [...bulk].filter((c) => !isTokenLike(c)).map(trimCard);
  const formats = formatsOf(cards);
  const shards = new Map<string, StoredCard[]>();
  for (let i = 0; i < SHARDS; i++) shards.set(i.toString(16).padStart(3, "0"), []);
  for (const c of cards) {
    const stored = encode(c, formats);
    for (const shard of new Set(lookupNames(c).map(shardOf))) shards.get(shard)!.push(stored);
  }
  return { manifest: { version: CARD_DATA_VERSION, built: built.toISOString(), tag, formats }, shards };
}
