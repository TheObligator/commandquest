// Writes public/card-names.json: every card name (and what the color identity filter needs) from
// Scryfall's daily bulk data, for the editor's instant name search (src/cardsearch.ts).
//
// vite.config.ts runs this before a build and when the dev server starts. The file isn't committed
// and isn't downloaded again within a day. If Scryfall can't be reached, the newest list at hand is
// used: the last one downloaded (CI keeps it in a build cache) or the committed copy,
// data/card-names.json. With neither, the search box asks Scryfall as you type.
//
// `npm run cardnames` downloads a new list and updates the committed copy. With `--copy-weekly` the copy
// is left alone for a week (.github/workflows/card-names.yml runs that nightly).
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCardNames, CARD_NAMES_VERSION, type BulkCard, type CardNamesData } from "../src/cardsearch.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(WEB, "public", "card-names.json");
export const COPY_FILE = join(WEB, "data", "card-names.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 120_000;
/** Just under a week, so a nightly run that starts a little early still counts the seventh night. */
const COPY_AGE_MS = 6.5 * 24 * 60 * 60 * 1000;
/** Fewer cards than this means the data was cut short. */
const MIN_CARDS = 30_000;
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

/** When a list was built, or undefined if there's none there that this version of the site can use. */
export function builtAt(file: string): number | undefined {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as CardNamesData;
    const at = Date.parse(data.built);
    return data.version === CARD_NAMES_VERSION && data.names.length >= MIN_CARDS && !Number.isNaN(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

/** Download a new list. Throws, leaving the old one, if that doesn't work out. */
async function download(out: string): Promise<void> {
  const cards: BulkCard[] = [];
  for await (const c of bulkCards()) cards.push(c);
  const data = buildCardNames(cards);
  if (data.names.length < MIN_CARDS) throw new Error(`only ${data.names.length} cards in the bulk data`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.local`, JSON.stringify(data) + "\n"); // *.local is gitignored
  renameSync(`${out}.local`, out);
  console.log(`card-names.json: ${data.names.length} cards`);
}

/** Make sure there's a list less than a day old, or failing that the newest there is. Never throws. */
export async function updateCardNames({ out = OUT_FILE, copy = COPY_FILE } = {}): Promise<void> {
  const last = builtAt(out);
  if (last !== undefined && Date.now() - last < MAX_AGE_MS) {
    console.log(`card-names.json: using the list from ${new Date(last).toISOString()}`);
    return;
  }
  try {
    await download(out);
  } catch (e) {
    const copied = builtAt(copy);
    let using = "card search will ask Scryfall as you type";
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
    const note = `card-names.json not updated (${e instanceof Error ? e.message : e}): ${using}.`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${note}` : note);
  }
}

/** Download a new list, and update the committed copy from it (with `weekly`, only if that's a week old). */
export async function refresh({ out = OUT_FILE, copy = COPY_FILE, weekly = false } = {}): Promise<void> {
  await download(out);
  const copied = builtAt(copy);
  if (weekly && copied !== undefined && Date.now() - copied < COPY_AGE_MS) return;
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(out, copy);
  console.log("Updated the committed copy.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await refresh({ weekly: process.argv.includes("--copy-weekly") });
}
