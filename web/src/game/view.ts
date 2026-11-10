// What one player is allowed to see of a game, and how a battlefield is laid out on screen.
// Pure logic with no DOM, so `node --test` can run it (only type imports here).
//
// The full game state lives on the server (Forge). Each player gets a view of it with hidden
// information removed: other players' hands and every library show only a count, and a face-down
// card shows only that it is there (plus public facts like tapped or counters) unless the
// player is allowed to look at it (Forge: CardView.canBeShownTo).

import type { StepId } from "./phases";

export type ZoneId = "library" | "hand" | "stack" | "battlefield" | "graveyard" | "exile" | "command";

export interface CardState {
  id: number;
  name: string;
  owner: string;
  controller: string;
  zone: ZoneId;
  /** Card types from the type line: "Creature", "Land", "Artifact", … */
  types: string[];
  tapped?: boolean;
  token?: boolean;
  /** For a token: Forge's image key ("t:r_1_1_goblin|M19|12"), used to find its Scryfall art. */
  tokenKey?: string;
  /** For a token: its printing on Scryfall (set code, collector number), when Forge knows it. */
  tokenSet?: string;
  tokenNumber?: string;
  faceDown?: boolean;
  /** Players allowed to look at this card while it's face down or in a hidden zone, besides the zone's normal rules. */
  visibleTo?: string[];
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  commander?: boolean;
  /** Came under its controller's control this turn. */
  sick?: boolean;
  /** The player this creature is attacking. */
  attacking?: string;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  life: number;
  poison: number;
  /** Combat damage taken from each player's commander, by the commander owner's id. */
  commanderDamage: Record<string, number>;
  /** Times the commander has been cast from the command zone (tax is 2 per cast). */
  commanderCasts: number;
}

export interface StackItem {
  id: number;
  controller: string;
  /** The spell's card, or undefined for an ability. */
  cardId?: number;
  name: string;
  /** "Spell", "Triggered ability", … */
  kind: string;
}

export interface GameState {
  /** In turn order. */
  players: PlayerState[];
  /** Every card. Order within a zone is array order; the last card is the top. */
  cards: CardState[];
  stack: StackItem[];
  turn: number;
  active: string;
  step: StepId;
  log: string[];
}

/** A card as one player sees it. `hidden` means its face is unknown to that player. */
export interface CardView {
  id: number;
  owner: string;
  controller: string;
  zone: ZoneId;
  hidden?: boolean;
  faceDown?: boolean;
  name?: string;
  types?: string[];
  tapped?: boolean;
  token?: boolean;
  tokenKey?: string;
  tokenSet?: string;
  tokenNumber?: string;
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  commander?: boolean;
  sick?: boolean;
  attacking?: string;
  /** For a face-down card: the players who may look at it. Public, even when the face is hidden. */
  visibleTo?: string[];
}

export interface PlayerView extends PlayerState {
  libraryCount: number;
  handCount: number;
  /** Only the viewer's own hand has cards; everyone else's is just `handCount`. */
  hand: CardView[];
  battlefield: CardView[];
  /** Top card last. */
  graveyard: CardView[];
  exile: CardView[];
  command: CardView[];
}

export interface StackItemView extends StackItem {
  card?: CardView;
}

export interface GameView {
  viewer: string;
  /** In turn order, starting with the viewer. */
  players: PlayerView[];
  stack: StackItemView[];
  turn: number;
  active: string;
  step: StepId;
  log: string[];
}

/** May `viewer` see the face of this card? */
export function canSee(card: CardState, viewer: string): boolean {
  if (card.visibleTo?.includes(viewer)) return true;
  if (card.zone === "library") return false;
  if (card.zone === "hand") return card.owner === viewer;
  if (card.faceDown) return false;
  return true;
}

/**
 * The card as `viewer` sees it. A hidden card keeps only public facts. On the battlefield,
 * `power` / `toughness` are the current values with +1/+1 and -1/-1 counters included, which is how
 * the game server (Forge) reports them.
 */
export function redact(card: CardState, viewer: string): CardView {
  const v = redactFace(card, viewer);
  const n = (card.counters?.["+1/+1"] ?? 0) - (card.counters?.["-1/-1"] ?? 0);
  if (v.zone === "battlefield" && v.power !== undefined && n) {
    v.power += n;
    v.toughness = (v.toughness ?? 0) + n;
  }
  return v;
}

function redactFace(card: CardState, viewer: string): CardView {
  if (canSee(card, viewer)) {
    const { visibleTo, ...rest } = card;
    return card.faceDown ? { ...rest, visibleTo } : { ...rest };
  }
  const v: CardView = { id: card.id, owner: card.owner, controller: card.controller, zone: card.zone, hidden: true };
  if (card.faceDown) {
    v.faceDown = true;
    // Who may look is public (you know Gonti's controller looked), the face isn't.
    if (card.visibleTo) v.visibleTo = [...card.visibleTo];
  }
  if (card.zone === "battlefield") {
    // Face-down permanents are 2/2 creatures with no name (CR 708.2); tapped and counters are public.
    v.types = ["Creature"];
    v.power = card.power ?? 2;
    v.toughness = card.toughness ?? 2;
    if (card.tapped) v.tapped = true;
    if (card.counters) v.counters = card.counters;
    if (card.attacking) v.attacking = card.attacking;
  }
  return v;
}

export function viewFor(state: GameState, viewer: string): GameView {
  const i = Math.max(0, state.players.findIndex((p) => p.id === viewer));
  const order = [...state.players.slice(i), ...state.players.slice(0, i)];
  const zone = (owner: string, z: ZoneId, by: "owner" | "controller" = "owner") =>
    state.cards.filter((c) => c.zone === z && (by === "owner" ? c.owner : c.controller) === owner);
  const cardById = new Map(state.cards.map((c) => [c.id, c]));
  return {
    viewer,
    players: order.map((p) => {
      const hand = zone(p.id, "hand");
      return {
        ...p,
        commanderDamage: { ...p.commanderDamage },
        libraryCount: zone(p.id, "library").length,
        handCount: hand.length,
        hand: p.id === viewer ? hand.map((c) => redact(c, viewer)) : [],
        battlefield: zone(p.id, "battlefield", "controller").map((c) => redact(c, viewer)),
        graveyard: zone(p.id, "graveyard").map((c) => redact(c, viewer)),
        exile: zone(p.id, "exile").map((c) => redact(c, viewer)),
        command: zone(p.id, "command").map((c) => redact(c, viewer)),
      };
    }),
    stack: state.stack.map((s) => {
      const card = s.cardId === undefined ? undefined : cardById.get(s.cardId);
      return card ? { ...s, card: redact(card, viewer) } : { ...s };
    }),
    turn: state.turn,
    active: state.active,
    step: state.step,
    log: state.log,
  };
}

// ---- Battlefield layout -----------------------------------------------------------------------
//
// Each battlefield has three rows: creatures, other permanents, lands. A player can drag cards to
// another row or position; that's only their own view of the table, so it never goes to the server.

export type Row = 0 | 1 | 2;
export const ROW_LABELS = ["Creatures", "Artifacts · enchantments · planeswalkers", "Lands"] as const;

export function defaultRow(c: CardView): Row {
  const t = c.types ?? [];
  if (t.includes("Creature")) return 0;
  if (t.includes("Land")) return 2;
  return 1;
}

export interface Placement {
  row: Row;
  pos: number;
}
/** Manual placements by card id. Cards without one go in their default row, after placed cards. */
export type Arrangement = Record<number, Placement>;

/** Identical cards next to each other in a row, shown as one pile. */
export interface Pile {
  key: string;
  cards: CardView[];
}

function pileKey(c: CardView): string {
  if (c.hidden || c.commander) return `#${c.id}`;
  return JSON.stringify([c.name, !!c.tapped, !!c.token, !!c.sick, c.power, c.toughness, c.counters ?? null]);
}

/** Splits a battlefield into its three rows of piles. */
export function arrange(cards: CardView[], arr: Arrangement): [Pile[], Pile[], Pile[]] {
  const placed = cards.map((c, i) => ({ c, p: arr[c.id] ?? { row: defaultRow(c), pos: 1e6 + i } }));
  const rows: [Pile[], Pile[], Pile[]] = [[], [], []];
  for (const row of [0, 1, 2] as Row[]) {
    const inRow = placed.filter((x) => x.p.row === row).sort((a, b) => a.p.pos - b.p.pos);
    for (const { c } of inRow) {
      const key = pileKey(c);
      const last = rows[row][rows[row].length - 1];
      if (last && pileKey(last.cards[0]) === key) last.cards.push(c);
      else rows[row].push({ key: `${key}@${c.id}`, cards: [c] });
    }
  }
  return rows;
}

/**
 * Moves cards to `row`, before the pile holding `beforeId` (or to the end). Returns a new
 * arrangement that pins every card in the target row to its new position.
 */
export function moveCards(cards: CardView[], arr: Arrangement, ids: number[], row: Row, beforeId?: number): Arrangement {
  const rows = arrange(cards, arr);
  const moving = new Set(ids);
  const order = rows[row].flatMap((p) => p.cards.map((c) => c.id)).filter((id) => !moving.has(id));
  let at = beforeId === undefined || moving.has(beforeId) ? -1 : order.indexOf(beforeId);
  if (at < 0) at = order.length;
  order.splice(at, 0, ...ids);
  const next: Arrangement = { ...arr };
  order.forEach((id, pos) => (next[id] = { row, pos }));
  return next;
}

/** Drops placements for cards that left the battlefield, so a card that comes back starts fresh. */
export function prune(arr: Arrangement, cards: CardView[]): Arrangement {
  const here = new Set(cards.map((c) => c.id));
  const next: Arrangement = {};
  for (const [id, p] of Object.entries(arr)) if (here.has(Number(id))) next[Number(id)] = p;
  return next;
}

export const commanderTax = (p: PlayerState) => 2 * p.commanderCasts;
