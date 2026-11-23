// Which piles you're choosing cards from, when they aren't out on the battlefield: a graveyard or
// exile (Chun-Li's "exile up to X target instant cards from your graveyard"), a library you're
// searching, a hand. The pick window shows each pile with the cards you can choose first, and the
// rest of the pile (what you can see of it) after them, dimmed.
//
// Two kinds of question get it: Forge's click-to-choose prompts (`selection`: targets, "select
// cards"), and asks whose options are all such cards (tutors, "return a card from your graveyard"…).
import type { LiveAsk } from "./useLiveGame";
import type { CardView, GameView } from "./view";

export interface PickPile {
  /** "you/graveyard" */
  key: string;
  /** "Your graveyard", "Alice's exile" */
  title: string;
  /** The cards you can choose, top of the pile first. */
  choosable: CardView[];
  /** The rest of the pile you can see, top first. */
  others: CardView[];
}

const ZONE_WORD: Record<string, string> = { graveyard: "graveyard", exile: "exile", library: "library", hand: "hand", command: "command zone" };
const ORDER = ["graveyard", "exile", "library", "hand", "command"];
/** Zones the pick window is for: everything but the battlefield and the stack. */
const PILE_ZONES = new Set(ORDER);

/** The piles to choose from for Forge's current prompt; empty when it only wants things on the table (or nothing). */
export function pickPiles(view: GameView): PickPile[] {
  const sel = view.selection;
  if (!sel) return [];
  const wanted = new Set(sel.cards);
  const choosable: CardView[] = [];
  // Graveyards and exile are on the table, but only as the top card of a pile.
  for (const pl of view.players) for (const c of [...pl.graveyard, ...pl.exile]) if (wanted.has(c.id)) choosable.push(c);
  // Cards from places the table doesn't show at all (your library while you search it…).
  choosable.push(...(sel.offer ?? []));
  return pilesFor(view, choosable, sel.seen ?? []);
}

/**
 * The cards a question asks you to choose among, when the pick window is the way to answer it: a
 * "choose" ask whose options are all cards off the battlefield and out of your hand (those you click
 * where they are, `askBoard`). Null otherwise.
 */
export function askPickCards(ask: LiveAsk | null | undefined, viewer: string): CardView[] | null {
  if (!choosing(ask)) return null;
  const cards: CardView[] = [];
  for (const o of ask.options!) {
    if (!o.card || !PILE_ZONES.has(o.card.zone) || onBoard(o.card, viewer)) return null;
    cards.push(o.card);
  }
  // Two options for one card would be two answers we couldn't tell apart.
  return new Set(cards.map((c) => c.id)).size === cards.length ? cards : null;
}

/**
 * A question you answer by clicking on the table (sacrifice a permanent, discard from your hand,
 * choose a player): every option is a permanent, a card in your hand or a player. Option index by
 * card id and by player id; null otherwise.
 */
export function askBoard(ask: LiveAsk | null | undefined, viewer: string): { cards: Map<number, number>; players: Map<string, number> } | null {
  if (!choosing(ask)) return null;
  const cards = new Map<number, number>();
  const players = new Map<string, number>();
  ask.options!.forEach((o, i) => {
    if (o.card && onBoard(o.card, viewer)) cards.set(o.card.id, i);
    else if (o.playerId && !o.card) players.set(o.playerId, i);
  });
  // Players alone are a window (Choose a player); with permanents, they're clicked like targets.
  if (!cards.size || cards.size + players.size !== ask.options!.length) return null;
  return { cards, players };
}

function choosing(ask: LiveAsk | null | undefined): ask is LiveAsk {
  return !!ask && ask.kind === "choose" && !ask.mana && !ask.yesNo && !!ask.options?.length && ask.max >= 1;
}

/** On the battlefield, or in your own hand (the hand bar shows it). */
function onBoard(c: CardView, viewer: string) {
  return c.zone === "battlefield" || (c.zone === "hand" && c.owner === viewer);
}

/** Groups the cards into their piles, and adds what else you can see of each graveyard and exile. */
export function pilesFor(view: GameView, choosable: CardView[], seen: CardView[] = []): PickPile[] {
  const piles = new Map<string, PickPile>();
  const nameOf = (id: string) => (id === view.viewer ? "Your" : `${view.players.find((p) => p.id === id)?.name ?? id}'s`);
  const pile = (owner: string, zone: string) => {
    const key = `${owner}/${zone}`;
    let p = piles.get(key);
    if (!p) {
      p = { key, title: `${nameOf(owner)} ${ZONE_WORD[zone] ?? zone}`, choosable: [], others: [] };
      piles.set(key, p);
    }
    return p;
  };
  const wanted = new Set(choosable.map((c) => c.id));
  for (const c of choosable) pile(c.owner, c.zone);
  for (const p of piles.values()) {
    const [owner, zone] = p.key.split("/");
    const pl = view.players.find((x) => x.id === owner);
    const shown = zone === "graveyard" || zone === "exile" ? pl?.[zone] : undefined;
    if (shown) {
      // The whole pile, top first, in the table's order.
      for (const c of [...shown].reverse()) (wanted.has(c.id) ? p.choosable : p.others).push(c);
    }
  }
  // Cards the pile above didn't place (it's not on the table, or the table hasn't caught up).
  const placed = new Set([...piles.values()].flatMap((p) => p.choosable.map((c) => c.id)));
  for (const c of choosable) if (!placed.has(c.id)) pile(c.owner, c.zone).choosable.push(c);
  for (const c of seen) piles.get(`${c.owner}/${c.zone}`)?.others.push(c);
  return [...piles.values()].sort((a, b) => {
    const [ao, az] = a.key.split("/");
    const [bo, bz] = b.key.split("/");
    const mine = Number(bo === view.viewer) - Number(ao === view.viewer);
    return mine || ORDER.indexOf(az) - ORDER.indexOf(bz);
  });
}
