// Filters cards you're looking at (your library while you search it, a graveyard…) with a query
// in Scryfall's syntax, run locally on the Scryfall data we already have for those cards.
// Plain words match the name. Supported keys: name, t/type, o/oracle, fo, c/color, id/ci/identity,
// m/mana, mv/cmc, pow/power, tou/toughness, loy/loyalty, r/rarity, kw/keyword, is (permanent,
// spell, creature…, multicolored, colorless, legendary). Also -negation, "or", parentheses, quotes
// and !"exact name". Pure logic, so `node --test` runs it.

/** The parts of a Scryfall card the filter reads. */
export interface QueryCard {
  name: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc?: number;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  color_identity?: string[];
  rarity?: string;
  keywords?: string[];
  card_faces?: { name?: string; type_line?: string; oracle_text?: string; mana_cost?: string; power?: string; toughness?: string; loyalty?: string; colors?: string[] }[];
}

type Node =
  | { op: "and" | "or"; parts: Node[] }
  | { op: "not"; part: Node }
  | { op: "term"; key: string; cmp: string; value: string; exact?: boolean };

/** Parses a query; returns a predicate, or an error message for a query it can't read. */
export function compileQuery(q: string): ((c: QueryCard) => boolean) | { error: string } {
  try {
    const tokens = tokenize(q);
    let i = 0;
    const peek = () => tokens[i];
    const parseOr = (): Node => {
      const parts = [parseAnd()];
      while (peek()?.toLowerCase() === "or") (i++, parts.push(parseAnd()));
      return parts.length === 1 ? parts[0] : { op: "or", parts };
    };
    const parseAnd = (): Node => {
      const parts: Node[] = [];
      while (i < tokens.length && peek() !== ")" && peek()?.toLowerCase() !== "or") parts.push(parseUnary());
      if (!parts.length) throw new Error("Something is missing in the search");
      return parts.length === 1 ? parts[0] : { op: "and", parts };
    };
    const parseUnary = (): Node => {
      const t = tokens[i++];
      if (t === "-") return { op: "not", part: parseUnary() };
      if (t === "(") {
        const n = parseOr();
        if (tokens[i++] !== ")") throw new Error("A ( has no matching )");
        return n;
      }
      if (t === ")") throw new Error("A ) has no matching (");
      return term(t);
    };
    if (!tokens.length) return () => true;
    const tree = parseOr();
    if (i < tokens.length) throw new Error("A ) has no matching (");
    check(tree);
    return (c) => evaluate(tree, c);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function tokenize(q: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "(" || ch === ")") { out.push(ch); i++; continue; }
    if (ch === "-" && i + 1 < q.length && !/\s/.test(q[i + 1])) { out.push("-"); i++; continue; }
    // A word, which may hold a quoted part: o:"draw a card", !"Sol Ring", "lightning bolt".
    let w = "";
    while (i < q.length && !/\s/.test(q[i]) && q[i] !== "(" && q[i] !== ")") {
      if (q[i] === '"') {
        const end = q.indexOf('"', i + 1);
        if (end < 0) throw new Error("A quote isn't closed");
        w += q.slice(i, end + 1);
        i = end + 1;
      } else w += q[i++];
    }
    out.push(w);
  }
  return out;
}

const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s);

const KEYS: Record<string, string> = {
  name: "name", n: "name", t: "type", type: "type", o: "oracle", oracle: "oracle", fo: "oracle",
  c: "color", color: "color", colors: "color", id: "identity", ci: "identity", identity: "identity", commander: "identity",
  m: "mana", mana: "mana", mv: "mv", cmc: "mv", manavalue: "mv", pow: "pow", power: "pow", tou: "tou", toughness: "tou",
  loy: "loy", loyalty: "loy", r: "rarity", rarity: "rarity", kw: "keyword", keyword: "keyword", is: "is", not: "not",
};

function term(t: string): Node {
  if (t.startsWith("!")) return { op: "term", key: "name", cmp: "=", value: unquote(t.slice(1)), exact: true };
  const m = /^([a-z]+)(:|<=|>=|!=|<|>|=)(.+)$/i.exec(t);
  if (m && !m[3].startsWith(":")) {
    const key = KEYS[m[1].toLowerCase()];
    if (!key) throw new Error(`Unknown search key "${m[1]}:"`);
    if (key === "not") return { op: "not", part: { op: "term", key: "is", cmp: ":", value: unquote(m[3]) } };
    return { op: "term", key, cmp: m[2], value: unquote(m[3]) };
  }
  return { op: "term", key: "name", cmp: ":", value: unquote(t) };
}

/** Tries every term once on an empty card, so a bad value (c:purple, mv:x) is reported up front. */
function check(n: Node) {
  if (n.op === "term") matches(n, { name: "" });
  else if (n.op === "not") check(n.part);
  else n.parts.forEach(check);
}

function evaluate(n: Node, c: QueryCard): boolean {
  switch (n.op) {
    case "and": return n.parts.every((p) => evaluate(p, c));
    case "or": return n.parts.some((p) => evaluate(p, c));
    case "not": return !evaluate(n.part, c);
    case "term": return matches(n, c);
  }
}

const faces = (c: QueryCard) => (c.card_faces?.length ? c.card_faces : [c]);
const lower = (s: string | undefined) => (s ?? "").toLowerCase();
/** Straight quotes and dashes, so "can't" matches Scryfall's text either way. */
const plain = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[−–—]/g, "-");

const COLOR_NAMES: Record<string, string> = {
  white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c", multicolor: "m", multicolored: "m",
  azorius: "wu", dimir: "ub", rakdos: "br", gruul: "rg", selesnya: "gw", orzhov: "wb", izzet: "ur", golgari: "bg", boros: "rw", simic: "gu",
  bant: "gwu", esper: "wub", grixis: "ubr", jund: "brg", naya: "rgw", abzan: "wbg", jeskai: "urw", sultai: "bgu", mardu: "rwb", temur: "gur",
};

function compareNum(a: number, cmp: string, b: number): boolean {
  switch (cmp) {
    case ":": case "=": return a === b;
    case "!=": return a !== b;
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
  }
  return false;
}

/** Compares a card's colours with a set: c: means "at least these", id: means "within these". */
function compareColors(have: Set<string>, cmp: string, want: string, isIdentity: boolean): boolean {
  let w = lower(want);
  w = COLOR_NAMES[w] ?? w;
  if (w === "m") return compareNum(have.size, cmp === ":" ? ">=" : cmp, 2);
  if (w === "c") return compareNum(have.size, cmp === ":" ? "=" : cmp, 0);
  if (/^\d+$/.test(w)) return compareNum(have.size, cmp, Number(w));
  if (!/^[wubrg]+$/.test(w)) throw new Error(`Unknown colour "${want}"`);
  const set = new Set(w.split(""));
  const sub = [...set].every((x) => have.has(x)); // card has all of them
  const sup = [...have].every((x) => set.has(x)); // card has nothing else
  const op = cmp === ":" ? (isIdentity ? "<=" : ">=") : cmp;
  switch (op) {
    case "=": return sub && sup;
    case "!=": return !(sub && sup);
    case ">=": return sub;
    case ">": return sub && !sup;
    case "<=": return sup;
    case "<": return sup && !sub;
  }
  return false;
}

/** Mana symbols in a cost, e.g. "{2}{G}{G}" or "2gg" → counts like { G: 2, generic: 2 }. */
function manaSymbols(cost: string): Map<string, number> {
  const m = new Map<string, number>();
  const add = (s: string) => {
    if (/^\d+$/.test(s)) m.set("#", (m.get("#") ?? 0) + Number(s));
    else m.set(s, (m.get(s) ?? 0) + 1);
  };
  const s = cost.toUpperCase();
  const braces = s.match(/\{[^}]+\}/g);
  if (braces) braces.forEach((b) => add(b.slice(1, -1)));
  else for (const part of s.match(/\d+|[A-Z]/g) ?? []) add(part);
  return m;
}

const PERMANENT = ["artifact", "creature", "enchantment", "land", "planeswalker", "battle"];

function matches(n: Extract<Node, { op: "term" }>, c: QueryCard): boolean {
  const v = n.value;
  switch (n.key) {
    case "name": {
      const names = [c.name, ...faces(c).map((f) => f.name ?? "")].map(plain);
      return n.exact ? names.includes(plain(v)) : names.some((x) => x.includes(plain(v)));
    }
    case "type":
      return faces(c).some((f) => plain(f.type_line ?? c.type_line ?? "").includes(plain(v)));
    case "oracle": {
      const needle = plain(v);
      return faces(c).some((f) => {
        // ~ is the card's name, or the short one the text uses for legends ("Kenrith" for "Kenrith, the Returned King").
        const name = plain(f.name ?? c.name);
        const text = plain(f.oracle_text ?? "").replaceAll(name, "~").replaceAll(name.split(",")[0], "~");
        return text.includes(needle.replaceAll(name, "~").replaceAll(name.split(",")[0], "~"));
      });
    }
    case "keyword":
      return (c.keywords ?? []).some((k) => lower(k) === lower(v));
    case "color":
    case "identity": {
      const cols = n.key === "identity" ? c.color_identity ?? [] : c.colors ?? faces(c).flatMap((f) => f.colors ?? []);
      return compareColors(new Set(cols.map(lower)), n.cmp, v, n.key === "identity");
    }
    case "mana": {
      const want = manaSymbols(v);
      return faces(c).some((f) => {
        const have = manaSymbols(f.mana_cost ?? c.mana_cost ?? "");
        const covers = [...want].every(([k, x]) => (have.get(k) ?? 0) >= x);
        const same = covers && [...have].every(([k, x]) => (want.get(k) ?? 0) === x);
        return n.cmp === "=" ? same : n.cmp === "!=" ? !same : covers;
      });
    }
    case "mv": {
      if (lower(v) === "even" || lower(v) === "odd") return (c.cmc ?? 0) % 2 === (lower(v) === "even" ? 0 : 1);
      const x = Number(v);
      if (Number.isNaN(x)) throw new Error(`"${v}" isn't a number`);
      return compareNum(c.cmc ?? 0, n.cmp, x);
    }
    case "pow":
    case "tou":
    case "loy": {
      const field = n.key === "pow" ? "power" : n.key === "tou" ? "toughness" : "loyalty";
      const other = lower(v) === "pow" || lower(v) === "power" ? "power" : lower(v) === "tou" || lower(v) === "toughness" ? "toughness" : null;
      return faces(c).some((f) => {
        const raw = f[field] ?? c[field];
        if (raw === undefined) return false;
        const a = Number.parseFloat(raw);
        const b = other ? Number.parseFloat(f[other] ?? c[other] ?? "") : Number(v);
        if (Number.isNaN(a) || Number.isNaN(b)) return false;
        return compareNum(a, n.cmp, b);
      });
    }
    case "rarity": {
      const order = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
      const want = { c: "common", u: "uncommon", r: "rare", m: "mythic", s: "special" }[lower(v)] ?? lower(v);
      const a = order.indexOf(lower(c.rarity)), b = order.indexOf(want);
      if (b < 0) throw new Error(`Unknown rarity "${v}"`);
      return compareNum(a, n.cmp, b);
    }
    case "is": {
      const type = lower(c.type_line);
      const w = lower(v);
      if (w === "permanent") return PERMANENT.some((t) => type.includes(t));
      if (w === "spell") return !type.includes("land");
      if (w === "multicolored" || w === "multicolor") return (c.colors?.length ?? 0) > 1;
      if (w === "colorless") return (c.colors?.length ?? 0) === 0;
      if (w === "commander") return type.includes("legendary") && (type.includes("creature") || /can be your commander/i.test(c.oracle_text ?? ""));
      if (w === "vanilla") return !faces(c).some((f) => f.oracle_text);
      if (w === "historic") return type.includes("legendary") || type.includes("artifact") || type.includes("saga");
      if (w === "split" || w === "dfc" || w === "mdfc") return (c.card_faces?.length ?? 0) > 1;
      if (/^[a-z]+$/.test(w)) return type.includes(w); // is:creature, is:legendary…
      throw new Error(`Unknown "is:${v}"`);
    }
  }
  return false;
}
