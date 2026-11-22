// The deck bar's type counts (src/components/DeckBar.tsx): every card type a card has counts it
// (an artifact creature counts as both), and its subtypes go under the type they belong to.

/** The bar's types, in order. Kindred (formerly Tribal) only shows when a card has it. */
export const BAR_TYPES = ["Kindred", "Battle", "Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"];

/** Which type a card's subtypes belong to: creature types first (Kindred cards carry them too). */
const SUBTYPE_OWNER = ["Creature", "Kindred", "Planeswalker", "Battle", "Land", "Instant", "Sorcery", "Artifact", "Enchantment"];

export interface TypeCount {
  /** Cards with this type (copies counted). */
  count: number;
  /** Their subtypes, most cards first. */
  subtypes: { name: string; count: number }[];
}

/** Counts by type for cards given by their type line ("Artifact Creature — Golem"); front face only. */
export function typeCounts(cards: { quantity: number; typeLine: string }[]): Map<string, TypeCount> {
  const counts = new Map<string, { count: number; subs: Map<string, number> }>();
  const at = (t: string) => {
    let c = counts.get(t);
    if (!c) counts.set(t, (c = { count: 0, subs: new Map() }));
    return c;
  };
  for (const { quantity, typeLine } of cards) {
    const [left, right = ""] = typeLine.split(" // ")[0].split("—");
    const types = left.split(/\s+/).map((w) => (w === "Tribal" ? "Kindred" : w)).filter((w) => BAR_TYPES.includes(w));
    for (const t of new Set(types)) at(t).count += quantity;
    const owner = SUBTYPE_OWNER.find((t) => types.includes(t));
    if (!owner) continue;
    const subs = at(owner).subs;
    for (const s of right.trim().split(/\s+/).filter(Boolean)) subs.set(s, (subs.get(s) ?? 0) + quantity);
  }
  return new Map(
    [...counts].map(([t, c]) => [t, { count: c.count, subtypes: [...c.subs].map(([name, count]) => ({ name, count })).sort((a, z) => z.count - a.count || a.name.localeCompare(z.name)) }]),
  );
}
