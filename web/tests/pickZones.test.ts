import { test } from "node:test";
import assert from "node:assert/strict";
import { askPickCards, pickPiles, pilesFor } from "../src/game/pickZones.ts";
import type { LiveAsk } from "../src/game/useLiveGame.ts";
import type { CardView, GameView, PlayerView } from "../src/game/view.ts";

const card = (id: number, owner: string, zone: string, name = `Card ${id}`) => ({ id, owner, controller: owner, zone, name }) as CardView;
const player = (id: string, name: string, graveyard: CardView[] = [], exile: CardView[] = []) =>
  ({ id, name, life: 40, libraryCount: 50, handCount: 0, hand: [], battlefield: [], graveyard, exile, command: [] }) as unknown as PlayerView;
const game = (players: PlayerView[], selection?: GameView["selection"]) =>
  ({ viewer: "me", players, stack: [], turn: 1, active: "me", step: "main1", log: [], selection }) as unknown as GameView;
const sel = (cards: number[], extra: Partial<NonNullable<GameView["selection"]>> = {}) => ({ cards, players: [], stack: [], chosen: [], actionable: [], ...extra });

test("pickPiles: nothing without a prompt choosing cards in a pile", () => {
  const gy = [card(1, "me", "graveyard")];
  assert.deepEqual(pickPiles(game([player("me", "Me", gy)])), []);
  assert.deepEqual(pickPiles(game([player("me", "Me", gy)], sel([99]))), []); // a card on the battlefield
});

test("pickPiles: a graveyard target (Chun-Li) shows the choosable cards first, top first, the rest after", () => {
  // Top card last in the view: 3 is on top.
  const gy = [card(1, "me", "graveyard", "Opt"), card(2, "me", "graveyard", "Forest"), card(3, "me", "graveyard", "Brainstorm")];
  const [p, ...more] = pickPiles(game([player("me", "Me", gy), player("al", "Alice", [card(9, "al", "graveyard")])], sel([1, 3])));
  assert.equal(more.length, 0);
  assert.equal(p.title, "Your graveyard");
  assert.deepEqual(p.choosable.map((c) => c.id), [3, 1]);
  assert.deepEqual(p.others.map((c) => c.id), [2]);
});

test("pickPiles: your piles first, then by zone; offered library cards with what's also seen", () => {
  const view = game(
    [player("me", "Me", [], [card(5, "me", "exile")]), player("al", "Alice", [card(6, "al", "graveyard")])],
    sel([5, 6, 7], { offer: [card(7, "me", "library", "Island")], seen: [card(8, "me", "library", "Plains")] }),
  );
  const piles = pickPiles(view);
  assert.deepEqual(piles.map((p) => p.title), ["Your exile", "Your library", "Alice's graveyard"]);
  assert.deepEqual(piles[1].choosable.map((c) => c.id), [7]);
  assert.deepEqual(piles[1].others.map((c) => c.id), [8]);
});

const ask = (cards: (CardView | undefined)[], extra: Partial<LiveAsk> = {}) =>
  ({ id: 1, kind: "choose", message: "Choose a card", min: 1, max: 1, options: cards.map((c, i) => ({ label: c?.name ?? `Option ${i}`, card: c })), ...extra }) as LiveAsk;

test("askPickCards: a question choosing among cards off the battlefield goes to the pick window", () => {
  const gy = [card(1, "me", "graveyard"), card(2, "me", "graveyard")];
  assert.deepEqual(askPickCards(ask(gy))?.map((c) => c.id), [1, 2]);
  assert.deepEqual(askPickCards(ask([card(3, "me", "library"), card(4, "al", "hand")]))?.map((c) => c.id), [3, 4]);
});

test("askPickCards: anything else stays a list", () => {
  assert.equal(askPickCards(null), null);
  assert.equal(askPickCards(ask([card(1, "me", "graveyard"), card(2, "me", "battlefield")])), null); // a permanent among them
  assert.equal(askPickCards(ask([card(1, "me", "graveyard"), undefined])), null); // an option that isn't a card
  assert.equal(askPickCards(ask([card(1, "me", "graveyard")], { kind: "order" })), null);
  assert.equal(askPickCards(ask([card(1, "me", "graveyard"), card(1, "me", "graveyard")])), null); // one card twice
});

test("pilesFor: a graveyard ask shows the rest of that graveyard, dimmed", () => {
  const gy = [card(1, "me", "graveyard"), card(2, "me", "graveyard"), card(3, "me", "graveyard")];
  const view = game([player("me", "Me", gy)]);
  const [p] = pilesFor(view, [gy[0]]);
  assert.deepEqual(p.choosable.map((c) => c.id), [1]);
  assert.deepEqual(p.others.map((c) => c.id), [3, 2]);
});
