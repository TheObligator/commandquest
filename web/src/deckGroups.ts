// How the deck editor splits a board into groups: by type (the default), category (what the card
// does), subtype, the player's own tags, rarity, color, color identity, mana value, set, artist, or
// not at all. The choice is remembered with each deck.
import type { DeckCard } from "../convex/model/deckRules";
import type { ScryCard } from "./scryfall";

export type GroupBy = "type" | "category" | "subtype" | "typeTag" | "tag" | "rarity" | "color" | "identity" | "manaValue" | "set" | "artist" | "none";

export const GROUPINGS: { id: GroupBy; label: string }[] = [
  { id: "type", label: "Type" },
  { id: "category", label: "Category" },
  { id: "subtype", label: "Subtype" },
  { id: "typeTag", label: "Type & tag" },
  { id: "tag", label: "Tag" },
  { id: "rarity", label: "Rarity" },
  { id: "color", label: "Color" },
  { id: "identity", label: "Color identity" },
  { id: "manaValue", label: "Mana value" },
  { id: "set", label: "Set" },
  { id: "artist", label: "Artist" },
  { id: "none", label: "No grouping" },
];

export const DEFAULT_GROUPING: GroupBy = "type";

export const isGroupBy = (v: unknown): v is GroupBy => GROUPINGS.some((g) => g.id === v);

export interface CardGroup {
  key: string;
  label: string;
  cards: DeckCard[];
}

/** Card type groups in a deck view, in display order. */
export const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"];

const COLOR_ORDER = ["W", "U", "B", "R", "G"];
const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const RARITY_ORDER = ["mythic", "rare", "uncommon", "common", "special", "bonus"];
const LOADING = "Loading…";

/** The front face's type line (double-faced cards are grouped by the side you cast). */
const frontType = (c: ScryCard) => c.card_faces?.[0]?.type_line ?? c.type_line ?? "";

/** Which type group a card goes in: the first of these its front face has. */
export function primaryType(c: ScryCard | undefined): string {
  if (!c) return "Other";
  const front = frontType(c).split("—")[0];
  for (const t of ["Creature", "Planeswalker", "Battle", "Land", "Instant", "Sorcery", "Artifact", "Enchantment"]) {
    if (front.includes(t)) return t;
  }
  return "Other";
}

/** The automatic categories a card fits, best first. */
export type AutoCategories = (c: ScryCard) => string[];

/** The automatic categories that apply to a deck entry: lands have none, they're all under Land. */
export const fittingCategories = (c: ScryCard | undefined, auto: AutoCategories): string[] => (c && !isLand(c) ? auto(c) : []);

/** The category a card shows under: its own, else the best automatic one; undefined means its type. */
export const categoryOf = (entry: DeckCard, c: ScryCard | undefined, auto: AutoCategories): string | undefined => entry.category ?? fittingCategories(c, auto)[0];

const isLand = (c: ScryCard) => primaryType(c) === "Land";

/** The front face's subtypes ("Human Wizard" → Human, Wizard). */
const subtypes = (c: ScryCard) => (frontType(c).split("—")[1] ?? "").trim().split(/\s+/).filter(Boolean);

/**
 * A card's colors. Double-faced cards keep theirs on the faces, so fall back to the front face's
 * mana cost and color indicator.
 */
export function colorsOf(c: ScryCard): string[] {
  if (c.colors) return c.colors;
  const f = c.card_faces?.[0];
  if (!f) return [];
  const fromCost = COLOR_ORDER.filter((x) => new RegExp(`\\{[^}]*${x}[^}]*\\}`).test(f.mana_cost ?? ""));
  return [...new Set([...fromCost, ...(f.color_indicator ?? [])])];
}

const colorKey = (colors: string[]) => COLOR_ORDER.filter((x) => colors.includes(x)).join("");
const colorLabel = (key: string) => (key ? key.split("").map((x) => COLOR_NAMES[x]).join(" / ") : "Colorless");
/** Fewer colors first, then WUBRG order. */
const colorRank = (key: string) => key.length * 100 + COLOR_ORDER.indexOf(key[0] ?? "W") * 10 + COLOR_ORDER.indexOf(key[1] ?? "W");

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mana value, then name. */
export function byManaValue(cardOf: (c: DeckCard) => ScryCard | undefined) {
  return (a: DeckCard, z: DeckCard) => (cardOf(a)?.cmc ?? 0) - (cardOf(z)?.cmc ?? 0) || a.name.localeCompare(z.name);
}

/**
 * The cards in groups, in display order, each group sorted by mana value then name (by name when
 * grouped by mana value). A card with several tags shows in each of its tag groups, but only under
 * one category. `auto` is for grouping by category: undefined while the categories load.
 */
export function groupCards(cards: DeckCard[], by: GroupBy, cardOf: (c: DeckCard) => ScryCard | undefined, auto?: AutoCategories): CardGroup[] {
  // key → [label, rank, cards]; rank orders the groups, ties by label.
  const groups = new Map<string, { label: string; rank: number; cards: DeckCard[] }>();
  const put = (key: string, label: string, rank: number, c: DeckCard) => {
    const g = groups.get(key) ?? { label, rank, cards: [] };
    g.cards.push(c);
    groups.set(key, g);
  };
  const LAST = 1e6;
  const byType = (c: DeckCard, s: ScryCard) => {
    const t = primaryType(s);
    put(`type:${t}`, t, 1000 + TYPE_ORDER.indexOf(t), c);
  };
  const byTags = (c: DeckCard) => {
    for (const t of c.tags ?? []) put(`tag:${t.toLowerCase()}`, t, 0, c);
  };

  for (const c of cards) {
    const s = cardOf(c);
    if (!s && by !== "none" && !(by === "tag" || by === "typeTag" || (by === "category" && c.category))) {
      put("loading", LOADING, LAST + 1, c);
      continue;
    }
    switch (by) {
      case "type":
        byType(c, s!);
        break;
      case "category": {
        if (!auto && !c.category && !isLand(s!)) {
          put("loading", LOADING, LAST + 1, c);
          break;
        }
        const category = categoryOf(c, s, auto ?? (() => []));
        // A category named after a type is that type's group.
        const type = category && TYPE_ORDER.find((t) => t.toLowerCase() === category.toLowerCase());
        if (type) put(`type:${type}`, type, 1000 + TYPE_ORDER.indexOf(type), c);
        else if (category) put(`cat:${category.toLowerCase()}`, category, 0, c);
        else byType(c, s!);
        break;
      }
      case "subtype": {
        // The first subtype only, so a Human Wizard shows once.
        const sub = subtypes(s!)[0];
        if (sub) put(`sub:${sub}`, sub, 0, c);
        else put("sub:", "No subtype", LAST, c);
        break;
      }
      case "typeTag":
        if (c.tags?.length) byTags(c);
        else if (s) byType(c, s);
        else put("loading", LOADING, LAST + 1, c);
        break;
      case "tag":
        if (c.tags?.length) byTags(c);
        else put("untagged", "Untagged", LAST, c);
        break;
      case "rarity": {
        const r = s!.rarity ?? "";
        const i = RARITY_ORDER.indexOf(r);
        put(`rarity:${r}`, capital(r || "unknown"), i < 0 ? RARITY_ORDER.length : i, c);
        break;
      }
      case "color": {
        if (isLand(s!)) {
          put("lands", "Lands", LAST, c);
          break;
        }
        const k = colorKey(colorsOf(s!));
        if (k.length > 1) put("color:multi", "Multicolor", 10, c);
        else put(`color:${k}`, colorLabel(k), k ? COLOR_ORDER.indexOf(k) : 11, c);
        break;
      }
      case "identity": {
        const k = colorKey(s!.color_identity ?? []);
        put(`identity:${k}`, colorLabel(k), colorRank(k), c);
        break;
      }
      case "manaValue": {
        if (isLand(s!)) {
          put("lands", "Lands", LAST, c);
          break;
        }
        const mv = s!.cmc ?? 0;
        put(`mv:${mv}`, `${mv} mana`, mv, c);
        break;
      }
      case "set": {
        // Newest set first.
        const day = s!.released_at ? Date.parse(s!.released_at) / 864e5 : 0;
        put(`set:${s!.set}`, s!.set_name ?? s!.set.toUpperCase(), -day, c);
        break;
      }
      case "artist": {
        const a = s!.card_faces?.[0]?.artist ?? s!.artist;
        if (a) put(`artist:${a}`, a, 0, c);
        else put("artist:", "Unknown artist", LAST, c);
        break;
      }
      case "none":
        put("all", "Cards", 0, c);
        break;
    }
  }

  const sort = by === "manaValue" ? (a: DeckCard, z: DeckCard) => a.name.localeCompare(z.name) : byManaValue(cardOf);
  return [...groups.entries()]
    .sort(([, a], [, z]) => a.rank - z.rank || a.label.localeCompare(z.label))
    .map(([key, g]) => ({ key, label: g.label, cards: g.cards.sort(sort) }));
}

/** Every tag used in the deck, in the order first seen (ignoring case). */
export function deckTags(cards: DeckCard[]): string[] {
  const seen = new Map<string, string>();
  for (const c of cards) for (const t of c.tags ?? []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()];
}

/** Every category the player (or an import) put a card of this deck in, in the order first seen (ignoring case). */
export function deckCategories(cards: DeckCard[]): string[] {
  const seen = new Map<string, string>();
  for (const { category } of cards) if (category && !seen.has(category.toLowerCase())) seen.set(category.toLowerCase(), category);
  return [...seen.values()];
}
