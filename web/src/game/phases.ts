// Turn structure and priority stops. Pure logic with no DOM, so `node --test` can run it.
//
// Step ids are Forge's PhaseType names (forge.game.phase.PhaseType), so stops can go to the
// server as-is. A stop only decides whether an EMPTY stack passes automatically. As on MTGO, a
// player always gets priority when something is on the stack or the game needs a decision.

export type StepId =
  | "UNTAP" | "UPKEEP" | "DRAW" | "MAIN1"
  | "COMBAT_BEGIN" | "COMBAT_DECLARE_ATTACKERS" | "COMBAT_DECLARE_BLOCKERS"
  | "COMBAT_FIRST_STRIKE_DAMAGE" | "COMBAT_DAMAGE" | "COMBAT_END"
  | "MAIN2" | "END_OF_TURN" | "CLEANUP";

export interface Step {
  id: StepId;
  label: string;
  short: string;
  phase: "Beginning" | "Precombat main" | "Combat" | "Postcombat main" | "Ending";
  /** False for untap and cleanup, where nobody normally gets priority (CR 502.4, 514.3). */
  priority: boolean;
}

export const STEPS: Step[] = [
  { id: "UNTAP", label: "Untap", short: "Untap", phase: "Beginning", priority: false },
  { id: "UPKEEP", label: "Upkeep", short: "Upkp", phase: "Beginning", priority: true },
  { id: "DRAW", label: "Draw", short: "Draw", phase: "Beginning", priority: true },
  { id: "MAIN1", label: "Main 1", short: "M1", phase: "Precombat main", priority: true },
  { id: "COMBAT_BEGIN", label: "Beginning of combat", short: "BoC", phase: "Combat", priority: true },
  { id: "COMBAT_DECLARE_ATTACKERS", label: "Declare attackers", short: "Atk", phase: "Combat", priority: true },
  { id: "COMBAT_DECLARE_BLOCKERS", label: "Declare blockers", short: "Blk", phase: "Combat", priority: true },
  { id: "COMBAT_FIRST_STRIKE_DAMAGE", label: "First strike damage", short: "FS", phase: "Combat", priority: true },
  { id: "COMBAT_DAMAGE", label: "Combat damage", short: "Dmg", phase: "Combat", priority: true },
  { id: "COMBAT_END", label: "End of combat", short: "EoC", phase: "Combat", priority: true },
  { id: "MAIN2", label: "Main 2", short: "M2", phase: "Postcombat main", priority: true },
  { id: "END_OF_TURN", label: "End step", short: "End", phase: "Ending", priority: true },
  { id: "CLEANUP", label: "Cleanup", short: "Clnp", phase: "Ending", priority: false },
];

const STEP_IDS = new Set<string>(STEPS.map((s) => s.id));
const PRIORITY_IDS = new Set<string>(STEPS.filter((s) => s.priority).map((s) => s.id));

/**
 * What's saved to the account: stops for your own turn, one set for opponents in general, and
 * optionally one set per seat. Seats count in turn order from you: seats[0] is the player who
 * goes after you, seats[1] the one after them, and so on. A seat with no saved list uses
 * `opponents`.
 */
export interface StopPreset {
  self: StepId[];
  opponents: StepId[];
  seats?: StepId[][];
}

/** Upkeep and draw are left out: you still get priority there when something goes on the stack. */
export const DEFAULT_PRESET: StopPreset = {
  self: ["MAIN1", "COMBAT_BEGIN", "COMBAT_DECLARE_BLOCKERS", "MAIN2"],
  opponents: ["COMBAT_BEGIN", "COMBAT_DECLARE_ATTACKERS", "COMBAT_DECLARE_BLOCKERS", "END_OF_TURN"],
};

/** In-game stops: one set per player whose turn it might be (you, and each opponent separately). */
export type TableStops = Map<string, Set<StepId>>;

const clean = (ids: readonly string[]) => STEPS.map((s) => s.id).filter((id) => PRIORITY_IDS.has(id) && ids.includes(id));

/**
 * Starts a game's stops from the preset: your column from `self`, and each opponent from its seat
 * (`opponents` must be in turn order after you), falling back to the general `opponents` list.
 */
export function stopsFromPreset(preset: StopPreset, me: string, opponents: string[]): TableStops {
  const t: TableStops = new Map();
  t.set(me, new Set(clean(preset.self)));
  opponents.forEach((o, i) => t.set(o, new Set(clean(preset.seats?.[i] ?? preset.opponents))));
  return t;
}

/**
 * Turns the table's stops back into a preset. `opponents` (in turn order after you) is saved per
 * seat, and the general opponents list is the stops they all share, used for seats a bigger game
 * has that this one didn't.
 */
export function presetFromStops(stops: TableStops, me: string, opponents: string[]): StopPreset {
  const self = clean([...(stops.get(me) ?? [])]);
  const shared = opponents.length
    ? clean(STEPS.map((s) => s.id).filter((id) => opponents.every((o) => stops.get(o)?.has(id))))
    : [];
  return { self, opponents: shared, seats: opponents.map((o) => clean([...(stops.get(o) ?? [])])) };
}

export function isValidStep(id: string): id is StepId {
  return STEP_IDS.has(id);
}

export function toggleStop(stops: TableStops, player: string, step: StepId): boolean {
  if (!PRIORITY_IDS.has(step)) return false;
  const set = stops.get(player) ?? new Set<StepId>();
  stops.set(player, set);
  if (set.has(step)) set.delete(step);
  else set.add(step);
  return set.has(step);
}

/** Toggles one step for every opponent at once: on for all unless all already have it. */
export function toggleForAll(stops: TableStops, players: string[], step: StepId) {
  if (!PRIORITY_IDS.has(step)) return;
  const allOn = players.every((p) => stops.get(p)?.has(step));
  for (const p of players) {
    const set = stops.get(p) ?? new Set<StepId>();
    stops.set(p, set);
    if (allOn) set.delete(step);
    else set.add(step);
  }
}

export interface PriorityContext {
  /** Whose turn it is. */
  activePlayer: string;
  step: StepId;
  /** Something is on the stack, or the game is asking this player to decide something. */
  stackNonEmpty?: boolean;
  /** The player chose "pass until next turn" (MTGO F6) during this turn. */
  passingTurn?: boolean;
  /** An auto-pass the player picked from the action rail, with what it needs to know where it ends. */
  autoPass?: AutoPass;
  /** Game turn number (counts every player's turn). Needed with `autoPass`. */
  turn?: number;
  /** The player deciding, and the turn order. Needed with `autoPass`. */
  me?: string;
  turnOrder?: string[];
}

/**
 * Quick skips from the action rail. Like F6, they ignore your stops, but something going on the
 * stack still gives you priority.
 *  - END_OF_TURN (E): skip the rest of this turn. Your stops apply again from the next turn.
 *  - BEFORE_MY_TURN (B): skip until the end step of the player right before you.
 *  - UNTIL_MY_TURN (M): skip until your next turn starts; your stops apply again from there.
 *  - ACTION_OR_END_STEP (R): skip until someone does something, or this turn's end step.
 */
export type AutoPassMode = "END_OF_TURN" | "BEFORE_MY_TURN" | "UNTIL_MY_TURN" | "ACTION_OR_END_STEP";

export interface AutoPass {
  mode: AutoPassMode;
  /** The game turn it was chosen on. */
  turn: number;
}

/** "running": keep passing. "stop": give the player priority here (and clear it). "expired": clear it and use the normal stops. */
export function autoPassStatus(ap: AutoPass, ctx: { activePlayer: string; step: StepId; turn: number; me: string; turnOrder: string[] }): "running" | "stop" | "expired" {
  switch (ap.mode) {
    case "END_OF_TURN":
      return ctx.turn > ap.turn ? "expired" : "running";
    case "ACTION_OR_END_STEP":
      if (ctx.turn > ap.turn) return "expired";
      return ctx.step === "END_OF_TURN" ? "stop" : "running";
    case "BEFORE_MY_TURN": {
      const i = ctx.turnOrder.indexOf(ctx.me);
      const before = ctx.turnOrder[(i - 1 + ctx.turnOrder.length) % ctx.turnOrder.length];
      return ctx.activePlayer === before && ctx.step === "END_OF_TURN" ? "stop" : "running";
    }
    case "UNTIL_MY_TURN":
      return ctx.activePlayer === ctx.me && ctx.turn > ap.turn ? "expired" : "running";
  }
}

/** Should the client stop and let this player act, or auto-pass priority? */
export function shouldStop(stops: TableStops, ctx: PriorityContext): boolean {
  if (!PRIORITY_IDS.has(ctx.step)) return false;
  if (ctx.stackNonEmpty) return true; // always get a chance to respond
  if (ctx.passingTurn) return false;
  if (ctx.autoPass && ctx.me && ctx.turnOrder && ctx.turn !== undefined) {
    const status = autoPassStatus(ctx.autoPass, { activePlayer: ctx.activePlayer, step: ctx.step, turn: ctx.turn, me: ctx.me, turnOrder: ctx.turnOrder });
    if (status !== "expired") return status === "stop";
  }
  return stops.get(ctx.activePlayer)?.has(ctx.step) ?? false;
}

/** The step after `step`. Wraps to UNTAP and moves `active` to the next player in `turnOrder`. */
export function nextStep(turnOrder: string[], active: string, step: StepId, firstStrike = false): { active: string; step: StepId } {
  const order = STEPS.map((s) => s.id).filter((id) => firstStrike || id !== "COMBAT_FIRST_STRIKE_DAMAGE");
  const i = order.indexOf(step);
  if (i < order.length - 1) return { active, step: order[i + 1] };
  const next = turnOrder[(turnOrder.indexOf(active) + 1) % turnOrder.length];
  return { active: next, step: "UNTAP" };
}
