// Reading a replay file (docs/replays.md): gzipped JSON from the game server's Recording.java,
// {version, meta, frames}. The first frame is the whole table, each next one a JSON merge patch
// (RFC 7386) on the one before, with cards kept once in `cards` and zones as lists of card ids.
// The log travels apart: `logAdd` lines, after cutting back to `logCut` lines (a rewind).
import type { CardView, GameView, PlayerView } from "./view";

export interface ReplayMeta {
  title: string;
  playedAt: number;
  turns: number;
  frames: number;
  players: { name: string; human: boolean; commander?: string }[];
  winner?: string;
  truncated?: boolean;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

/** One moment of the game, as recorded (players in seating order, everything face up). */
interface Frame {
  state: Obj;
  /** Which log version and how many of its lines. */
  log: { version: number; length: number };
  /** Log lines that frame added (what happened since the moment before). */
  added: string[];
}

export class Replay {
  readonly meta: ReplayMeta;
  private readonly frames: Frame[];
  private readonly logs: string[][];

  constructor(meta: ReplayMeta, frames: Frame[], logs: string[][]) {
    this.meta = meta;
    this.frames = frames;
    this.logs = logs;
  }

  get length() {
    return this.frames.length;
  }

  /** Players by id, in seating order. */
  players(): { id: string; name: string }[] {
    const ps = (this.frames[0]?.state.players ?? []) as Obj[];
    return ps.map((p) => ({ id: String(p.id), name: String(p.name) }));
  }

  turn(i: number): number {
    return Number(this.frames[i]?.state.turn ?? 0);
  }

  /** What happened right before frame `i` (its new log lines). */
  added(i: number): string[] {
    return this.frames[i]?.added ?? [];
  }

  /** Frame `i` as the table shows it, with `viewer`'s seat at the bottom. Every hand is in it. */
  view(i: number, viewer: string): GameView {
    const f = this.frames[Math.max(0, Math.min(i, this.frames.length - 1))];
    const s = f.state;
    const cards = (s.cards ?? {}) as Obj;
    const card = (id: Json) => cards[String(id)] as unknown as CardView;
    const zone = (ids: Json) => (Array.isArray(ids) ? ids.map(card).filter(Boolean) : []);
    const seats = ((s.players ?? []) as Obj[]).map(
      (p) =>
        ({
          ...p,
          hand: zone(p.hand),
          battlefield: zone(p.battlefield),
          graveyard: zone(p.graveyard),
          exile: zone(p.exile),
          command: zone(p.command),
        }) as unknown as PlayerView,
    );
    const me = Math.max(0, seats.findIndex((p) => p.id === viewer));
    const players = seats.map((_, k) => seats[(me + k) % seats.length]);
    const log = this.logs[f.log.version].slice(0, f.log.length);
    return { ...(s as unknown as GameView), viewer: players[0]?.id ?? viewer, players, log: log.slice(-80) };
  }

  /** The first frame of each turn, with its turn number (for marks along the timeline). */
  turnStarts(): { turn: number; frame: number }[] {
    const out: { turn: number; frame: number }[] = [];
    for (let k = 0; k < this.frames.length; k++) if (k === 0 || this.turn(k) !== this.turn(k - 1)) out.push({ turn: this.turn(k), frame: k });
    return out;
  }

  /** The everyday moments (spells cast, attacks declared), drawn smaller than bookmarks. */
  minorMarks(): Bookmark[] {
    const out: Bookmark[] = [];
    for (let k = 1; k < this.frames.length; k++) {
      const f = this.frames[k];
      if (f.log.version !== this.frames[k - 1].log.version) continue;
      const events = minorEvents(this.frames[k - 1].state, f.state);
      if (events.length) out.push({ frame: k, turn: this.turn(k), events });
    }
    return out;
  }

  /** The moments worth jumping to, found by comparing each frame with the one before. */
  bookmarks(): Bookmark[] {
    const out: Bookmark[] = [];
    for (let k = 1; k < this.frames.length; k++) {
      const f = this.frames[k];
      // A rewind took the game back: what changed isn't something that happened.
      if (f.log.version !== this.frames[k - 1].log.version) continue;
      const events = momentEvents(this.frames[k - 1].state, f.state);
      if (events.length) out.push({ frame: k, turn: this.turn(k), events });
    }
    const end = this.frames.length - 1;
    if (end > 0 && this.meta.winner) {
      const win: BookmarkEvent = { kind: "win", text: `${this.meta.winner} wins` };
      const lastMark = out[out.length - 1];
      if (lastMark?.frame === end) lastMark.events.unshift(win);
      else out.push({ frame: end, turn: this.turn(end), events: [win] });
    }
    for (const b of out) b.events.sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
    return out;
  }

  /** The first frame of the turn after (or before, `dir` -1) frame `i`'s turn. */
  turnStart(i: number, dir: 1 | -1): number {
    const t = this.turn(i);
    if (dir === 1) {
      for (let k = i + 1; k < this.frames.length; k++) if (this.turn(k) > t) return k;
      return this.frames.length - 1;
    }
    // back: the start of this turn, or of the one before when already there
    let k = i;
    while (k > 0 && this.turn(k - 1) === t) k--;
    if (k < i) return k;
    if (k === 0) return 0;
    const prev = this.turn(k - 1);
    while (k > 0 && this.turn(k - 1) === prev) k--;
    return k;
  }
}

export type BookmarkKind = "win" | "out" | "wipe" | "commander" | "hit" | "spell" | "attack";

/** The most important first. */
export const KIND_ORDER: BookmarkKind[] = ["win", "out", "wipe", "commander", "hit", "attack", "spell"];

export interface BookmarkEvent {
  kind: BookmarkKind;
  text: string;
}

export interface Bookmark {
  frame: number;
  turn: number;
  /** Most important first. */
  events: BookmarkEvent[];
}

/** Life lost in one moment that counts as a big hit. */
export const BIG_HIT = 5;
/** Permanents leaving the battlefield in one moment that count as a board wipe. */
export const WIPE = 3;

/** What happened between two frames that's worth a bookmark. */
function momentEvents(before: Obj, after: Obj): BookmarkEvent[] {
  const events: BookmarkEvent[] = [];
  const pb = (before.players ?? []) as Obj[];
  const pa = (after.players ?? []) as Obj[];
  const cards = (after.cards ?? {}) as Obj;
  const cardName = (id: Json) => String((cards[String(id)] as Obj | undefined)?.name ?? "a card");
  const ids = (z: Json) => (Array.isArray(z) ? z.map(String) : []);
  let knockedOut = false;
  for (const a of pa) {
    const b = pb.find((p) => p.id === a.id);
    if (!b) continue;
    const name = String(a.name);
    const out = (p: Obj) => p.lost === true || Number(p.life) <= 0;
    if (out(a) && !out(b)) {
      knockedOut = true;
      events.push({ kind: "out", text: `${name} is out` });
    }
    if (Number(a.commanderCasts ?? 0) > Number(b.commanderCasts ?? 0)) {
      const left = ids(b.command).filter((id) => !ids(a.command).includes(id));
      events.push({ kind: "commander", text: `${name} casts ${left.length ? left.map(cardName).join(" and ") : "their commander"}` });
    }
    const lost = Number(b.life) - Number(a.life);
    if (lost >= BIG_HIT) events.push({ kind: "hit", text: `${name} loses ${lost} life (${b.life} → ${a.life})` });
  }
  // A player leaving takes their permanents along: that isn't a wipe.
  if (!knockedOut) {
    const onField = (ps: Obj[]) => new Set(ps.flatMap((p) => ids(p.battlefield)));
    const now = onField(pa);
    const gone = [...onField(pb)].filter((id) => !now.has(id));
    if (gone.length >= WIPE) {
      const stack = (before.stack ?? []) as Obj[];
      const cause = stack.length ? ` (${String(stack[stack.length - 1].name)})` : "";
      events.push({ kind: "wipe", text: `Board wipe${cause}: ${gone.length} permanents gone` });
    }
  }
  return events;
}

/** Spells put on the stack and attacks declared between two frames. */
function minorEvents(before: Obj, after: Obj): BookmarkEvent[] {
  const events: BookmarkEvent[] = [];
  const nameOf = (id: Json) => String(((after.players ?? []) as Obj[]).find((p) => p.id === id)?.name ?? "Someone");
  const had = new Set(((before.stack ?? []) as Obj[]).map((x) => x.id));
  for (const x of (after.stack ?? []) as Obj[]) {
    if (x.kind === "Spell" && !had.has(x.id)) events.push({ kind: "spell", text: `${nameOf(x.controller)} casts ${String(x.name)}` });
  }
  const cb = (before.cards ?? {}) as Obj;
  const attacks = new Map<string, number>(); // "attacker→defender" → creatures
  for (const [id, c] of Object.entries((after.cards ?? {}) as Obj)) {
    const card = c as Obj;
    if (card.attacking == null || (cb[id] as Obj | undefined)?.attacking != null) continue;
    const key = `${String(card.controller)}→${String(card.attacking)}`;
    attacks.set(key, (attacks.get(key) ?? 0) + 1);
  }
  for (const [key, n] of attacks) {
    const [from, to] = key.split("→");
    events.push({ kind: "attack", text: `${nameOf(from)} attacks ${nameOf(to)} with ${n} creature${n === 1 ? "" : "s"}` });
  }
  return events;
}

/** A JSON merge patch that copies only what changes, so frames share everything else. */
export function mergePatch(target: Json | undefined, patch: Json): Json {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out: Obj = target && typeof target === "object" && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

/** Builds a replay from the parsed file. */
export function parseReplay(file: { version?: number; meta: ReplayMeta; frames: Obj[] }): Replay {
  if (file.version !== 1) throw new Error("This replay was made by a newer version of the game.");
  const logs: string[][] = [[]];
  const frames: Frame[] = [];
  let state: Obj = {};
  for (const raw of file.frames) {
    const { logCut, logAdd, ...patch } = raw;
    let log = logs[logs.length - 1];
    if (typeof logCut === "number" && logCut < log.length) {
      log = log.slice(0, logCut);
      logs.push(log);
    }
    const added = Array.isArray(logAdd) ? logAdd.map(String) : [];
    log.push(...added);
    state = mergePatch(state, patch) as Obj;
    frames.push({ state, log: { version: logs.length - 1, length: log.length }, added });
  }
  return new Replay(file.meta, frames, logs);
}

/** Downloads and opens a replay file (gzipped JSON). */
export async function loadReplay(url: string): Promise<Replay> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the replay (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Gzip starts 1f 8b; a server may also have unzipped it on the way.
  const text =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(bytes);
  return parseReplay(JSON.parse(text));
}
