// Mana symbols from the Mana font (mana-font): its class for a symbol like "G", "W/U" or "T".
// Pure logic (no DOM), so node --test can run it.

const NAMED: Record<string, string> = { T: "tap", Q: "untap", "∞": "infinity", "½": "1-2", "1/2": "1-2" };

/** "ms ms-<x> ms-cost" for a mana symbol (without braces), or undefined when the font has none. */
export function manaSymbolClass(sym: string): string | undefined {
  const name = NAMED[sym] ?? sym.toLowerCase().replace(/\//g, "");
  const known = /^(?:[wubrgcsxyze]|1?\d|20|100|1000000|[wubrg]{2}|c[wubrg]|2[wubrg]|[wubrg]p|[wubrg]{2}p|tap|untap|infinity|1-2|chaos)$/;
  return known.test(name) ? `ms ms-${name} ms-cost` : undefined;
}
