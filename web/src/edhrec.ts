// EDHREC's most-played cards for a commander (json.edhrec.com, the data behind its commander pages;
// it allows browser requests). The deck search ranks results by how many of that commander's decks
// play each card.

/** One card on a commander's EDHREC page. */
export interface EdhrecCard {
  name: string;
  /** Scryfall id of a printing. */
  id: string;
  /** Share of the commander's decks that play it, 0..1. */
  inclusion: number;
}

/** EDHREC's page name for a commander or a pair ("Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"). */
export function commanderSlug(names: string[]): string {
  const one = (n: string) =>
    n
      .split(" // ")[0]
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return names.map(one).sort().join("-");
}

interface PageJson {
  container?: { json_dict?: { cardlists?: { cardviews?: { name?: string; id?: string; num_decks?: number; potential_decks?: number }[] }[] } };
}

/** The cards on a commander page, most played first, each once. */
export function parsePage(page: PageJson): EdhrecCard[] {
  const byName = new Map<string, EdhrecCard>();
  for (const list of page.container?.json_dict?.cardlists ?? []) {
    for (const v of list.cardviews ?? []) {
      if (!v.name || !v.id || !v.potential_decks) continue;
      const inclusion = (v.num_decks ?? 0) / v.potential_decks;
      const prev = byName.get(v.name);
      if (!prev || inclusion > prev.inclusion) byName.set(v.name, { name: v.name, id: v.id, inclusion });
    }
  }
  return [...byName.values()].sort((a, b) => b.inclusion - a.inclusion);
}

const pages = new Map<string, Promise<EdhrecCard[]>>();

/** A commander's (or pair's) EDHREC cards; empty when EDHREC has no page for it or can't be reached. */
export function commanderCards(names: string[]): Promise<EdhrecCard[]> {
  const slug = commanderSlug(names);
  let p = pages.get(slug);
  if (!p) {
    p = fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(parsePage)
      .catch(() => []);
    pages.set(slug, p);
  }
  return p;
}
