// Builds public/card-support.json: which cards work in games. The deck editor marks every other
// card (src/cardsupport.ts), so a new Scryfall card is marked until Forge, or we, make it work.
//
//   forge-gui/res/cardsfolder/**/*.txt   Forge's card scripts: a card works if Forge has one
//   overrides/broken.json                Cards Forge has but that we know misbehave, with why
//
// The JSON is committed, because CI checks out only web/. After merging upstream Forge, or editing
// overrides/broken.json, run `npm run cardsupport` and commit the result; tests/cardsupport.test.ts
// fails while it's out of date.
//
// Pure functions are exported for the tests; running the file writes the JSON.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardSupportData } from "../src/cardsupport.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const CARDS_DIR = join(ROOT, "forge-gui", "res", "cardsfolder");
export const BROKEN_FILE = join(ROOT, "overrides", "broken.json");
export const OUT_FILE = join(here, "..", "public", "card-support.json");

/**
 * A card script's names: the first `Name:` line, plus "Front // Back" for split cards (Forge
 * scripts both halves of Fire // Ice in one file, the second after `ALTERNATE`).
 */
export function scriptNames(text: string): string[] {
  const names: string[] = [];
  let split = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("Name:")) names.push(line.slice(5).trim());
    else if (line === "AlternateMode:Split") split = true;
  }
  if (!names.length) return [];
  return split && names.length > 1 ? [names[0], `${names[0]} // ${names[1]}`] : [names[0]];
}

export interface BrokenEntry {
  /** Shown to players on hover. */
  reason: string;
  /** The Forge bug report: remove the entry once it's fixed and merged. */
  issue?: string;
  date?: string;
}

export function buildSupport(cardsDir: string, brokenFile: string): CardSupportData {
  const names = new Set<string>();
  for (const letter of readdirSync(cardsDir, { withFileTypes: true })) {
    if (!letter.isDirectory()) continue;
    for (const f of readdirSync(join(cardsDir, letter.name))) {
      if (!f.endsWith(".txt")) continue;
      for (const n of scriptNames(readFileSync(join(cardsDir, letter.name, f), "utf8"))) names.add(n);
    }
  }
  const brokenRaw = existsSync(brokenFile) ? (JSON.parse(readFileSync(brokenFile, "utf8")) as { cards?: Record<string, BrokenEntry> }) : {};
  const broken: Record<string, string> = {};
  for (const [name, entry] of Object.entries(brokenRaw.cards ?? {}).sort(([a], [z]) => a.localeCompare(z))) {
    broken[name] = entry.reason;
  }
  return { cards: [...names].sort((a, z) => (a < z ? -1 : a > z ? 1 : 0)), broken };
}

/** One name per line, so a Forge merge shows up as a readable diff. */
export function render(data: CardSupportData): string {
  return `{\n"broken": ${JSON.stringify(data.broken)},\n"cards": [\n${data.cards.map((n) => JSON.stringify(n)).join(",\n")}\n]\n}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = buildSupport(CARDS_DIR, BROKEN_FILE);
  writeFileSync(OUT_FILE, render(data));
  console.log(`Wrote ${data.cards.length} working card names and ${Object.keys(data.broken).length} known-broken cards to ${OUT_FILE}`);
}
