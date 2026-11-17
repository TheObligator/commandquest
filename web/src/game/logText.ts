// Game log lines name cards as Forge writes them, "Forgotten Cave (1138)": the name, then the
// card's id. These split a line into plain text and card names you can hover. Pure, so
// `node --test` runs it.

export type LogPart = string | { id: number; name: string };

/**
 * Splits a log line into text and cards. A "Name (id)" becomes a card when `nameOf(id)` knows that
 * card and the text before the id ends with its name; the id itself is dropped. Anything else
 * stays as written.
 */
export function logParts(line: string, nameOf: (id: number) => string | undefined): LogPart[] {
  const parts: LogPart[] = [];
  let last = 0;
  for (const m of line.matchAll(/ ?\((\d+)\)/g)) {
    const id = Number(m[1]);
    const name = nameOf(id);
    const before = line.slice(last, m.index);
    if (!name || !before.endsWith(name)) continue;
    if (before.length > name.length) parts.push(before.slice(0, -name.length));
    parts.push({ id, name });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}
