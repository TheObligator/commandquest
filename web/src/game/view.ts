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
  /** The attacker this creature blocks (its name). */
  blocking?: string;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  life: number;
  poison: number;
  /** The player's other counters (Energy, Experience, Rad, Ticket…), when they have any. */
  counters?: Record<string, number>;
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
  /** Its rules text as it is on the stack (live games: Forge's, with the chosen targets). */
  text?: string;
  /** What it targets: cards (by id) and players. */
  targets?: { label: string; cardId?: number; playerId?: string }[];
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
  /** For a token: the printing its owner picked for their deck (Scryfall id). */
  tokenArt?: string;
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  commander?: boolean;
  sick?: boolean;
  attacking?: string;
  blocking?: string;
  /** For a face-down card: the players who may look at it. Public, even when the face is hidden. */
  visibleTo?: string[];
  /** Live games: kept from untapping by hand, during its next untap step or never. */
  untapLock?: "next" | "never";
  /** Live games: a double-faced permanent that can transform (by hand). */
  transformable?: boolean;
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
  /** Live games, abilities only: Forge's key for "this ability of this card", for auto-yield. */
  yieldKey?: string;
  /** You pass priority on this ability (and later ones of the same card) automatically. */
  autoYield?: boolean;
  /** Your optional ("you may") trigger: whether Forge asks, or always says yes or no. */
  optional?: boolean;
  decision?: "ASK" | "ACCEPT" | "DECLINE";
}

export interface GameView {
  viewer: string;
  /** Live games: you've turned off all your auto-yields. */
  autoYieldsOff?: boolean;
  /**
   * Live games: what Forge's current prompt lets you click. `cards` to pick or target, `players` and
   * `stack` items to target, `chosen` so far (card ids, or player ids as strings), and `actionable`
   * cards (while paying mana, the sources that can pay).
   */
  selection?: { cards: number[]; players: string[]; stack: number[]; chosen: (number | string)[]; actionable: number[]; offer?: CardView[]; seen?: CardView[] };
  /** Live games: cards Forge is showing you right now (an opponent revealing their hand…). */
  revealed?: CardView[];
  /** Live games: an auto-pass you started is still going (Forge ends it when it gets there, or when something needs you). */
  autoPassing?: boolean;
  /** Free play is on in this game: manual overrides and paying mana costs with nothing. */
  freePlay?: boolean;
  /** Players (ids) who let you search their library right now. */
  searching?: string[];
  /** Live games: your cards you can use right now (cast, play or activate). */
  playable?: number[];
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
    if (card.blocking) v.blocking = card.blocking;
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
// Each battlefield has three rows (creatures, other permanents, lands), and each row is a grid of
// cells, one card (or pile of identical cards) per cell, so cards never overlap. A new card goes in
// the first free cell of its default row, or onto a pile of identical cards there. A player can
// drag cards to any cell of any row; that's only their own view of the table, so it never goes to
// the server.

export type Row = 0 | 1 | 2;
export const ROW_LABELS = ["Creatures", "Artifacts · enchantments · planeswalkers", "Lands"] as const;

const PERMANENT_TYPES = ["Creature", "Artifact", "Enchantment", "Land", "Planeswalker", "Battle"];

/** Is this a permanent card (one that can be on the battlefield)? */
export function isPermanentCard(c: { types?: string[] }): boolean {
  return (c.types ?? []).some((t) => PERMANENT_TYPES.includes(t));
}

export function defaultRow(c: CardView): Row {
  const t = c.types ?? [];
  if (t.includes("Creature")) return 0;
  if (t.includes("Land")) return 2;
  return 1;
}

/** A card's cell: row and column (0 is the left edge). */
export interface Placement {
  row: Row;
  col: number;
}
/** Manual placements by card id. Cards without one go in the first free cell of their default row. */
export type Arrangement = Record<number, Placement>;

/** Identical cards in one cell, shown as one pile. */
export interface Pile {
  key: string;
  col: number;
  cards: CardView[];
}

function pileKey(c: CardView): string {
  if (c.hidden || c.commander) return `#${c.id}`;
  return JSON.stringify([c.name, !!c.tapped, !!c.token, !!c.sick, c.power, c.toughness, c.counters ?? null, c.attacking ?? null, c.blocking ?? null]);
}

/**
 * Splits a battlefield into its three rows of piles, each row sorted by column. Cards moved by hand
 * keep their cell. `width`: the columns a row shows. Given, the other cards are centered: a row
 * nobody arranged is laid out in the middle, and a new card joins an arranged row in the free cell
 * nearest the middle. Without it (0), they fill the first free cells from the left.
 */
export function arrange(cards: CardView[], arr: Arrangement, width = 0): [Pile[], Pile[], Pile[]] {
  const cells: Map<number, Pile>[] = [new Map(), new Map(), new Map()];
  const put = (row: Row, from: number, c: CardView) => {
    const key = pileKey(c);
    for (let col = Math.max(0, Math.floor(from)); ; col++) {
      const there = cells[row].get(col);
      if (!there) {
        cells[row].set(col, { key: `${key}@${c.id}`, col, cards: [c] });
        return;
      }
      if (pileKey(there.cards[0]) === key) {
        there.cards.push(c);
        return;
      }
    }
  };
  const unplaced: CardView[] = [];
  for (const c of cards) {
    const p = arr[c.id];
    if (p) put(p.row, p.col, c);
    else unplaced.push(c);
  }
  // Cards nobody has moved: join a pile of identical cards, or start a new one.
  const fresh: CardView[][][] = [[], [], []];
  for (const c of unplaced) {
    const row = defaultRow(c);
    const key = pileKey(c);
    const pile = [...cells[row].values()].find((x) => pileKey(x.cards[0]) === key)
      ?? fresh[row].map((cs) => ({ cards: cs })).find((x) => pileKey(x.cards[0]) === key);
    if (pile) pile.cards.push(c);
    else fresh[row].push([c]);
  }
  fresh.forEach((piles, row) => {
    const place = (col: number, cs: CardView[]) => cells[row].set(col, { key: `${pileKey(cs[0])}@${cs[0].id}`, col, cards: cs });
    if (!width) {
      // No width known: from the left, in the first free cells.
      for (const cs of piles) {
        let col = 0;
        while (cells[row].has(col)) col++;
        place(col, cs);
      }
    } else if (cells[row].size === 0) {
      // Nothing moved by hand in this row: the row is centered.
      const start = Math.max(0, Math.floor((width - piles.length) / 2));
      piles.forEach((cs, i) => place(start + i, cs));
    } else {
      // Around cards placed by hand: the free cell nearest the middle of the cards already there,
      // then nearest the middle of the row, then the left one, so the group grows evenly.
      const boardMid = (width - 1) / 2;
      for (const cs of piles) {
        const used = [...cells[row].keys()];
        const mid = (Math.min(...used) + Math.max(...used)) / 2;
        const score = (col: number) => [Math.abs(col - mid), Math.abs(col - boardMid), col];
        let best = -1;
        for (let col = 0; col <= Math.max(width, ...used) + 1; col++) {
          if (cells[row].has(col)) continue;
          if (best < 0) best = col;
          else {
            const [a, b] = [score(col), score(best)];
            if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best = col;
          }
        }
        place(best, cs);
      }
    }
  });
  return cells.map((m) => [...m.values()].sort((a, b) => a.col - b.col)) as [Pile[], Pile[], Pile[]];
}

/** Columns a row needs: up to its rightmost card. */
export const usedCols = (row: Pile[]) => (row.length ? row[row.length - 1].col + 1 : 0);

/**
 * Moves cards (a pile from the battlefield, or a card played from hand) to a cell. Every card on
 * this battlefield is pinned where it is now, so nothing else shifts. If the cell is taken, its
 * cards swap to where the moved cards came from (or, coming from the hand, move one cell right).
 */
export function moveCards(cards: CardView[], arr: Arrangement, ids: number[], row: Row, col: number, width = 0): Arrangement {
  const rows = arrange(cards, arr, width);
  const moving = new Set(ids);
  const next: Arrangement = { ...arr };
  let from: Placement | undefined;
  let occupant: Pile | undefined;
  rows.forEach((piles, r) => {
    for (const pile of piles) {
      for (const c of pile.cards) next[c.id] = { row: r as Row, col: pile.col };
      if (pile.cards.some((c) => moving.has(c.id))) from ??= { row: r as Row, col: pile.col };
      else if (r === row && pile.col === col) occupant = pile;
    }
  });
  col = Math.max(0, Math.floor(col));
  for (const id of ids) next[id] = { row, col };
  if (occupant) {
    let to: Placement = from ?? { row, col: col + 1 };
    if (!from) {
      const taken = new Set(rows[row].filter((p) => p !== occupant).map((p) => p.col));
      while (taken.has(to.col)) to = { row, col: to.col + 1 };
    }
    for (const c of occupant.cards) next[c.id] = to;
  }
  return next;
}

/** Drops placements for cards that left the battlefield (keeping `keep`, e.g. cards being played from hand). */
export function prune(arr: Arrangement, cards: CardView[], keep: Iterable<number> = []): Arrangement {
  const here = new Set([...cards.map((c) => c.id), ...keep]);
  const next: Arrangement = {};
  for (const [id, p] of Object.entries(arr)) if (here.has(Number(id))) next[Number(id)] = p;
  return next;
}

export const commanderTax = (p: PlayerState) => 2 * p.commanderCasts;
