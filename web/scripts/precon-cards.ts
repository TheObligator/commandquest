// Writes public/precon-cards/<deck id>.json: the Scryfall data the precon deck view needs for each
// card (see PreconCardsFile in src/precons.ts). Run by `npm run precons` after it writes
// precons.json, so the nightly Forge sync keeps these files current too.
//
// Incremental: cards already in some deck's file are reused, so after the first run only new decks
// (or changed cards) go to Scryfall. If Scryfall can't be reached, decks it couldn't finish get no
// file and the site falls back to looking their cards up in the browser.
//
// Follows https://scryfall.com/docs/api: a User-Agent and Accept header on every request, and at
// most 2 /cards/collection requests per second.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deckKeys, type Precon, type PreconCardData, type PreconCardsFile } from "../src/precons.ts";

const API = "https://api.scryfall.com/cards/collection";
const GAP_MS = 550;
const HEADERS = { "User-Agent": "CommandQuestPreconBuilder/1.0", Accept: "application/json", "Content-Type": "application/json" };

interface ScryCard {
  id: string;
  name: string;
  set: string;
  collector_number: string;
  layout?: string;
  cmc?: number;
  type_line?: string;
  mana_cost?: string;
  card_faces?: { name: string; mana_cost?: string; cmc?: number; type_line?: string; image_uris?: unknown }[];
}

type Identifier = { set: string; collector_number: string } | { name: string; set?: string };

/** What we keep of a Scryfall card. A reversible card (both sides the same card, as in some Secret
 *  Lairs) has its cost and type only on its faces, so those come from the front. */
export function toData(c: ScryCard): PreconCardData {
  const front = c.card_faces?.[0];
  const faceCosts = c.layout === "reversible_card" ? [front?.mana_cost] : c.card_faces?.map((f) => f.mana_cost);
  const mana = c.mana_cost ?? faceCosts?.filter(Boolean).join(" // ") ?? "";
  return [c.id, c.set, c.collector_number, c.cmc ?? front?.cmc ?? 0, c.type_line ?? front?.type_line ?? "", mana, c.card_faces?.[1]?.image_uris ? 1 : 0];
}

/** Whether saved data is complete (files from before reversible cards were handled lack a type). */
const complete = (d: PreconCardData | null) => d === null || (typeof d[3] === "number" && typeof d[4] === "string");

/** How Scryfall's collection lookup finds a card key: by set and number, name and set, or just name. */
export function identifierFor(key: string, byNameOnly = false): Identifier {
  const [fullName, set, cn] = key.split("|");
  // Scryfall's collection lookup doesn't know split cards' "A // B" names, only "A".
  const name = fullName.split(" // ")[0];
  if (byNameOnly || !set) return { name };
  return cn ? { set, collector_number: cn } : { name, set };
}

/** Whether a returned card answers this identifier. */
export function answers(c: ScryCard, id: Identifier): boolean {
  if ("collector_number" in id) return c.set === id.set && c.collector_number === id.collector_number;
  const n = id.name.toLowerCase();
  const named = c.name.toLowerCase() === n || c.name.toLowerCase().startsWith(`${n} // `) || c.card_faces?.[0]?.name.toLowerCase() === n;
  return named && (!id.set || c.set === id.set);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Looks up these keys, 75 per request. Unknown cards map to null; keys left out failed to load. */
async function lookUp(keys: string[], byNameOnly: boolean, log: (s: string) => void): Promise<Map<string, PreconCardData | null>> {
  const out = new Map<string, PreconCardData | null>();
  const retry: string[] = [];
  const unknown: string[] = [];
  for (let i = 0; i < keys.length; i += 75) {
    const batch = keys.slice(i, i + 75);
    const ids = batch.map((k) => identifierFor(k, byNameOnly));
    let data: { data: ScryCard[] } | undefined;
    for (let attempt = 0; attempt < 3 && !data; attempt++) {
      await sleep(attempt ? 30_000 : GAP_MS);
      try {
        const res = await fetch(API, { method: "POST", headers: HEADERS, body: JSON.stringify({ identifiers: ids }) });
        if (res.ok) data = (await res.json()) as { data: ScryCard[] };
        else log(`Scryfall answered ${res.status}${res.status === 429 ? ", waiting 30 seconds" : ""}`);
      } catch (e) {
        log(`Couldn't reach Scryfall: ${(e as Error).message}`);
      }
    }
    if (!data) continue; // these keys stay unknown; their decks get no file this time
    const found = data.data;
    batch.forEach((k, j) => {
      const card = found.find((c) => answers(c, ids[j]));
      if (card) out.set(k, toData(card));
      else if (!byNameOnly && k.split("|")[1]) retry.push(k); // a printing Scryfall doesn't have: try any printing
      else unknown.push(k);
    });
    log(`Looked up ${Math.min(i + 75, keys.length)} of ${keys.length} cards${byNameOnly ? " by name" : ""}`);
  }
  if (retry.length) for (const [k, v] of await lookUp(retry, true, log)) out.set(k, v);
  // Last try, one at a time: a fuzzy name match (Forge writes "Lim-Dul's Vault", Scryfall "Lim-Dûl's Vault").
  for (const k of unknown) {
    await sleep(GAP_MS);
    try {
      const res = await fetch(`https://api.scryfall.com/cards/named?${new URLSearchParams({ fuzzy: k.split("|")[0] })}`, { headers: HEADERS });
      out.set(k, res.ok ? toData((await res.json()) as ScryCard) : null);
    } catch {
      // Unreachable: the key stays unknown, so its decks get no file this time.
    }
  }
  return out;
}

/** Brings `dir` in line with the decks: reuses what's there, looks up the rest, removes old files. */
export async function writePreconCards(decks: Precon[], dir: string, log: (s: string) => void = console.log): Promise<{ written: number; missing: number }> {
  mkdirSync(dir, { recursive: true });
  const known = new Map<string, PreconCardData | null>();
  const ids = new Set(decks.map((d) => d.id));
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    if (!ids.has(f.slice(0, -5))) {
      rmSync(join(dir, f));
      continue;
    }
    try {
      const file = JSON.parse(readFileSync(join(dir, f), "utf8")) as PreconCardsFile;
      for (const [k, v] of Object.entries(file.cards)) if (complete(v)) known.set(k, v);
    } catch {
      // Unreadable: it's rewritten below.
    }
  }

  const todo = [...new Set(decks.flatMap(deckKeys))].filter((k) => !known.has(k));
  if (todo.length) for (const [k, v] of await lookUp(todo, false, log)) known.set(k, v);

  let written = 0;
  let missing = 0;
  for (const d of decks) {
    const path = join(dir, `${d.id}.json`);
    const keys = deckKeys(d);
    if (keys.some((k) => !known.has(k))) {
      missing++;
      if (existsSync(path)) rmSync(path);
      continue;
    }
    const file: PreconCardsFile = { cards: Object.fromEntries(keys.map((k) => [k, known.get(k)!])) };
    const text = JSON.stringify(file) + "\n";
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
    written++;
  }
  return { written, missing };
}

