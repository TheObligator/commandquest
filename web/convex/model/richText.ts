// A deck's description: rich text from the editor's Tiptap box (src/components/DeckDescription.tsx),
// stored as Tiptap's JSON. Pure (no Convex imports), so `node --test` can run it.
//
// Other people will see descriptions once decks are shared, so the server keeps only what the editor
// makes: paragraphs, two heading levels, bulleted and numbered lists, line breaks, bold, italic,
// strike, http(s) links and card names. Anything else is dropped.

import { DeckError } from "./deckRules.ts";

/** Characters of text (card names count too). */
export const MAX_DESCRIPTION_TEXT = 2000;
/** The stored JSON, which is much longer than its text. */
export const MAX_DESCRIPTION_JSON = 60_000;
const MAX_DEPTH = 8;
const MAX_CARD_NAME = 200;

export type RichMark = { type: "bold" | "italic" | "strike" } | { type: "link"; attrs: { href: string } };

export type RichNode =
  | { type: "doc"; content: RichNode[] }
  | { type: "paragraph"; content?: RichNode[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: RichNode[] }
  | { type: "bulletList"; content: RichNode[] }
  | { type: "orderedList"; attrs?: { start: number }; content: RichNode[] }
  | { type: "listItem"; content: RichNode[] }
  | { type: "hardBreak" }
  | { type: "text"; text: string; marks?: RichMark[] }
  /** A card by name: shows its image on hover. */
  | { type: "card"; attrs: { id: string } };

type Raw = { type?: unknown; attrs?: unknown; content?: unknown; marks?: unknown; text?: unknown };

const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList"]);
const SIMPLE_MARKS = new Set(["bold", "italic", "strike"]);
// Control characters (not tab), and the bidi overrides that can make text read backwards.
// eslint-disable-next-line no-control-regex
const JUNK = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g;

const asObject = (x: unknown): Raw | undefined => (x && typeof x === "object" && !Array.isArray(x) ? (x as Raw) : undefined);
const asArray = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const attrsOf = (n: Raw): Record<string, unknown> => (asObject(n.attrs) as Record<string, unknown> | undefined) ?? {};

/** An http(s) link as typed, or undefined. A bare "example.com" gets https://. */
export function cleanHref(href: unknown): string | undefined {
  if (typeof href !== "string") return undefined;
  const t = href.trim();
  if (!t || t.length > 2000) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function cleanMarks(marks: unknown): RichMark[] {
  const out: RichMark[] = [];
  for (const m of asArray(marks).map(asObject)) {
    if (!m || typeof m.type !== "string" || out.some((o) => o.type === m.type)) continue;
    if (SIMPLE_MARKS.has(m.type)) out.push({ type: m.type as "bold" | "italic" | "strike" });
    else if (m.type === "link") {
      const href = cleanHref(attrsOf(m).href);
      if (href) out.push({ type: "link", attrs: { href } });
    }
  }
  return out;
}

function cleanInline(content: unknown): RichNode[] {
  const out: RichNode[] = [];
  for (const n of asArray(content).map(asObject)) {
    if (!n) continue;
    if (n.type === "text" && typeof n.text === "string") {
      const text = n.text.replace(/[\r\n]+/g, " ").replace(JUNK, "");
      if (!text) continue;
      const marks = cleanMarks(n.marks);
      const prev = out[out.length - 1];
      // Neighbors with the same marks become one text node.
      if (prev?.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) prev.text += text;
      else out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
    } else if (n.type === "hardBreak") out.push({ type: "hardBreak" });
    else if (n.type === "card") {
      const a = attrsOf(n);
      const raw = typeof a.id === "string" ? a.id : typeof a.label === "string" ? a.label : "";
      const id = raw.replace(JUNK, "").replace(/\s+/g, " ").trim();
      if (id && id.length <= MAX_CARD_NAME) out.push({ type: "card", attrs: { id } });
    }
  }
  return out;
}

function cleanBlocks(content: unknown, depth: number): RichNode[] {
  if (depth > MAX_DEPTH) throw new DeckError("The description's lists are nested too deeply.");
  const out: RichNode[] = [];
  for (const n of asArray(content).map(asObject)) {
    if (!n || typeof n.type !== "string" || !BLOCKS.has(n.type)) continue;
    if (n.type === "paragraph" || n.type === "heading") {
      const inline = cleanInline(n.content);
      const body = inline.length ? { content: inline } : {};
      out.push(n.type === "paragraph" ? { type: "paragraph", ...body } : { type: "heading", attrs: { level: attrsOf(n).level === 3 ? 3 : 2 }, ...body });
      continue;
    }
    const items: RichNode[] = [];
    for (const item of asArray(n.content).map(asObject)) {
      if (item?.type !== "listItem") continue;
      const inner = cleanBlocks(item.content, depth + 1);
      // A list item starts with a paragraph (Tiptap won't load one that doesn't).
      if (inner[0]?.type !== "paragraph") inner.unshift({ type: "paragraph" });
      items.push({ type: "listItem", content: inner });
    }
    if (!items.length) continue;
    if (n.type === "bulletList") out.push({ type: "bulletList", content: items });
    else {
      const start = attrsOf(n).start;
      const ok = typeof start === "number" && Number.isInteger(start) && start > 1 && start < 10_000;
      out.push(ok ? { type: "orderedList", attrs: { start }, content: items } : { type: "orderedList", content: items });
    }
  }
  return out;
}

/** What a description says, as plain text: its length is what MAX_DESCRIPTION_TEXT limits. */
export function richTextOf(node: RichNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "card":
      return node.attrs.id;
    case "hardBreak":
      return "\n";
    case "doc":
    case "bulletList":
    case "orderedList":
    case "listItem":
      return node.content.map(richTextOf).join("\n");
    default:
      return (node.content ?? []).map(richTextOf).join("");
  }
}

/** The document a stored description is, cleaned; undefined when there's nothing in it. */
export function parseDescription(json: string | undefined): (RichNode & { type: "doc" }) | undefined {
  if (json && json.length > MAX_DESCRIPTION_JSON) throw new DeckError(`Descriptions are up to ${MAX_DESCRIPTION_TEXT} characters.`);
  const read = readDescription(json);
  if (read && read.text.length > MAX_DESCRIPTION_TEXT) throw new DeckError(`Descriptions are up to ${MAX_DESCRIPTION_TEXT} characters.`);
  return read?.doc;
}

/** How many characters a description has, against MAX_DESCRIPTION_TEXT (0 when there's nothing, or it can't be read). */
export function descriptionLength(json: string | undefined): number {
  try {
    return readDescription(json)?.text.length ?? 0;
  } catch {
    return 0;
  }
}

/** A description cleaned, and its text, whatever its length; undefined when there's nothing in it. */
function readDescription(json: string | undefined): { doc: RichNode & { type: "doc" }; text: string } | undefined {
  if (!json) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new DeckError("Couldn't read the description.");
  }
  const doc = asObject(raw);
  if (doc?.type !== "doc") throw new DeckError("Couldn't read the description.");
  const content = cleanBlocks(doc.content, 0);
  // Empty paragraphs at the end are left over from editing.
  while (content.length && content[content.length - 1].type === "paragraph" && !("content" in content[content.length - 1])) content.pop();
  const clean = { type: "doc" as const, content };
  const text = richTextOf(clean);
  return text.trim() ? { doc: clean, text } : undefined;
}

/** A description to store: cleaned JSON, or undefined when there's nothing in it. Throws DeckError. */
export function cleanDescription(json: string | undefined): string | undefined {
  const doc = parseDescription(json);
  return doc && JSON.stringify(doc);
}
