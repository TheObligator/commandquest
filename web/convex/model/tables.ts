// Pure rules behind multiplayer tables (convex/tables.ts, docs/tables.md): invite codes, table
// settings, who becomes host when the host leaves, and when a game can start. No Convex imports,
// so `npm test` covers it directly.

export class TableError extends Error {}

/** Seats at a table, counting AI seats. Commander games here are 2 to 4 players. */
export const MIN_SEATS = 2;
export const MAX_SEATS = 4;
/** Highest rewind level (forge-web-server Rewind.MAX_LEVEL). */
export const MAX_REWIND = 4;
/** A seated player whose lobby page hasn't checked in for this long has left (while not playing). */
export const AWAY_MS = 60_000;
/** Tables nobody has touched for this long are closed by the hourly cleanup. */
export const IDLE_TABLE_MS = 6 * 60 * 60 * 1000;

/** Invite codes: no 0/O/1/I/L, so a code read aloud or typed by hand comes out right. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 10;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** A new invite code from random bytes (about 50 bits: links can't be guessed). */
export function makeCode(random: Uint8Array): string {
  if (random.length < CODE_LENGTH) throw new Error("Need more random bytes");
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[random[i] % CODE_ALPHABET.length];
  return out;
}

/** A pasted invite (the code, or a whole link ending in it), normalized; null if it isn't one. */
export function parseCode(input: string): string | null {
  const m = /([A-Za-z0-9]+)\s*$/.exec(input.trim().replace(/[-\s]/g, ""));
  if (!m) return null;
  const code = m[1].slice(-CODE_LENGTH).toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** The secret the game server uses to fetch the roster of a starting game: 128 random bits, hex. */
export function makeGameKey(random: Uint8Array): string {
  if (random.length < 16) throw new Error("Need more random bytes");
  return Array.from(random.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const GAME_KEY_RE = /^[0-9a-f]{32}$/;

export interface TableSettings {
  name: string;
  seats: number;
  /** Seats nobody took are played by Forge AI. Off: the game is only the people at the table. */
  fillWithAI: boolean;
  freePlay: boolean;
  rewind: number;
}

export interface TableSettingsInput {
  name?: string;
  seats?: number;
  fillWithAI?: boolean;
  freePlay?: boolean;
  rewind?: number;
}

/** Checks and tidies settings; `seated` players must still fit. */
export function checkSettings(input: TableSettingsInput, base: TableSettings, seated = 0): TableSettings {
  const name = (input.name ?? base.name).trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 40) throw new TableError("Table names are 1 to 40 characters.");
  const seats = input.seats ?? base.seats;
  if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) {
    throw new TableError(`A table has ${MIN_SEATS} to ${MAX_SEATS} seats.`);
  }
  if (seats < seated) throw new TableError(`${seated} players are seated: the table needs at least ${seated} seats.`);
  const rewind = input.rewind ?? base.rewind;
  if (!Number.isInteger(rewind) || rewind < 0 || rewind > MAX_REWIND) throw new TableError("Unknown rewind level.");
  return {
    name,
    seats,
    fillWithAI: input.fillWithAI ?? base.fillWithAI,
    freePlay: input.freePlay ?? base.freePlay,
    rewind,
  };
}

export function defaultSettings(hostName: string): TableSettings {
  const owner = hostName.trim() || "Player";
  return { name: `${owner.slice(0, 32)}'s table`, seats: 4, fillWithAI: true, freePlay: true, rewind: 2 };
}

/**
 * Who takes over when the host leaves: one of the players still seated, at random. `pick` is a
 * number in [0, 1) (Math.random()). Null when nobody's left (the table closes).
 */
export function nextHost<T>(remaining: readonly T[], pick: number): T | null {
  if (remaining.length === 0) return null;
  const i = Math.min(remaining.length - 1, Math.max(0, Math.floor(pick * remaining.length)));
  return remaining[i];
}

export interface SeatState {
  userId: string;
  deckId?: string;
  ready: boolean;
}

/**
 * Why the host can't start yet, or null when they can. Every player needs a deck, everyone but
 * the host has to be ready, and without AI the table needs two people.
 */
export function cantStart(seats: readonly SeatState[], hostId: string, settings: Pick<TableSettings, "seats" | "fillWithAI">): string | null {
  if (seats.length === 0) return "Nobody's at the table.";
  if (seats.length > settings.seats) return "More players than seats.";
  if (!settings.fillWithAI && seats.length < 2) return "Invite someone, or let Forge AI fill the empty seats.";
  const noDeck = seats.filter((s) => !s.deckId).length;
  if (noDeck) return noDeck === 1 ? "A player hasn't picked a deck." : `${noDeck} players haven't picked a deck.`;
  const waiting = seats.filter((s) => s.userId !== hostId && !s.ready).length;
  if (waiting) return waiting === 1 ? "Waiting for a player to be ready." : `Waiting for ${waiting} players to be ready.`;
  return null;
}

/** How many AI seats a game starting now gets. */
export function aiSeats(humans: number, settings: Pick<TableSettings, "seats" | "fillWithAI">): number {
  return settings.fillWithAI ? Math.max(0, settings.seats - humans) : 0;
}
