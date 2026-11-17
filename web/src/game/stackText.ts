// A stack item's text from Forge, made readable. Forge ends a trigger's text with its "important
// objects" in brackets, e.g. "When X enters, scry 1. [Zone Changer: Temple of Enlightenment (831)]"
// (WrappedAbility.getStackDescription). That's debugging detail: the card ids mean nothing to a
// player, and naming the item's own card says nothing. What's left is shown on its own line.

export interface StackText {
  /** The rules text without the bracketed part. */
  text: string;
  /** The bracketed entries worth showing, ids removed ("Zone Changer: Llanowar Elves"). */
  info: string[];
}

export function stackText(raw: string, source?: string): StackText {
  const m = /\s*\[([^\[\]]*)\]\s*$/.exec(raw);
  if (!m) return { text: raw, info: [] };
  const entries = m[1]
    // Entries are "Label: value", joined with ", "; card names can have commas, so split only before a label.
    .split(/,\s+(?=[A-Z][A-Za-z ]*:\s)/)
    .map((e) => e.replace(/\s*\(\d+\)/g, "").trim())
    .filter(Boolean);
  const info = entries.filter((e) => {
    const value = e.slice(e.indexOf(":") + 1).trim();
    return !source || value !== source;
  });
  return { text: raw.slice(0, m.index), info };
}
