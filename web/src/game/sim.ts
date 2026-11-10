// A stand-in for the Forge server so the table can be tried before game sessions exist: four
// Commander decks, simple opponents that play lands, cast spells, attack, and sometimes counter
// your spells. None of these rules are meant to be right; the server will run the real game.
import { STEPS, type StepId } from "./phases";
import type { CardState, GameState, PlayerState, ZoneId } from "./view";

interface CardDef {
  types: string[];
  power?: number;
  toughness?: number;
}

const L = ["Land"];
const A = ["Artifact"];
const E = ["Enchantment"];
const I = ["Instant"];
const S = ["Sorcery"];
const C = (power: number, toughness: number, ...extra: string[]): CardDef => ({ types: [...extra, "Creature"], power, toughness });

const CATALOG: Record<string, CardDef> = {
  // Lands
  Forest: { types: L }, Island: { types: L }, Plains: { types: L }, Swamp: { types: L }, Mountain: { types: L },
  "Command Tower": { types: L }, "Breeding Pool": { types: L }, "Hallowed Fountain": { types: L }, "Mosswort Bridge": { types: L },
  "Watery Grave": { types: L }, "Jungle Shrine": { types: L }, "Savage Lands": { types: L }, "Spinerock Knoll": { types: L },
  // Artifacts and enchantments
  "Sol Ring": { types: A }, "Arcane Signet": { types: A }, "Ruby Medallion": { types: A }, "Lightning Greaves": { types: A },
  "Dragon's Hoard": { types: A }, "Herald's Horn": { types: A }, "Swiftfoot Boots": { types: A },
  "Doubling Season": { types: E }, "Hardened Scales": { types: E }, "Rhystic Study": { types: E }, "Smothering Tithe": { types: E },
  "Goblin Bombardment": { types: E },
  // Creatures
  "Atraxa, Praetors' Voice": C(4, 4), "Birds of Paradise": C(0, 1), "Deepglow Skate": C(3, 3), "Evolution Sage": C(3, 2),
  "Eternal Witness": C(2, 1), "Sakura-Tribe Elder": C(1, 1), "Craterhoof Behemoth": C(5, 5),
  "Krenko, Mob Boss": C(3, 3), "Goblin Chieftain": C(2, 2), "Skirk Prospector": C(1, 1), "Goblin Matron": C(1, 1), "Siege-Gang Commander": C(2, 2),
  "The Ur-Dragon": C(10, 10), "Miirym, Sentinel Wyrm": C(6, 6), "Old Gnawbone": C(7, 7), "Dragonlord's Servant": C(1, 3), "Scion of the Ur-Dragon": C(4, 4),
  "Yuriko, the Tiger's Shadow": C(1, 3), "Gonti, Lord of Luxury": C(2, 3), "Ninja of the Deep Hours": C(2, 2), "Changeling Outcast": C(1, 1),
  "Thassa's Oracle": C(1, 3),
  // Instants and sorceries
  "Swords to Plowshares": { types: I }, Counterspell: { types: I }, "Mana Drain": { types: I }, "Cyclonic Rift": { types: I },
  "Beast Within": { types: I }, "Lightning Bolt": { types: I }, Brainstorm: { types: I }, "Chaos Warp": { types: I },
  Cultivate: { types: S }, "Kodama's Reach": { types: S }, Ponder: { types: S },
  // Tokens
  Goblin: C(1, 1), Dragon: C(4, 4),
};

/** Every card name the simulation can show, for loading images up front. */
export const SIM_CARD_NAMES = Object.keys(CATALOG).filter((n) => n !== "Goblin" && n !== "Dragon");

interface Deck {
  commander: string;
  pool: string[];
  basics: string[];
}

const DECKS: Deck[] = [
  {
    commander: "Atraxa, Praetors' Voice",
    pool: ["Sol Ring", "Arcane Signet", "Command Tower", "Breeding Pool", "Hallowed Fountain", "Mosswort Bridge", "Birds of Paradise", "Deepglow Skate",
      "Evolution Sage", "Eternal Witness", "Sakura-Tribe Elder", "Craterhoof Behemoth", "Doubling Season", "Hardened Scales", "Rhystic Study",
      "Smothering Tithe", "Swords to Plowshares", "Counterspell", "Cyclonic Rift", "Beast Within", "Cultivate", "Kodama's Reach"],
    basics: ["Forest", "Island", "Plains", "Swamp"],
  },
  {
    commander: "Krenko, Mob Boss",
    pool: ["Sol Ring", "Ruby Medallion", "Lightning Greaves", "Goblin Chieftain", "Skirk Prospector", "Goblin Matron", "Siege-Gang Commander",
      "Goblin Bombardment", "Lightning Bolt", "Chaos Warp", "Spinerock Knoll"],
    basics: ["Mountain"],
  },
  {
    commander: "The Ur-Dragon",
    pool: ["Sol Ring", "Arcane Signet", "Command Tower", "Jungle Shrine", "Savage Lands", "Dragon's Hoard", "Herald's Horn", "Miirym, Sentinel Wyrm",
      "Old Gnawbone", "Dragonlord's Servant", "Scion of the Ur-Dragon", "Cultivate", "Chaos Warp", "Beast Within"],
    basics: ["Forest", "Mountain", "Island", "Swamp", "Plains"],
  },
  {
    commander: "Yuriko, the Tiger's Shadow",
    pool: ["Sol Ring", "Arcane Signet", "Watery Grave", "Command Tower", "Swiftfoot Boots", "Gonti, Lord of Luxury", "Ninja of the Deep Hours",
      "Changeling Outcast", "Thassa's Oracle", "Counterspell", "Mana Drain", "Brainstorm", "Ponder", "Rhystic Study"],
    basics: ["Island", "Swamp"],
  },
];

export const SEAT_COLORS = ["#e0a84f", "#6aa9ff", "#d46ad8", "#58c98a"];
export const ME = "me";

// ---- State helpers -----------------------------------------------------------------------------

let rng = Math.random;
/** Lets a caller make the opponents deterministic (tests, screenshots). */
export function setRandom(fn: () => number) {
  rng = fn;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function addCard(s: GameState, name: string, owner: string, zone: ZoneId, extra: Partial<CardState> = {}): CardState {
  const def = CATALOG[name] ?? { types: [] };
  const id = s.cards.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const card: CardState = { id, name, owner, controller: owner, zone, types: def.types, power: def.power, toughness: def.toughness, ...extra };
  s.cards.push(card);
  return card;
}

const byZone = (s: GameState, owner: string, zone: ZoneId) => s.cards.filter((c) => c.owner === owner && c.zone === zone);
export const playerName = (s: GameState, id: string) => (id === ME ? "You" : s.players.find((p) => p.id === id)?.name ?? id);
const log = (s: GameState, msg: string) => s.log.push(msg);

/** Moves a card to the top of a zone (the end of the array). */
function moveCard(s: GameState, card: CardState, zone: ZoneId) {
  s.cards.splice(s.cards.indexOf(card), 1);
  card.zone = zone;
  card.tapped = false;
  card.sick = zone === "battlefield" && card.types.includes("Creature");
  card.controller = card.owner;
  delete card.attacking;
  if (zone !== "exile") {
    delete card.faceDown;
    delete card.visibleTo;
  }
  if (zone !== "battlefield") delete card.counters;
  if (card.token && zone !== "battlefield") return; // tokens cease to exist
  s.cards.push(card);
}

function draw(s: GameState, pid: string, n = 1) {
  for (let i = 0; i < n; i++) {
    const lib = byZone(s, pid, "library");
    const top = lib[lib.length - 1];
    if (top) moveCard(s, top, "hand");
  }
}

function players(names: string[], count: number): PlayerState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? ME : `opp${i}`,
    name: names[i],
    color: SEAT_COLORS[i],
    life: 40,
    poison: 0,
    commanderDamage: {},
    commanderCasts: 0,
  }));
}

function library(deck: Deck): string[] {
  const cards = [...deck.pool];
  while (cards.length < 99 - 7) cards.push(deck.basics[cards.length % deck.basics.length]);
  return shuffle(cards);
}

// ---- Scenarios ---------------------------------------------------------------------------------

/** A fresh game: libraries shuffled, seven cards each, waiting on your mulligan decision. */
export function newGame(names: string[], count: number): GameState {
  const s: GameState = { players: players(names, count), cards: [], stack: [], turn: 0, active: ME, step: "UNTAP", log: [] };
  s.players.forEach((p, i) => {
    addCard(s, DECKS[i].commander, p.id, "command", { commander: true });
    for (const name of library(DECKS[i])) addCard(s, name, p.id, "library");
    draw(s, p.id, 7);
  });
  log(s, "Game started. Everyone drew seven cards.");
  return s;
}

/** London mulligan: shuffle your hand back and draw seven. */
export function mulligan(s: GameState, pid: string) {
  for (const c of byZone(s, pid, "hand")) moveCard(s, c, "library");
  const lib = byZone(s, pid, "library");
  const order = shuffle(lib.map((c) => c.id));
  s.cards = [...s.cards.filter((c) => !(c.owner === pid && c.zone === "library")), ...order.map((id) => lib.find((c) => c.id === id)!)];
  draw(s, pid, 7);
  log(s, `${playerName(s, pid)} took a mulligan.`);
}

/** Puts these hand cards on the bottom of the library (after keeping a mulligan). */
export function bottom(s: GameState, ids: number[]) {
  for (const id of ids) {
    const c = s.cards.find((x) => x.id === id)!;
    s.cards.splice(s.cards.indexOf(c), 1);
    c.zone = "library";
    const firstLib = s.cards.findIndex((x) => x.owner === c.owner && x.zone === "library");
    s.cards.splice(firstLib < 0 ? s.cards.length : firstLib, 0, c);
  }
}

/** A game in progress: turn 9, your precombat main phase, with full boards to look at. */
export function midGame(names: string[], count: number): GameState {
  const s: GameState = { players: players(names, count), cards: [], stack: [], turn: 9, active: ME, step: "MAIN1", log: [] };
  const has = (id: string) => s.players.some((p) => p.id === id);
  const put = (owner: string, zone: ZoneId, list: (string | [string, Partial<CardState>])[]) => {
    if (!has(owner)) return;
    for (const x of list) {
      const [name, extra] = Array.isArray(x) ? x : [x, {}];
      addCard(s, name, owner, zone, extra);
    }
  };
  const T = { tapped: true };
  const lib = (owner: string, i: number, n: number) => put(owner, "library", library(DECKS[i]).slice(0, n));

  // You: Atraxa (cast once, now back in the command zone).
  lib(ME, 0, 61);
  put(ME, "command", [["Atraxa, Praetors' Voice", { commander: true }]]);
  put(ME, "battlefield", ["Command Tower", "Forest", "Forest", "Forest", "Island", "Island", "Plains", "Swamp", "Breeding Pool", "Hallowed Fountain",
    "Mosswort Bridge", "Sol Ring", "Arcane Signet", "Birds of Paradise", ["Deepglow Skate", { counters: { "+1/+1": 2 } }], "Evolution Sage",
    "Hardened Scales", "Doubling Season"]);
  put(ME, "graveyard", ["Cultivate", "Counterspell", "Swords to Plowshares"]);
  put(ME, "exile", [["Craterhoof Behemoth", { faceDown: true, visibleTo: [ME] }]]); // Mosswort Bridge's hideaway
  put(ME, "hand", ["Cyclonic Rift", "Eternal Witness", "Beast Within", "Forest", "Smothering Tithe", "Kodama's Reach"]);
  s.players[0].commanderCasts = 1;
  s.players[0].life = 31;

  // Opponent 1: Krenko and a pile of goblins.
  lib("opp1", 1, 66);
  put("opp1", "battlefield", [["Krenko, Mob Boss", { commander: true }], "Goblin Chieftain", "Skirk Prospector",
    ...Array.from({ length: 9 }, () => ["Goblin", { token: true }] as [string, Partial<CardState>]),
    ["Mountain", T], ["Mountain", T], "Mountain", "Mountain", "Mountain", "Mountain", "Spinerock Knoll", "Sol Ring", "Ruby Medallion"]);
  put("opp1", "graveyard", ["Goblin Bombardment", "Lightning Bolt"]);
  put("opp1", "hand", ["Mountain", "Goblin Matron", "Siege-Gang Commander", "Lightning Bolt"]);

  // Opponent 2: The Ur-Dragon, still in the command zone after two casts.
  lib("opp2", 2, 58);
  put("opp2", "command", [["The Ur-Dragon", { commander: true }]]);
  put("opp2", "battlefield", ["Miirym, Sentinel Wyrm", "Old Gnawbone", "Dragonlord's Servant", ["Dragon", { token: true }], "Command Tower", "Jungle Shrine",
    "Savage Lands", "Forest", "Forest", "Mountain", "Island", "Swamp", "Plains", "Dragon's Hoard", "Herald's Horn", "Arcane Signet"]);
  put("opp2", "graveyard", ["Beast Within", "Cultivate", "Sol Ring"]);
  put("opp2", "exile", ["Scion of the Ur-Dragon"]);
  put("opp2", "hand", ["Forest", "Scion of the Ur-Dragon", "Chaos Warp"]);
  if (has("opp2")) Object.assign(s.players[2], { commanderCasts: 2, life: 27 });

  // Opponent 3: Yuriko. Gonti exiled the top of your library face down: only they can look at it.
  lib("opp3", 3, 63);
  put("opp3", "battlefield", [["Yuriko, the Tiger's Shadow", { commander: true }], "Gonti, Lord of Luxury", "Ninja of the Deep Hours", "Changeling Outcast",
    "Watery Grave", "Island", "Island", "Island", "Swamp", "Swamp", "Command Tower", "Sol Ring", "Swiftfoot Boots"]);
  put("opp3", "graveyard", ["Brainstorm", "Ponder"]);
  put("opp3", "hand", ["Island", "Counterspell", "Mana Drain", "Thassa's Oracle", "Ponder"]);
  put(ME, "exile", [["Rhystic Study", { faceDown: true, visibleTo: ["opp3"] }]]);
  if (has("opp3")) {
    s.players[3].life = 36;
    s.players[0].commanderDamage = { opp3: 6 };
  }
  if (has("opp1")) s.players[1].commanderDamage = { opp3: 3 };
  log(s, "Turn 9 · your turn.");
  return s;
}

// ---- Actions -----------------------------------------------------------------------------------

const isPermanent = (c: CardState) => !c.types.includes("Instant") && !c.types.includes("Sorcery");
const COUNTERS = ["Counterspell", "Mana Drain"];

/** Plays a land or casts a spell from hand (no mana in the simulation). Returns what happened. */
export function play(s: GameState, pid: string, cardId: number): "land" | "spell" | undefined {
  const c = s.cards.find((x) => x.id === cardId && x.zone === "hand" && x.owner === pid);
  if (!c) return;
  if (c.types.includes("Land")) {
    moveCard(s, c, "battlefield");
    log(s, `${playerName(s, pid)} played ${c.name}.`);
    return "land";
  }
  s.cards.splice(s.cards.indexOf(c), 1);
  c.zone = "stack";
  s.cards.push(c);
  s.stack.push({ id: c.id, controller: pid, cardId: c.id, name: c.name, kind: c.types.includes("Creature") ? "Creature spell" : `${c.types[0]} spell` });
  log(s, `${playerName(s, pid)} cast ${c.name}.`);
  return "spell";
}

/** Casts a player's commander from the command zone. */
export function castCommander(s: GameState, pid: string): boolean {
  const c = s.cards.find((x) => x.owner === pid && x.zone === "command" && x.commander);
  if (!c) return false;
  s.players.find((p) => p.id === pid)!.commanderCasts++;
  c.zone = "stack";
  s.stack.push({ id: c.id, controller: pid, cardId: c.id, name: c.name, kind: "Commander spell" });
  log(s, `${playerName(s, pid)} cast their commander, ${c.name}.`);
  return true;
}

/** Resolves the top of the stack. */
export function resolveTop(s: GameState) {
  const item = s.stack.pop();
  if (!item) return;
  const card = s.cards.find((c) => c.id === item.cardId);
  if (card && COUNTERS.includes(card.name)) {
    const target = s.stack.pop();
    const tc = target && s.cards.find((c) => c.id === target.cardId);
    if (tc) moveCard(s, tc, tc.commander ? "command" : "graveyard");
    log(s, `${card.name} countered ${target?.name ?? "nothing"}.`);
  } else if (item.name) log(s, `${item.name} resolved.`);
  if (card) moveCard(s, card, isPermanent(card) ? "battlefield" : "graveyard");
}

/** Opponents may respond to the top of the stack. Returns true if someone did. */
export function opponentsRespond(s: GameState): boolean {
  const top = s.stack[s.stack.length - 1];
  if (!top || top.controller !== ME || COUNTERS.includes(top.name)) return false;
  for (const p of s.players) {
    if (p.id === ME) continue;
    const counter = byZone(s, p.id, "hand").find((c) => COUNTERS.includes(c.name));
    if (counter && rng() < 0.35) {
      play(s, p.id, counter.id);
      return true;
    }
  }
  return false;
}

/** What happens when a step begins. Returns true if an opponent put something on the stack. */
export function enterStep(s: GameState): boolean {
  const pid = s.active;
  const opp = pid !== ME;
  switch (s.step) {
    case "UNTAP":
      for (const c of s.cards) if (c.controller === pid && c.zone === "battlefield") (c.tapped = false), (c.sick = false);
      s.turn++;
      log(s, `Turn ${s.turn} · ${pid === ME ? "your" : playerName(s, pid) + "'s"} turn.`);
      return false;
    case "DRAW":
      draw(s, pid);
      return false;
    case "MAIN1": {
      if (!opp) return false;
      const hand = byZone(s, pid, "hand");
      const land = hand.find((c) => c.types.includes("Land"));
      if (land) play(s, pid, land.id);
      const spell = hand.find((c) => !c.types.includes("Land") && !COUNTERS.includes(c.name));
      if (spell && rng() < 0.6) return play(s, pid, spell.id) === "spell";
      const commander = byZone(s, pid, "command")[0];
      if (commander && rng() < 0.3) return castCommander(s, pid);
      return false;
    }
    case "COMBAT_DECLARE_ATTACKERS": {
      if (!opp) return false;
      const attackers = s.cards.filter((c) => c.controller === pid && c.zone === "battlefield" && c.types.includes("Creature") && !c.tapped && !c.sick && (c.power ?? 0) > 0);
      const chosen = attackers.filter(() => rng() < 0.5).slice(0, 4);
      if (!chosen.length) return false;
      const targets = s.players.filter((p) => p.id !== pid);
      const target = targets[Math.floor(rng() * targets.length)];
      for (const c of chosen) (c.tapped = true), (c.attacking = target.id);
      log(s, `${playerName(s, pid)} attacks ${target.id === ME ? "you" : target.name} with ${chosen.map((c) => c.name).join(", ")}.`);
      return false;
    }
    case "COMBAT_DAMAGE": {
      for (const c of s.cards) {
        if (!c.attacking) continue;
        const target = s.players.find((p) => p.id === c.attacking);
        const dmg = (c.power ?? 0) + (c.counters?.["+1/+1"] ?? 0);
        if (target) {
          target.life -= dmg;
          if (c.commander) target.commanderDamage[c.owner] = (target.commanderDamage[c.owner] ?? 0) + dmg;
        }
        delete c.attacking;
      }
      return false;
    }
    default:
      return false;
  }
}

export const stepLabel = (id: StepId) => STEPS.find((s) => s.id === id)!.label;
