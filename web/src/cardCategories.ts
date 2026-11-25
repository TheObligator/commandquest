// What a card does in a deck ("Ramp", "Removal", "Draw", …), for Group by → Category. Worked out
// from Scryfall Tagger's oracle tags, which players put on cards. scripts/cardcategories.ts builds
// /card-categories.json from Scryfall's daily bulk data; useCardCategories.ts loads it.
//
// Pure logic with no DOM or browser APIs, so `node --test` can run it.

/** The format of {@link CardCategoriesData}. Raise it when that changes, then run `npm run cardcategories`. */
export const CARD_CATEGORIES_VERSION = 1;

/**
 * Each category and the Tagger tags that put a card in it. A tag brings every tag beneath it
 * ("removal" includes "removal-creature"); "-tag" takes that tag's cards out again. Read left to
 * right. A card shows under the first category here it fits, so the more telling ones come first
 * (a cantrip that mills a card is Draw, so surveil and cantrips are out of Mill).
 */
export const CATEGORY_RULES: readonly (readonly [category: string, tags: string])[] = [
  ["Finisher", "alternate-win-condition extra-turn overrun"],
  ["Counterspells", "counterspell"],
  ["Blink", "flicker"],
  ["Clones", "clone"],
  ["Board wipes", "sweeper -sweeper-graveyard"],
  ["Copy", "copy -copy-self -clone -mill"],
  ["Removal", "removal hate-graveyard sweeper-graveyard"],
  ["Mill", "mill -surveil -cantrip"],
  ["Landfall", "landfall"],
  ["Draw", "card-advantage cantrip surveil -reanimate -regrowth"],
  ["Ramp", "ramp cost-reducer etb-untapper"],
  ["Tutor", "tutor -lifegain"],
  ["Lifegain", "lifegain soul-warden-ability lifegain-matters"],
  ["Recursion", "recursion"],
  ["Burn", "burn group-slug"],
  ["Protection", "protects-creature protects-all protects-permanent phasing gives-hexproof gives-shroud gives-indestructible gives-ward"],
  ["Stax", "tax pillowfort hatebear"],
  ["Tokens", "repeatable-creature-tokens multiple-bodies"],
  ["Anthem", "anthem power-boost-to-all"],
  ["Pump", "combat-trick maro-sorcerer keyword-anthem prowess-anthem gives-double-strike gives-trample power-doubler gives-first-strike"],
  ["+1/+1 counters", "repeatable-pp-counters gives-pp-counters counter-doubler"],
  ["Evasion", "evasion gives-flying gives-unblockable"],
];

/** A tag in Scryfall's bulk data (the fields {@link buildCardCategories} reads). */
export interface BulkTag {
  id: string;
  slug: string;
  aliases?: string[];
  child_ids?: string[];
  taggings: { oracle_id: string }[];
}

/** /card-categories.json. */
export interface CardCategoriesData {
  version: number;
  /** When it was made from Scryfall's data (ISO date and time). */
  built: string;
  categories: string[];
  /**
   * Cards by the categories they fit. The key is those categories' positions, one base-36 digit
   * each, best first; the value is the cards' {@link shortId}s run together.
   */
  cards: Record<string, string>;
}

/** As much of an oracle id as it takes to tell cards apart. */
const ID_LENGTH = 10;
const shortId = (oracleId: string) => oracleId.replace(/-/g, "").slice(0, ID_LENGTH);

/** Throws if a rule's tag is gone or a category ends up empty: the rules need a look. */
export function buildCardCategories(tags: Iterable<BulkTag>, built = new Date(), rules = CATEGORY_RULES): CardCategoriesData {
  const byId = new Map<string, BulkTag>();
  const bySlug = new Map<string, BulkTag>();
  for (const t of tags) {
    byId.set(t.id, t);
    bySlug.set(t.slug, t);
  }
  for (const t of byId.values()) for (const a of t.aliases ?? []) if (!bySlug.has(a)) bySlug.set(a, t);

  /** The cards with a tag or any tag beneath it. */
  const cardsWith = (slug: string): Set<string> => {
    const tag = bySlug.get(slug);
    if (!tag) throw new Error(`Scryfall Tagger has no tag "${slug}"`);
    const cards = new Set<string>();
    const seen = new Set<string>();
    const todo = [tag];
    for (let t = todo.pop(); t; t = todo.pop()) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      for (const g of t.taggings) cards.add(g.oracle_id);
      for (const id of t.child_ids ?? []) if (byId.has(id)) todo.push(byId.get(id)!);
    }
    return cards;
  };

  const fits = new Map<string, string>();
  rules.forEach(([category, spec], i) => {
    const cards = new Set<string>();
    for (const s of spec.split(" ")) {
      if (s.startsWith("-")) for (const c of cardsWith(s.slice(1))) cards.delete(c);
      else for (const c of cardsWith(s)) cards.add(c);
    }
    if (!cards.size) throw new Error(`no cards are in "${category}"`);
    for (const c of cards) fits.set(c, (fits.get(c) ?? "") + i.toString(36));
  });

  const lists = new Map<string, string[]>();
  for (const [card, key] of fits) lists.set(key, [...(lists.get(key) ?? []), shortId(card)]);
  const cards = Object.fromEntries([...lists].sort(([a], [z]) => (a < z ? -1 : 1)).map(([key, ids]) => [key, ids.sort().join("")]));
  return { version: CARD_CATEGORIES_VERSION, built: built.toISOString(), categories: rules.map(([c]) => c), cards };
}

/** How many cards a list puts in a category. */
export const categorized = (data: CardCategoriesData) => Object.values(data.cards).reduce((n, ids) => n + ids.length / ID_LENGTH, 0);

/** Looks up the categories a card fits. */
export class CardCategories {
  /** Every category there is, alphabetically. */
  readonly names: string[];
  private readonly data: CardCategoriesData;
  private readonly keys = new Map<string, string>();

  constructor(data: CardCategoriesData) {
    this.data = data;
    this.names = [...data.categories].sort((a, z) => a.localeCompare(z));
    for (const [key, ids] of Object.entries(data.cards)) {
      for (let i = 0; i < ids.length; i += ID_LENGTH) this.keys.set(ids.slice(i, i + ID_LENGTH), key);
    }
  }

  /** The categories a card fits, best first; none when Tagger doesn't place it. */
  of(oracleId: string | undefined): string[] {
    const key = oracleId ? this.keys.get(shortId(oracleId)) : undefined;
    return key ? [...key].map((d) => this.data.categories[parseInt(d, 36)]) : [];
  }
}
