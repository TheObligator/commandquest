// Pure rules behind convex/replays.ts (docs/replays.md): what a replay upload may say, and which
// replays a player keeps. No Convex imports, so tests/convex-model.test.ts can run them.

/** Finished games each player keeps automatically; the oldest goes when a new one comes in. */
export const MAX_RECENT = 5;
/** Games a player saved: never replaced; to save another, delete one. */
export const MAX_SAVED = 5;
/** Biggest replay file accepted (gzipped). */
export const MAX_REPLAY_BYTES = 20 * 1024 * 1024;

export class ReplayError extends Error {}

export interface ReplayPlayer {
  name: string;
  human: boolean;
  commander?: string;
}

export interface ReplayMeta {
  title: string;
  playedAt: number;
  turns: number;
  frames: number;
  players: ReplayPlayer[];
  winner?: string;
  truncated?: boolean;
  /** Ids of the players (users) who keep it. */
  users: string[];
}

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** The game server's description of a replay, checked and clipped. Throws ReplayError when it can't be used. */
export function parseReplayMeta(raw: unknown): ReplayMeta {
  if (!raw || typeof raw !== "object") throw new ReplayError("No replay description");
  const m = raw as Record<string, unknown>;
  const players: ReplayPlayer[] = (Array.isArray(m.players) ? m.players : []).slice(0, 8).map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const player: ReplayPlayer = { name: text(o.name, 60) ?? "?", human: o.human === true };
    const commander = text(o.commander, 150);
    if (commander) player.commander = commander;
    return player;
  });
  if (players.length < 2) throw new ReplayError("A replay needs at least two players");
  const users = (Array.isArray(m.users) ? m.users : []).filter((u): u is string => typeof u === "string" && u.length > 0 && u.length < 100).slice(0, 8);
  if (users.length === 0) throw new ReplayError("Nobody to keep the replay");
  const meta: ReplayMeta = {
    title: text(m.title, 200) ?? players.map((p) => p.name).join(" vs "),
    playedAt: count(m.playedAt) || Date.now(),
    turns: count(m.turns),
    frames: count(m.frames),
    players,
    users,
  };
  const winner = text(m.winner, 60);
  if (winner) meta.winner = winner;
  if (m.truncated === true) meta.truncated = true;
  return meta;
}

/** A player's unsaved replays that no longer fit among the newest MAX_RECENT. */
export function recentToDrop<T extends { saved: boolean; playedAt: number }>(links: T[]): T[] {
  return links
    .filter((l) => !l.saved)
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(MAX_RECENT);
}

/** Why a player can't save one more replay now, or null. */
export function cantSave(savedCount: number): string | null {
  return savedCount >= MAX_SAVED ? `You already have ${MAX_SAVED} saved games. Delete one to save this one.` : null;
}

/** Compares two secrets in time that doesn't depend on where they differ. */
export function sameSecret(a: string | null, b: string): boolean {
  if (a === null || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** base64url (no padding) → text, as the game server encodes the X-Replay-Meta header. */
export function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
