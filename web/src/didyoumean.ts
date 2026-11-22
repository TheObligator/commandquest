// "Did you mean": when a typed card name matches nothing, guess what was meant. Scryfall has no
// endpoint that lists close names, so we gather candidates from looser lookups (its fuzzy name
// match, and autocomplete on shortened forms of the text) and rank them by spelling distance here.

/** Lowercase, curly quotes straightened, punctuation dropped, spaces collapsed. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance counting a swap of two neighbouring letters as one edit (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * How far a card name is from the typed text. The text may be the start of a name ("sol rign" for
 * Sol Ring, "cyclonic rif" for Cyclonic Rift), so it's also compared with the name cut to the
 * text's length; a double-faced card is compared by either face too.
 */
export function distance(typed: string, name: string): number {
  const t = normalize(typed);
  const forms = [name, ...name.split(" // ")].map(normalize);
  let best = Infinity;
  for (const n of forms) {
    best = Math.min(best, editDistance(t, n));
    if (n.length > t.length) best = Math.min(best, editDistance(t, n.slice(0, t.length)) + 0.5);
  }
  return best;
}

/**
 * Shortened forms of the text worth sending to Scryfall's autocomplete, which only matches names
 * containing the text as typed: with the last few letters dropped (a typo near the end), and each
 * longer word on its own (a typo in another word).
 */
export function probes(typed: string): string[] {
  const t = typed.trim().replace(/\s+/g, " ");
  const out: string[] = [];
  for (let cut = 1; cut <= 3; cut++) if (t.length - cut >= 3) out.push(t.slice(0, t.length - cut).trim());
  const words = t.split(" ");
  if (words.length > 1) for (const w of words) if (w.length >= 4) out.push(w);
  return [...new Set(out)].slice(0, 5);
}

/** The candidates close enough to the text to suggest, closest first. */
export function rank(typed: string, candidates: Iterable<string>, limit = 5): string[] {
  const len = normalize(typed).length;
  const max = Math.max(2, Math.ceil(len * 0.4));
  return [...new Set(candidates)]
    .filter((name) => !/^(.+) \/\/ \1$/.test(name)) // art-series cards ("Sol Ring // Sol Ring")
    .map((name) => ({ name, d: distance(typed, name) }))
    .filter((c) => c.d <= max)
    .sort((a, z) => a.d - z.d || a.name.length - z.name.length)
    .slice(0, limit)
    .map((c) => c.name);
}
