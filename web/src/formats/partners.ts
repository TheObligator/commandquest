// Second commanders: which cards can sit beside a commander in the command zone.
//
// - Partner: any other card with plain partner.
// - Partner with NAME: that one card.
// - Partner—GROUP (Survivors, Character select, Friends forever, ...): another card with the same
//   Partner—GROUP. Older printings say just "Friends forever", the same thing.
// - Choose a Background: a legendary Background enchantment, and the other way round.
// - Doctor's companion: a legendary Time Lord Doctor creature with no other creature types, and
//   the other way round.

/** The Scryfall fields this needs (a ScryCard fits). */
export interface PairCard {
  name: string;
  type_line: string;
  oracle_text?: string;
  card_faces?: { name: string; type_line?: string; oracle_text?: string }[];
}

export type Pairing =
  | { kind: "partner" }
  | { kind: "partnerWith"; name: string }
  | { kind: "group"; group: string }
  | { kind: "chooseBackground" }
  | { kind: "background" }
  | { kind: "companion" }
  | { kind: "doctor" };

const front = (c: PairCard) => ({
  name: c.card_faces?.[0]?.name ?? c.name,
  type: c.card_faces?.[0]?.type_line ?? c.type_line,
  text: c.oracle_text ?? c.card_faces?.[0]?.oracle_text ?? "",
});

/** The ways this card can share the command zone with a second commander. */
export function pairings(c: PairCard): Pairing[] {
  const { type, text } = front(c);
  const out: Pairing[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s*\(.*\)\s*$/, "").trim();
    let m: RegExpMatchArray | null;
    if (/^partner$/i.test(line)) out.push({ kind: "partner" });
    else if ((m = line.match(/^partner with (.+)$/i))) out.push({ kind: "partnerWith", name: m[1].trim() });
    else if ((m = line.match(/^partner\s*[—–-]\s*(.+)$/i))) out.push({ kind: "group", group: m[1].trim() });
    else if (/^friends forever$/i.test(line)) out.push({ kind: "group", group: "Friends forever" });
    else if (/^choose a background$/i.test(line)) out.push({ kind: "chooseBackground" });
    else if (/^doctor's companion$/i.test(line)) out.push({ kind: "companion" });
  }
  const [supers, subs = ""] = type.split(/\s+[—–-]\s+/);
  const legendary = /\bLegendary\b/.test(supers);
  if (legendary && /\bEnchantment\b/.test(supers) && /\bBackground\b/.test(subs)) out.push({ kind: "background" });
  const subtypes = subs.trim().split(/\s+/).sort().join(" ");
  if (legendary && /\bCreature\b/.test(supers) && subtypes === "Doctor Lord Time") out.push({ kind: "doctor" });
  return out;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameGroup = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, " ") === b.toLowerCase().replace(/\s+/g, " ");

function fits(p: Pairing, q: Pairing, other: PairCard): boolean {
  switch (p.kind) {
    case "partner":
      return q.kind === "partner";
    case "partnerWith":
      return q.kind === "partnerWith" && (sameName(p.name, other.name) || sameName(p.name, front(other).name));
    case "group":
      return q.kind === "group" && sameGroup(p.group, q.group);
    case "chooseBackground":
      return q.kind === "background";
    case "background":
      return q.kind === "chooseBackground";
    case "companion":
      return q.kind === "doctor";
    case "doctor":
      return q.kind === "companion";
  }
}

/** Whether `a` and `b` can be a deck's two commanders. */
export function canPair(a: PairCard, b: PairCard): boolean {
  if (sameName(front(a).name, front(b).name)) return false;
  const pb = pairings(b);
  return pairings(a).some((p) => pb.some((q) => fits(p, q, b)));
}

/** What the second slot is called for this commander, or undefined when it takes no second one. */
export function partnerSlotLabel(c: PairCard): string | undefined {
  const ps = pairings(c);
  if (!ps.length) return undefined;
  const label = (p: Pairing) => {
    switch (p.kind) {
      case "partner":
        return "Partner";
      case "partnerWith":
        return p.name;
      case "group":
        return `Partner—${p.group}`;
      case "chooseBackground":
        return "Background";
      case "background":
        return "Commander";
      case "companion":
        return "Doctor";
      case "doctor":
        return "Doctor's companion";
    }
  };
  return [...new Set(ps.map(label))].join(" or ");
}

const quote = (s: string) => `"${s.replace(/"/g, "")}"`;

/**
 * A Scryfall search for the cards that can pair with this commander (a superset: results go
 * through canPair too), or undefined when it can't have a second commander.
 */
export function partnerQuery(c: PairCard): string | undefined {
  const clauses = pairings(c).map((p) => {
    switch (p.kind) {
      case "partner":
        return "o:/^partner($| \\()/";
      case "partnerWith":
        return `!${quote(p.name)}`;
      case "group":
        return p.group.toLowerCase() === "friends forever" ? `(o:${quote("Partner—Friends forever")} or o:/^friends forever/)` : `o:${quote(`Partner—${p.group}`)}`;
      case "chooseBackground":
        return "(t:legendary t:background)";
      case "background":
        return `o:${quote("choose a background")}`;
      case "companion":
        return "(t:legendary t:creature t:time t:lord t:doctor)";
      case "doctor":
        return `o:${quote("doctor's companion")}`;
    }
  });
  if (!clauses.length) return undefined;
  return `(${[...new Set(clauses)].join(" or ")}) -!${quote(front(c).name)} legal:commander`;
}
