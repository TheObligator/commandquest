// Cards dragged in from another site (EDHREC, Scryfall, or this site's own search results): what
// the drop says about the card. EDHREC's cards are links to /cards/<slug> wrapping an image named
// by the card's Scryfall id, with the name as text; Scryfall's are links to /card/<set>/<number>/.

/** What a drop tells us, best first: a Scryfall id, a printing, an exact name, a name to guess from. */
export interface DroppedCard {
  id?: string;
  set?: string;
  collectorNumber?: string;
  name?: string;
  /** A name taken from a URL slug ("sol-ring"): needs Scryfall's fuzzy match. */
  fuzzy?: string;
  /** From another CommandQuest deck: keep its printing and number of copies. */
  exact?: boolean;
  quantity?: number;
}

/** The drag type a CommandQuest deck card carries (readable by the editor in another tab). */
export const CARD_TYPE = "application/x-commandquest-card";

type DragCard = { name: string; quantity: number; scryfallId?: string; set?: string; collectorNumber?: string };

/** What deck cards put in their drag, as `CARD_TYPE` data: one card, or a list of the selected ones. */
export function cardDragData(c: DragCard | DragCard[]): string {
  const one = (x: DragCard) => ({ name: x.name, quantity: x.quantity, id: x.scryfallId, set: x.set, collectorNumber: x.collectorNumber });
  return JSON.stringify(Array.isArray(c) ? c.map(one) : one(c));
}

/** The cards dragged from a CommandQuest deck (one, or a list), or null when the data isn't any. */
export function readDeckCards(json: string): DroppedCard[] | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  const cards = (Array.isArray(v) ? v : [v]).map(fromDeckCard).filter((c): c is DroppedCard => !!c);
  return cards.length ? cards : null;
}

/** One card dragged from a CommandQuest deck, or null when the data isn't one. */
function fromDeckCard(v: unknown): DroppedCard | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);
  const name = str(o.name);
  if (!name) return null;
  const id = str(o.id);
  const q = typeof o.quantity === "number" && Number.isInteger(o.quantity) && o.quantity > 0 ? o.quantity : 1;
  const card: DroppedCard = { name, id: id && UUID.test(id) ? id.toLowerCase() : undefined, set: str(o.set), collectorNumber: str(o.collectorNumber), exact: true, quantity: q };
  return Object.fromEntries(Object.entries(card).filter(([, x]) => x !== undefined)) as DroppedCard;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The drag carries something we might read a card from: a link, markup or text. Chromium adds the
 * image itself as a file when an image (an EDHREC card) is dragged, so files alongside are fine;
 * only files alone (from the desktop) aren't a card.
 */
export function looksLikeCard(types: readonly string[]): boolean {
  return types.some((t) => t === CARD_TYPE || t === "text/uri-list" || t === "text/html" || t === "text/plain");
}

/** Reads one URL: a card image named by its Scryfall id, an EDHREC card page, a Scryfall card page. */
function fromUrl(raw: string): DroppedCard | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, "");
  // EDHREC and Scryfall card images: .../front/a/b/<id>.jpg
  if (/\.(jpe?g|png|webp)$/i.test(u.pathname)) {
    const id = u.pathname.match(UUID)?.[0];
    return id ? { id: id.toLowerCase() } : null;
  }
  if (host === "edhrec.com") {
    const slug = u.pathname.match(/^\/(?:cards|commanders)\/([^/]+)/)?.[1];
    return slug ? { fuzzy: decodeURIComponent(slug).replace(/-/g, " ") } : null;
  }
  if (host === "scryfall.com") {
    const m = u.pathname.match(/^\/card\/([^/]+)\/([^/]+)/);
    return m ? { set: m[1], collectorNumber: decodeURIComponent(m[2]) } : null;
  }
  return null;
}

/** A card name as a person or page would write it: one short line, no URL. */
function plainName(s: string | null | undefined): string | undefined {
  const t = s?.replace(/\s+/g, " ").trim();
  return t && t.length <= 160 && !/^[a-z]+:\/\//i.test(t) && !t.includes("\n") ? t : undefined;
}

/**
 * The card a drop describes, from a CommandQuest deck card's `CARD_TYPE` data or its `text/html`, `text/uri-list` and `text/plain` data; null
 * when none of them looks like a card. `parseHtml` turns markup into a document (DOMParser in the
 * browser), so this stays testable without one.
 */
export function readDrop(
  data: { card?: string; html?: string; uris?: string; text?: string },
  parseHtml?: (html: string) => Document,
): DroppedCard | null {
  const deckCard = data.card ? readDeckCards(data.card)?.[0] : null;
  if (deckCard) return deckCard;
  const found: DroppedCard = {};
  const take = (c: DroppedCard | null) => {
    if (!c) return;
    for (const [k, v] of Object.entries(c)) (found as Record<string, unknown>)[k] ??= v;
  };

  if (data.html && parseHtml) {
    const doc = parseHtml(data.html);
    for (const img of doc.querySelectorAll("img")) {
      take(fromUrl(img.getAttribute("src") ?? ""));
      // Scryfall and most card sites give the image the card's name; EDHREC leaves it empty.
      const alt = plainName(img.getAttribute("alt"));
      if (alt && alt.toLowerCase() !== "scryfall") found.name ??= alt;
    }
    for (const a of doc.querySelectorAll("a")) {
      const href = a.getAttribute("href") ?? "";
      take(fromUrl(href.startsWith("/") ? `https://edhrec.com${href}` : href));
      found.name ??= plainName(a.textContent);
    }
  }
  for (const line of (data.uris ?? "").split(/\r?\n/)) if (line && !line.startsWith("#")) take(fromUrl(line));
  const text = data.text?.trim();
  if (text) {
    const url = fromUrl(text);
    if (url) take(url);
    else found.name ??= plainName(text);
  }
  return Object.keys(found).length ? found : null;
}
