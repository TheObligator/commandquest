// Parse and write plain-text decklists. Handles the common export formats:
//   Moxfield / Arena:  "1 Sol Ring (C21) 263", with "Commander" / "Deck" / "Sideboard" headers
//   MTGO:              "4 Lightning Bolt", "SB: 2 Pyroblast"
//   Archidekt:         "1x Sol Ring (c21) 263 [Ramp]", "[Commander{top}]"
// Kept free of DOM and TypeScript-only runtime syntax so `node --test` can run it directly.

export type Board = "commander" | "main" | "side" | "maybe";

export interface ParsedCard {
  name: string;
  quantity: number;
  board: Board;
  set?: string;
  collectorNumber?: string;
}

/** A token printing listed with the deck (a "Tokens" section): used as the deck's token art. */
export interface ParsedToken {
  name: string;
  scryfallId?: string;
  set?: string;
  collectorNumber?: string;
}

export interface ParsedList {
  name?: string;
  cards: ParsedCard[];
  tokens: ParsedToken[];
  errors: string[];
}

const SECTIONS: Record<string, Board | "about" | "tokens" | "skip"> = {
  commander: "commander",
  commanders: "commander",
  companion: "side",
  deck: "main",
  main: "main",
  mainboard: "main",
  maindeck: "main",
  sideboard: "side",
  side: "side",
  maybeboard: "maybe",
  maybe: "maybe",
  considering: "maybe",
  about: "about",
  tokens: "tokens",
  token: "tokens",
  attractions: "skip",
  stickers: "skip",
};

const LINE =
  /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([^\s[*^]+))?)?((?:\s+\*[A-Za-z]+\*)*)\s*(?:\[([^\]]*)\])?\s*(?:\^[^^]*\^)?\s*$/;

export function parseDecklist(text: string): ParsedList {
  const out: ParsedList = { cards: [], tokens: [], errors: [] };
  let section: Board | "about" | "tokens" | "skip" = "main";
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;

    // Section headers: "Commander", "// Sideboard", "SIDEBOARD:", "Deck (99)"
    const header = line.replace(/^(\/\/|#)\s*/, "").replace(/\s*\(\d+\)\s*$/, "").replace(/:$/, "").trim().toLowerCase();
    if (header in SECTIONS) {
      section = SECTIONS[header];
      continue;
    }
    if (line.startsWith("//") || line.startsWith("#")) continue;
    if (section === "about") {
      const m = /^name\s+(.+)$/i.exec(line);
      if (m) out.name = m[1].trim();
      continue;
    }
    if (section === "skip") continue;

    if (section === "tokens") {
      const t = LINE.exec(line);
      if (t?.[2]) out.tokens.push({ name: t[2].trim(), ...(t[3] && { set: t[3].toLowerCase() }), ...(t[4] && { collectorNumber: t[4] }) });
      continue;
    }

    let board: Board = section;
    if (/^SB:\s*/i.test(line)) {
      board = "side";
      line = line.replace(/^SB:\s*/i, "");
    }
    const m = LINE.exec(line);
    if (!m || !m[2]) {
      out.errors.push(raw.trim());
      continue;
    }
    const quantity = m[1] ? parseInt(m[1], 10) : 1;
    const markers = (m[5] ?? "").toUpperCase();
    const categories = (m[6] ?? "").toLowerCase();
    if (markers.includes("*CMDR*") || /(^|,)\s*commander/.test(categories)) board = "commander";
    else if (/(^|,)\s*maybeboard/.test(categories)) board = "maybe";
    else if (/(^|,)\s*sideboard/.test(categories)) board = "side";

    const card: ParsedCard = { name: m[2].trim(), quantity, board };
    if (m[3]) card.set = m[3].toLowerCase();
    if (m[4]) card.collectorNumber = m[4];
    if (quantity < 1) {
      out.errors.push(raw.trim());
      continue;
    }
    out.cards.push(card);
  }
  return out;
}

const HEADINGS: [Board, string][] = [
  ["commander", "Commander"],
  ["main", "Deck"],
  ["side", "Sideboard"],
  ["maybe", "Maybeboard"],
];

/** Writes a list in the Moxfield/Arena style, which `parseDecklist` (and most sites) read back. */
export function writeDecklist(cards: ParsedCard[], withPrintings = true): string {
  const blocks: string[] = [];
  for (const [board, heading] of HEADINGS) {
    const lines = cards
      .filter((c) => c.board === board)
      .map((c) => {
        let s = `${c.quantity} ${c.name}`;
        if (withPrintings && c.set) s += ` (${c.set.toUpperCase()})${c.collectorNumber ? " " + c.collectorNumber : ""}`;
        return s;
      });
    if (lines.length) blocks.push(`${heading}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n") + "\n";
}

/** Adds up duplicate entries (same name, board and printing). */
export function mergeDuplicates<T extends ParsedCard>(cards: T[]): T[] {
  const seen = new Map<string, T>();
  const out: T[] = [];
  for (const c of cards) {
    const key = `${c.board}|${c.name.toLowerCase()}|${c.set ?? ""}|${c.collectorNumber ?? ""}`;
    const prev = seen.get(key);
    if (prev) prev.quantity += c.quantity;
    else {
      const copy = { ...c };
      seen.set(key, copy);
      out.push(copy);
    }
  }
  return out;
}
