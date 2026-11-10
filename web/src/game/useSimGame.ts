// Drives the simulated game for the table preview: priority passing with your stops, the
// auto-pass buttons, mulligans and casting. When game sessions exist, the server does all of this
// and the table only sends your choices.
import { useRef, useState } from "react";
import { autoPassStatus, nextStep, shouldStop, STEPS, type AutoPass, type AutoPassMode, type TableStops } from "./phases";
import { bottom, castCommander, enterStep, ME, midGame, mulligan, newGame, opponentsRespond, play, resolveTop } from "./sim";
import { viewFor, type GameState, type GameView } from "./view";

export type SimPhase = "mulligan" | "bottom" | "playing";

interface Sim {
  game: GameState;
  phase: SimPhase;
  mulligans: number;
  /** You have priority and the game waits for you. */
  priority: boolean;
  autoPass?: AutoPass;
  /** Turn you last played a land on. */
  landTurn: number;
}

export interface SimGame {
  view: GameView;
  phase: SimPhase;
  mulligans: number;
  priority: boolean;
  autoPass?: AutoPass;
  canPlayLand: boolean;
  pass(): void;
  setAutoPass(mode: AutoPassMode): void;
  play(cardId: number): string | undefined;
  castCommander(): string | undefined;
  toggleTap(cardId: number): void;
  keep(): void;
  mulligan(): void;
  confirmBottom(ids: number[]): void;
}

const hasPriority = (step: string) => STEPS.find((s) => s.id === step)!.priority;
const clone = (s: Sim): Sim => ({ ...s, game: structuredClone(s.game) });

function start(kind: "new" | "mid", names: string[], count: number): Sim {
  if (kind === "new") return { game: newGame(names, count), phase: "mulligan", mulligans: 0, priority: false, landTurn: -1 };
  return { game: midGame(names, count), phase: "playing", mulligans: 0, priority: true, landTurn: -1 };
}

export function useSimGame(opts: { kind: "new" | "mid"; names: string[]; stops: TableStops; holdPriority: boolean }): SimGame {
  const [sim, setSim] = useState(() => start(opts.kind, opts.names, opts.names.length));
  const stopsRef = useRef(opts.stops);
  stopsRef.current = opts.stops;
  const order = sim.game.players.map((p) => p.id);

  /** Moves the game on until you get priority again. Mutates `s`. */
  function runUntilStop(s: Sim) {
    const g = s.game;
    for (let guard = 0; guard < 600; guard++) {
      const nx = nextStep(order, g.active, g.step, false);
      g.active = nx.active;
      g.step = nx.step;
      const oppCast = enterStep(g);
      if (oppCast) break; // an opponent cast something: you get to respond
      if (!hasPriority(g.step)) continue;
      if (s.autoPass) {
        const status = autoPassStatus(s.autoPass, { activePlayer: g.active, step: g.step, turn: g.turn, me: ME, turnOrder: order });
        if (status !== "running") s.autoPass = undefined;
        if (status === "stop") break;
      }
      if (shouldStop(stopsRef.current, { activePlayer: g.active, step: g.step, turn: g.turn, me: ME, turnOrder: order, autoPass: s.autoPass })) break;
    }
    s.priority = true;
  }

  /** You pass priority. With something on the stack, the others pass too and it resolves. */
  function passIn(s: Sim) {
    const g = s.game;
    if (g.stack.length) {
      if (opponentsRespond(g)) return void (s.priority = true);
      resolveTop(g);
      if (g.stack.length || g.active === ME) return void (s.priority = true);
    }
    runUntilStop(s);
  }

  const update = (fn: (s: Sim) => void) => setSim((prev) => {
    const s = clone(prev);
    fn(s);
    return s;
  });

  const sorcerySpeed = sim.game.active === ME && (sim.game.step === "MAIN1" || sim.game.step === "MAIN2") && !sim.game.stack.length;

  return {
    view: viewFor(sim.game, ME),
    phase: sim.phase,
    mulligans: sim.mulligans,
    priority: sim.priority,
    autoPass: sim.autoPass,
    canPlayLand: sim.priority && sorcerySpeed && sim.landTurn !== sim.game.turn,

    pass: () => void update((s) => (s.priority ? passIn(s) : undefined)),

    setAutoPass: (mode) =>
      void update((s) => {
        if (s.autoPass?.mode === mode) return void (s.autoPass = undefined); // clicking it again cancels
        s.autoPass = { mode, turn: s.game.turn };
        if (s.priority && s.phase === "playing") passIn(s);
      }),

    play: (cardId) => {
      const g = sim.game;
      const card = g.cards.find((c) => c.id === cardId);
      if (!card || card.zone !== "hand" || card.owner !== ME) return "That card isn't in your hand.";
      if (!sim.priority || sim.phase !== "playing") return "Wait until you have priority.";
      const land = card.types.includes("Land");
      const instant = card.types.includes("Instant");
      if (land && sim.landTurn === g.turn) return "You already played a land this turn.";
      if ((land || !instant) && !sorcerySpeed) return `You can only ${land ? "play lands" : "cast that"} in your main phase with an empty stack.`;
      update((s) => {
        const what = play(s.game, ME, cardId);
        if (what === "land") s.landTurn = s.game.turn;
        if (what === "spell" && !opts.holdPriority) passIn(s);
      });
    },

    castCommander: () => {
      if (!sim.game.cards.some((c) => c.owner === ME && c.zone === "command")) return "Your commander isn't in the command zone.";
      if (!sim.priority || !sorcerySpeed) return "You can cast your commander in your main phase with an empty stack.";
      update((s) => {
        castCommander(s.game, ME);
        if (!opts.holdPriority) passIn(s);
      });
    },

    toggleTap: (cardId) =>
      void update((s) => {
        const c = s.game.cards.find((x) => x.id === cardId && x.controller === ME && x.zone === "battlefield");
        if (c) c.tapped = !c.tapped;
      }),

    keep: () =>
      void update((s) => {
        if (s.mulligans > 0) return void (s.phase = "bottom");
        begin(s);
      }),

    mulligan: () =>
      void update((s) => {
        mulligan(s.game, ME);
        s.mulligans++;
      }),

    confirmBottom: (ids) =>
      void update((s) => {
        bottom(s.game, ids);
        begin(s);
      }),
  };

  function begin(s: Sim) {
    s.phase = "playing";
    s.game.log.push(`You kept ${7 - s.mulligans}. Everyone else kept seven.`);
    s.game.active = order[order.length - 1];
    s.game.step = "CLEANUP";
    runUntilStop(s);
  }
}
