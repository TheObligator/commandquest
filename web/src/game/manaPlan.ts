// Tapping several cards for mana at once: which way each card is tapped (a "plan"), the mana it
// all adds, and moving one mana from one color to another with the ▲ ▼ arrows. Pure, so
// `node --test` runs it (only type imports here).

/**
 * One way to tap a card: what it adds, as symbols ("W", "CC"), whose ability it is, and what it
 * costs you: damage dealt to you (pain lands, City of Brass) and life paid or lost (Mana Confluence).
 */
export interface PlanPick {
  mana: string;
  via?: string;
  damage?: number;
  life?: number;
}
export interface PlanCard {
  id: number;
  picks: PlanPick[];
}
/** For each card (same order), the index of the pick it uses. */
export type Plan = number[];

export const COLORS = ["W", "U", "B", "R", "G", "C"] as const;

const count = (mana: string, color: string) => [...mana].filter((x) => x === color).length;

/** The life a pick costs you, damage and life together. */
export const hurt = (p?: { damage?: number; life?: number }) => (p?.damage ?? 0) + (p?.life ?? 0);

/** What a plan costs you: total damage dealt to you and life paid or lost. */
export function pain(cards: PlanCard[], plan: Plan): { damage: number; life: number } {
  let damage = 0, life = 0;
  cards.forEach((c, i) => {
    damage += c.picks[plan[i]]?.damage ?? 0;
    life += c.picks[plan[i]]?.life ?? 0;
  });
  return { damage, life };
}

/** "1 damage", "2 life", "1 damage and 1 life"; empty when it's free. */
export function painText({ damage, life }: { damage?: number; life?: number }): string {
  return [damage ? `${damage} damage` : "", life ? `${life} life` : ""].filter(Boolean).join(" and ");
}

/** The mana a plan adds, by color. */
export function totals(cards: PlanCard[], plan: Plan): Record<string, number> {
  const t: Record<string, number> = {};
  cards.forEach((c, i) => {
    for (const x of c.picks[plan[i]]?.mana ?? "") t[x] = (t[x] ?? 0) + 1;
  });
  return t;
}

/** The colors any of the cards can add, in WUBRG then C order. */
export function colorsOf(cards: PlanCard[]): string[] {
  return COLORS.filter((x) => cards.some((c) => c.picks.some((p) => p.mana.includes(x))));
}

/**
 * The starting plan: each card's own ability if it has one (else the first other card's), and among
 * those, one that doesn't hurt you (a pain land's {C}), then spread across colors so dual lands
 * don't all make the same one.
 */
export function initialPlan(cards: PlanCard[], via?: string): Plan {
  const plan: Plan = [];
  cards.forEach((c, i) => {
    const preferred = c.picks.map((p, k) => ({ p, k })).filter(({ p }) => (via ? p.via === via : !p.via));
    const pool = preferred.length ? preferred : c.picks.map((p, k) => ({ p, k }));
    // Least pain first, then most mana (Sol Ring's {C}{C} over another card's {U}), then the color
    // there's least of so far.
    const sofar = totals(cards.slice(0, i), plan);
    const best = [...pool].sort((a, b) => hurt(a.p) - hurt(b.p) || b.p.mana.length - a.p.mana.length || (sofar[a.p.mana[0]] ?? 0) - (sofar[b.p.mana[0]] ?? 0))[0];
    plan.push(best?.k ?? 0);
  });
  return plan;
}

/**
 * One more (dir 1) or one less (dir -1) mana of `color`, by switching one card to another of its
 * picks. Keeps the total the same when it can (the mana comes from, or goes to, another color),
 * preferring a switch that costs no more life (a dual over a pain land), then taking from the most
 * plentiful color and giving to the scarcest. Null if no card can.
 */
export function shift(cards: PlanCard[], plan: Plan, color: string, dir: 1 | -1): Plan | null {
  const t = totals(cards, plan);
  let best: { i: number; k: number; score: number } | null = null;
  cards.forEach((c, i) => {
    const cur = c.picks[plan[i]];
    if (!cur) return;
    c.picks.forEach((p, k) => {
      if (k === plan[i]) return;
      const change = count(p.mana, color) - count(cur.mana, color);
      if (Math.sign(change) !== dir) return;
      // Prefer the same amount of mana in total, then (going up) taking from the color there's most
      // of, or (going down) giving to the color there's least of.
      const sameSize = p.mana.length === cur.mana.length ? 0 : 1000;
      const other = dir === 1 ? cur.mana.replaceAll(color, "")[0] : p.mana.replaceAll(color, "")[0];
      const plenty = other ? t[other] ?? 0 : 0;
      const score = sameSize + 100 * (hurt(p) - hurt(cur)) + (dir === 1 ? -plenty : plenty);
      if (!best || score < best.score) best = { i, k, score };
    });
  });
  if (!best) return null;
  const { i, k } = best;
  const next = [...plan];
  next[i] = k;
  return next;
}

/** "WWU" → "{W}{W}{U}". */
export const symbols = (mana: string) => [...mana].map((x) => `{${x}}`).join("");
