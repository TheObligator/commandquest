// Writes public/card-categories.json: what each card does in a deck, from Scryfall Tagger's tags in
// Scryfall's daily bulk data, for the deck editor's Group by → Category (src/cardCategories.ts).
//
// vite.config.ts runs this before a build and when the dev server starts. The file isn't committed
// and isn't downloaded again within a day. If Scryfall can't be reached, or no longer has a tag the
// rules use, the newest list at hand is used: the last one downloaded or the committed copy,
// data/card-categories.json. With neither, cards group by type.
//
// `npm run cardcategories` downloads a new list and updates the committed copy.
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCardCategories, CARD_CATEGORIES_VERSION, categorized, type BulkTag, type CardCategoriesData } from "../src/cardCategories.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(WEB, "public", "card-categories.json");
export const COPY_FILE = join(WEB, "data", "card-categories.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 120_000;
/** Fewer cards than this means the data was cut short. */
export const MIN_CARDS = 20_000;
const HEADERS = { "User-Agent": "CommandQuest/1.0", Accept: "application/json" };

async function bulkTags(): Promise<BulkTag[]> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const get = async (url: string) => {
    const res = await fetch(url, { headers: HEADERS, signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };
  const info = (await (await get("https://api.scryfall.com/bulk-data/oracle_tags")).json()) as { jsonl_download_uri: string };
  const file = await get(info.jsonl_download_uri);
  const text = await new Response(file.body!.pipeThrough(new DecompressionStream("gzip"))).text();
  return text.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as BulkTag);
}

/** When a list was built, or undefined if there's none there that this version of the site can use. */
export function builtAt(file: string): number | undefined {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as CardCategoriesData;
    const at = Date.parse(data.built);
    return data.version === CARD_CATEGORIES_VERSION && categorized(data) >= MIN_CARDS && !Number.isNaN(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

/** Download a new list. Throws, leaving the old one, if that doesn't work out. */
async function download(out: string): Promise<void> {
  const data = buildCardCategories(await bulkTags());
  const n = categorized(data);
  if (n < MIN_CARDS) throw new Error(`only ${n} cards in the bulk data`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.local`, JSON.stringify(data) + "\n"); // *.local is gitignored
  renameSync(`${out}.local`, out);
  console.log(`card-categories.json: ${n} cards`);
}

/** Make sure there's a list less than a day old, or failing that the newest there is. Never throws. */
export async function updateCardCategories({ out = OUT_FILE, copy = COPY_FILE } = {}): Promise<void> {
  const last = builtAt(out);
  if (last !== undefined && Date.now() - last < MAX_AGE_MS) {
    console.log(`card-categories.json: using the list from ${new Date(last).toISOString()}`);
    return;
  }
  try {
    await download(out);
  } catch (e) {
    const copied = builtAt(copy);
    let using = "cards will group by type";
    try {
      if (copied !== undefined && copied > (last ?? 0)) {
        mkdirSync(dirname(out), { recursive: true });
        copyFileSync(copy, out);
      } else if (last === undefined) rmSync(out, { force: true }); // unreadable, or another version's
      const at = builtAt(out);
      if (at !== undefined) using = `using the list from ${new Date(at).toISOString()}`;
    } catch {
      // couldn't write: no list, then
    }
    const note = `card-categories.json not updated (${e instanceof Error ? e.message : e}): ${using}.`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${note}` : note);
  }
}

/** Download a new list and update the committed copy from it. */
export async function refresh({ out = OUT_FILE, copy = COPY_FILE } = {}): Promise<void> {
  await download(out);
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(out, copy);
  console.log("Updated the committed copy.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await refresh();
