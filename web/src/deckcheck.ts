// Deck checks shared by the deck editor (its warnings) and the Play page (which decks can start a
// game). Card data comes from `card()`, Scryfall's data for a deck entry (undefined if unknown).
import { MAX_DECK_SIZE, type Board, type DeckCard } from "../convex/model/deckRules";
import type { CardSupport } from "./cardsupport";
import { fitsIdentity, validateConquest, type OffIdentity } from "./formats/conquest";
import { canPair } from "./formats/partners";
import { noMaxDeckSize, offIdentity } from "./formats/rulebreakers";
import type { ScryCard } from "./scryfall";

export interface DeckToCheck {
  format: string;
  cards: DeckCard[];
  /** The color a Rulebreaker commander like Tolabow lets this deck add. */
  extraColor?: string;
}

export interface DeckCheck {
  /** Reasons the deck isn't legal or can't start a game. */
  problems: string[];
  /** Worth knowing, but the deck can still be played (cards known to misbehave). */
  notes: string[];
  /** Cards Forge has no rules for: games with the deck need free play, where you play them by hand. */
  needsFreePlay: string[];
}

/** The format's color identity test: Conquest relaxes hybrid symbols, Commander doesn't. */
export const identityTest = (format: string) =>
  format === "conquest" ? fitsIdentity : (card: { color_identity: string[] }, identity: Set<string>) => card.color_identity.every((x) => identity.has(x));

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (names: string[]) => names.slice(0, 6).join(", ") + (names.length > 6 ? "…" : "");

/** Everything wrong with a deck for its format, and for starting a game with it. */
export function checkDeck(
  deck: DeckToCheck,
  card: (c: DeckCard) => ScryCard | undefined,
  support?: CardSupport,
  /** Names Scryfall didn't recognise, when the caller knows them (else: cards without data). */
  knownMissing?: string[],
): DeckCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  let needsFreePlay: string[] = [];
  const played = deck.cards.filter((c) => c.board === "main" || c.board === "commander");
  const count = (board?: Board) => deck.cards.filter((c) => (board ? c.board === board : c.board === "main" || c.board === "commander")).reduce((n, c) => n + c.quantity, 0);
  const missing = knownMissing ?? played.filter((c) => !card(c)).map((c) => c.name);
  if (missing.length) problems.push(`Scryfall doesn't know: ${list(missing)}. Check the spelling.`);
  if (support) {
    const status = played.filter((c) => card(c)).map((c) => [c, support.status(card(c) ?? c.name)] as const);
    const absent = status.filter(([, st]) => !st.works && st.missing).map(([c]) => c.name);
    const issues = status.filter(([, st]) => !st.works && !st.missing).map(([c]) => c.name);
    needsFreePlay = absent;
    if (absent.length) notes.push(`Not in the rules engine yet: ${list(absent)}. Games with this deck need free play, where you play ${absent.length === 1 ? "it" : "them"} by hand.`);
    if (issues.length) notes.push(`Known not to work right in games: ${list(issues)}.`);
  }
  const total = count();
  if (total > MAX_DECK_SIZE) problems.push(`Games allow at most ${MAX_DECK_SIZE} cards (this deck has ${total}).`);
  const fmt = deck.format;
  if (fmt === "conquest") {
    const off: OffIdentity = (main, cmdrs) => offIdentity(main, cmdrs, fitsIdentity, deck.extraColor);
    problems.push(...validateConquest(deck.cards.map((c) => ({ ...c, card: card(c) })), off));
    return { problems, notes, needsFreePlay };
  }
  if (fmt === "commander") {
    const cmdrs = deck.cards.filter((c) => c.board === "commander");
    const cmdrCards = cmdrs.flatMap((c) => card(c) ?? []);
    if (!cmdrs.length) problems.push("No commander yet. Use ★ on a search result or move a card to the Commander board.");
    if (cmdrs.reduce((n, c) => n + c.quantity, 0) > 2) problems.push("A deck can have at most two commanders.");
    else if (cmdrs.length === 2 && cmdrCards.length === 2 && !canPair(cmdrCards[0], cmdrCards[1])) {
      problems.push(`${cmdrs[0].name} and ${cmdrs[1].name} can't be commanders together: two commanders need partner, partner with each other, a Background, or a Doctor and companion.`);
    }
    if (noMaxDeckSize(cmdrCards)) {
      if (total < 100) problems.push(`Commander decks have at least 100 cards (this one has ${total}). Its commander lifts the maximum.`);
    } else if (total !== 100) problems.push(`Commander decks have exactly 100 cards (this one has ${total}).`);
    const main = deck.cards.flatMap((c) => {
      const s = c.board === "main" ? card(c) : undefined;
      return s ? [{ name: c.name, card: s }] : [];
    });
    const offColor = cmdrs.length ? offIdentity(main, cmdrCards, identityTest("commander"), deck.extraColor).map((e) => e.name) : [];
    const dupes: string[] = [];
    for (const c of deck.cards) {
      if (c.board !== "main") continue;
      const s = card(c);
      if (!s) continue;
      const unlimited = /Basic/.test(s.type_line) || /any number of cards named/i.test(s.oracle_text ?? "");
      if (c.quantity > 1 && !unlimited) dupes.push(c.name);
    }
    if (offColor.length) problems.push(`Outside the commander's colors: ${list(offColor)}.`);
    if (dupes.length) problems.push(`Commander is singleton, but there are multiples of: ${list(dupes)}.`);
  }
  if (fmt !== "other") {
    const illegal = deck.cards
      .filter((c) => c.board !== "maybe")
      .filter((c) => {
        const l = card(c)?.legalities?.[fmt];
        return l === "banned" || l === "not_legal";
      })
      .map((c) => c.name);
    if (illegal.length) problems.push(`Not legal in ${capitalize(fmt)}: ${list(illegal)}.`);
  }
  return { problems, notes, needsFreePlay };
}

/** Whether a deck can be used in a game: what stops it, and cards that need free play. */
export interface GameCheck {
  /** Why it can't start a game ([] when it can). */
  problems: string[];
  /** Cards Forge doesn't have, played by hand: the game needs free play on. */
  needsFreePlay: string[];
}

/** A deck checked for a game (games are Commander; a deck saved under another format is checked as one). */
export function gameCheck(deck: DeckToCheck, card: (c: DeckCard) => ScryCard | undefined, support?: CardSupport): GameCheck {
  const { problems, needsFreePlay } = checkDeck({ ...deck, format: "commander" }, card, support);
  return { problems, needsFreePlay };
}
