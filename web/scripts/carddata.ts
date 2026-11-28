// Writes public/card-data.json and public/card-data/<tag>/: every card's data, from Scryfall's daily
// bulk data, so the site can look cards up by name without Scryfall's rate-limited API
// (src/carddata.ts has the format, src/scryfall.ts reads it).
//
// vite.config.ts runs this before a build and when the dev server starts. Nothing here is committed
// (it's about 30 MB in 4096 files) and it isn't downloaded again within a day. If Scryfall can't be
// reached, the last data downloaded stays; with none, the site asks Scryfall's API as before.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCardData, CARD_DATA_VERSION, type CardDataManifest } from "../src/carddata.ts";
import type { ScryCard } from "../src/scryfall.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(WEB, "public");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 180_000;
/** Fewer cards than this means the data was cut short. */
export const MIN_CARDS = 30_000;
const HEADERS = { "User-Agent": "CommandQuest/1.0", Accept: "application/json" };

async function* bulkCards(): AsyncGenerator<ScryCard> {
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
    for (const l of lines) if (l.startsWith("{")) yield JSON.parse(l) as ScryCard;
  }
  if (rest.startsWith("{")) yield JSON.parse(rest) as ScryCard;
}

/** When the data in `dir` was built, or undefined if there's none there this version of the site can use. */
export function builtAt(dir = PUBLIC): number | undefined {
  try {
    const m = JSON.parse(readFileSync(join(dir, "card-data.json"), "utf8")) as CardDataManifest;
    const at = Date.parse(m.built);
    return m.version === CARD_DATA_VERSION && existsSync(join(dir, "card-data", m.tag)) && !Number.isNaN(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

/** Download new data. Throws, leaving the old data, if that doesn't work out. */
export async function download(dir = PUBLIC): Promise<void> {
  const cards: ScryCard[] = [];
  for await (const c of bulkCards()) cards.push(c);
  if (cards.length < MIN_CARDS) throw new Error(`only ${cards.length} cards in the bulk data`);
  // The tag is a hash of the contents, so a day with no changes keeps the same URLs (and caches).
  const { manifest, shards } = buildCardData(cards, "");
  const files = [...shards].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, list]) => [name, JSON.stringify(list)] as const);
  const hash = createHash("sha256").update(JSON.stringify(manifest.formats));
  for (const [name, text] of files) hash.update(name).update(text);
  manifest.tag = hash.digest("hex").slice(0, 12);

  // Written beside the old data (*.local is gitignored), then swapped in.
  const fresh = join(dir, "card-data.local");
  rmSync(fresh, { recursive: true, force: true });
  mkdirSync(join(fresh, manifest.tag), { recursive: true });
  for (const [name, text] of files) writeFileSync(join(fresh, manifest.tag, `${name}.json`), text);
  rmSync(join(dir, "card-data"), { recursive: true, force: true });
  renameSync(fresh, join(dir, "card-data"));
  writeFileSync(join(dir, "card-data.json.local"), JSON.stringify(manifest) + "\n");
  renameSync(join(dir, "card-data.json.local"), join(dir, "card-data.json"));
  console.log(`card-data: ${cards.length} cards in ${files.length} files (${manifest.tag})`);
}

/** Make sure there's data less than a day old, or failing that whatever there is. Never throws. */
export async function updateCardData({ dir = PUBLIC } = {}): Promise<void> {
  const last = builtAt(dir);
  if (last !== undefined && Date.now() - last < MAX_AGE_MS) {
    console.log(`card-data: using the data from ${new Date(last).toISOString()}`);
    return;
  }
  try {
    await download(dir);
  } catch (e) {
    if (last === undefined) {
      // Unreadable, or another version's: the site then asks Scryfall's API instead.
      rmSync(join(dir, "card-data.json"), { force: true });
      rmSync(join(dir, "card-data"), { recursive: true, force: true });
    }
    const using = last !== undefined ? `using the data from ${new Date(last).toISOString()}` : "the site will ask Scryfall's API";
    const note = `card-data not updated (${e instanceof Error ? e.message : e}): ${using}.`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${note}` : note);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await download();
}
