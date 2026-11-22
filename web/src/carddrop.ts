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
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The drag carries something we might read a card from: a link, markup or text. Chromium adds the
 * image itself as a file when an image (an EDHREC card) is dragged, so files alongside are fine;
 * only files alone (from the desktop) aren't a card.
 */
export function looksLikeCard(types: readonly string[]): boolean {
  return types.some((t) => t === "text/uri-list" || t === "text/html" || t === "text/plain");
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
 * The card a drop describes, from its `text/html`, `text/uri-list` and `text/plain` data; null
 * when none of them looks like a card. `parseHtml` turns markup into a document (DOMParser in the
 * browser), so this stays testable without one.
 */
export function readDrop(
  data: { html?: string; uris?: string; text?: string },
  parseHtml?: (html: string) => Document,
): DroppedCard | null {
  const found: DroppedCard = {};
  const take = (c: DroppedCard | null) => {
    if (!c) return;
    for (const k of Object.keys(c) as (keyof DroppedCard)[]) found[k] ??= c[k];
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
