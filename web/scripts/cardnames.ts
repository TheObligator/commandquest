// Writes public/card-names.json: every card name (and what the color identity filter needs) from
// Scryfall's daily bulk data, for the editor's instant name search (src/cardsearch.ts).
//
// vite.config.ts runs this before a build and when the dev server starts. The file isn't committed
// and isn't downloaded again within a day. If Scryfall can't be reached the build goes on: without
// the file, the search box asks Scryfall as you type. To refresh it by hand: `node scripts/cardnames.ts`.
import { mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCardNames, type BulkCard } from "../src/cardsearch.ts";

const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "card-names.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 120_000;
const HEADERS = { "User-Agent": "CommandQuest/1.0", Accept: "application/json" };

async function* bulkCards(): AsyncGenerator<BulkCard> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const get = async (url: string) => {
    const res = await fetch(url, { headers: HEADERS, signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };
  const info = (await (await get("https://api.scryfall.com/bulk-data/oracle_cards")).json()) as { jsonl_download_uri: string };
  const file = await get(info.jsonl_download_uri);
  const text = file.body!.pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream());
  let rest = "";
  for await (const chunk of text) {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop()!;
    for (const l of lines) if (l.startsWith("{")) yield JSON.parse(l) as BulkCard;
  }
  if (rest.startsWith("{")) yield JSON.parse(rest) as BulkCard;
}

/** Bring public/card-names.json up to date if it's missing or a day old. Never throws. */
export async function updateCardNames(force = false): Promise<void> {
  try {
    const age = Date.now() - statSync(OUT_FILE).mtimeMs;
    if (!force && age < MAX_AGE_MS) return;
  } catch {
    // no file yet
  }
  try {
    const cards: BulkCard[] = [];
    for await (const c of bulkCards()) cards.push(c);
    const data = buildCardNames(cards);
    if (data.names.length < 30_000) throw new Error(`only ${data.names.length} cards in the bulk data`);
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(`${OUT_FILE}.local`, JSON.stringify(data)); // *.local is gitignored
    renameSync(`${OUT_FILE}.local`, OUT_FILE);
    console.log(`card-names.json: ${data.names.length} cards`);
  } catch (e) {
    const note = `card-names.json not updated, so card search may ask Scryfall as you type: ${e instanceof Error ? e.message : e}`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${note}` : note);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await updateCardNames(true);
