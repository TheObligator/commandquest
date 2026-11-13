// Builds public/precons.json, the preconstructed decks players can add to their account
// (src/pages/Precons.tsx), from Forge's deck files:
//
//   forge-gui/res/quest/commanderprecons/*.dck   Commander precons
//   forge-gui/res/quest/precons/*.dck            Other precons (theme decks, starter decks, …)
//   forge-gui/res/editions/*.txt                 Release dates, and Forge → Scryfall set codes
//
// The JSON is committed, because CI checks out only web/. After merging upstream Forge, run
// `npm run precons` and `npm run cardsupport`, and commit the results (and see what `npm run broken:check` says); tests/precons.test.ts fails while it's out of date.
//
// Pure functions are exported for the tests; running the file writes the JSON.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Precon, PreconCard } from "../src/precons.ts";

export interface Edition {
  code: string;
  scryfallCode: string;
  name: string;
  date: string;
}

/** Reads the [metadata] header of an edition file. */
export function parseEdition(text: string): Edition | null {
  const meta: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[") && line.toLowerCase() !== "[metadata]") break;
    const eq = line.indexOf("=");
    if (eq > 0) meta[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  if (!meta.code) return null;
  return { code: meta.code, scryfallCode: (meta.scryfallcode || meta.code).toLowerCase(), name: meta.name ?? meta.code, date: meta.date ?? "" };
}

export interface ParsedDck {
  meta: Record<string, string>;
  sections: Record<string, { quantity: number; name: string; set: string; collectorNumber: string }[]>;
}

/**
 * Forge's .dck format: `[section]` headers, `key=value` metadata, and card lines like
 * `2 Swamp|TDM|3` (art index) or `1 Sol Ring|FDC|[286]` (collector number). A trailing `+` on the
 * name marks a foil.
 */
export function parseDck(text: string): ParsedDck {
  const meta: Record<string, string> = {};
  const sections: ParsedDck["sections"] = {};
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1].trim().toLowerCase();
      continue;
    }
    if (section === "metadata" || section === "shop") {
      const eq = line.indexOf("=");
      if (eq > 0) meta[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
      continue;
    }
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m || !section) continue;
    const [cardName, set = "", ...rest] = m[2].split("|");
    let collectorNumber = "";
    for (const r of rest) {
      const cn = /^\[(.+)\]$/.exec(r.trim());
      if (cn) collectorNumber = cn[1];
    }
    (sections[section] ??= []).push({ quantity: Number(m[1]), name: cardName.trim().replace(/\+$/, ""), set: set.trim(), collectorNumber });
  }
  return { meta, sections };
}

/** "Abzan Armor [TDC] [2025]" → { name: "Abzan Armor", set: "TDC", year: "2025" }. */
export function splitTitle(title: string): { name: string; set?: string; year?: string } {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*\[(\d{4})\]\s*$/.exec(title);
  return m ? { name: m[1].trim(), set: m[2].trim(), year: m[3] } : { name: title.trim() };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function toPrecon(fileName: string, text: string, kind: Precon["kind"], editions: Map<string, Edition>): Precon | null {
  const { meta, sections } = parseDck(text);
  const base = fileName.replace(/\.dck$/i, "");
  const title = splitTitle(meta.name || base);
  const setCode = meta.set || title.set || "";
  const ed = editions.get(setCode.toUpperCase());
  let date = ed?.date ?? "";
  // Secret Lair and similar: the product's year, not the umbrella set's first release.
  if (title.year && !date.startsWith(title.year)) date = title.year;
  const cards = (key: string): PreconCard[] =>
    (sections[key] ?? []).map((c) => [c.quantity, c.name, c.set ? (editions.get(c.set.toUpperCase())?.scryfallCode ?? c.set.toLowerCase()) : "", c.collectorNumber]);
  const main = cards("main");
  if (!main.length) return null;
  const p: Precon = {
    id: slug(base),
    name: title.name,
    kind,
    set: ed?.scryfallCode ?? setCode.toLowerCase(),
    setName: ed?.name ?? setCode,
    date,
    commander: cards("commander"),
    main,
    side: cards("sideboard"),
  };
  if (meta.description) p.description = meta.description;
  return p;
}

/** Newest first; same date by name. Undated decks go last. */
export function byNewest(a: Precon, b: Precon): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.name.localeCompare(b.name);
}

export function buildPrecons(resDir: string): Precon[] {
  const editions = new Map<string, Edition>();
  const edDir = join(resDir, "editions");
  for (const f of readdirSync(edDir)) {
    if (!f.endsWith(".txt")) continue;
    const ed = parseEdition(readFileSync(join(edDir, f), "utf8"));
    if (ed) editions.set(ed.code.toUpperCase(), ed);
  }
  const out: Precon[] = [];
  const read = (dir: string, kind: Precon["kind"]) => {
    for (const f of readdirSync(join(resDir, dir)).sort()) {
      if (!f.endsWith(".dck")) continue;
      const p = toPrecon(f, readFileSync(join(resDir, dir, f), "utf8"), kind, editions);
      if (p) out.push(p);
    }
  };
  read("quest/commanderprecons", "commander");
  read("quest/precons", "constructed");
  const seen = new Set<string>();
  for (const p of out) {
    let id = p.id;
    for (let n = 2; seen.has(id); n++) id = `${p.id}-${n}`;
    seen.add((p.id = id));
  }
  return out.sort(byNewest);
}

const here = dirname(fileURLToPath(import.meta.url));
export const RES_DIR = join(here, "../../forge-gui/res");
export const OUT_FILE = join(here, "../public/precons.json");

/** The file contents: one deck per line, so diffs after an upstream merge stay readable. */
export function render(decks: Precon[]): string {
  return "[\n" + decks.map((d) => JSON.stringify(d)).join(",\n") + "\n]\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const decks = buildPrecons(RES_DIR);
  writeFileSync(OUT_FILE, render(decks));
  console.log(`Wrote ${decks.length} precons to ${OUT_FILE}`);
}
