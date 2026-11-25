// "Use later" (docs/use-later.md): abilities you've put off to a step, as the game server keeps them
// (forge-web-server UseLater) and as a deck saves them (convex decks.later). No React or DOM here.
import { STEPS, type StepId } from "./phases.ts";

export type LaterWhen = "BEFORE_MY_TURN" | "MY_UPKEEP" | "NEXT_END" | "STEP";

export interface LaterSpec {
  when: LaterWhen;
  /** STEP: which step, on whose turn: "ME", "OPP" (any opponent) or a player's id. */
  phase?: StepId;
  whose?: string;
  /** Stop there and ask, instead of using it. */
  ask?: boolean;
  everyTurn?: boolean;
  everyCopy?: boolean;
}

/** An ability waiting to be used, from the view's `later`. */
export interface LaterEntry extends LaterSpec {
  id: number;
  card: string;
  /** Missing when it's for every copy. */
  cardId?: number;
  /** The ability's text (Forge's). */
  label: string;
  /** When, in words. */
  text: string;
  /** You're asked about it now: why. */
  due?: string;
  dueCard?: number;
  /** Only a warning that the card is about to be lost. */
  threat?: boolean;
}

/** One saved with a deck: for every copy of the card, every turn. */
export interface SavedLater {
  card: string;
  text: string;
  when: LaterWhen;
  phase?: string;
  whose?: string;
  ask?: boolean;
}

export const LATER_CHOICES: { when: Exclude<LaterWhen, "STEP">; label: string }[] = [
  { when: "BEFORE_MY_TURN", label: "End step before my turn" },
  { when: "MY_UPKEEP", label: "My next upkeep" },
  { when: "NEXT_END", label: "Next end step, anyone's" },
];

/** The entry for this ability of this card, if it's waiting. */
export function laterFor(entries: LaterEntry[] | undefined, cardId: number, cardName: string, label: string): LaterEntry | undefined {
  return entries?.find((e) => e.label === label && (e.everyCopy ? e.card === cardName : e.cardId === cardId));
}

/** When, in words ("End step before my turn", "My draw step"). */
export function laterText(s: { when: LaterWhen; phase?: string; whose?: string }, nameOf: (id: string) => string = () => "a player"): string {
  if (s.when !== "STEP") return LATER_CHOICES.find((c) => c.when === s.when)?.label ?? "";
  const step = STEPS.find((x) => x.id === s.phase)?.label ?? "step";
  const whose = s.whose === "ME" ? "My" : s.whose === "OPP" ? "An opponent's" : `${nameOf(s.whose ?? "")}'s`;
  return `${whose} ${step.toLowerCase()}`;
}

/** Where an ability can be put off to on the phase strip; sorcery-speed ones only to your own main phases. */
export function canPickStep(step: StepId, whose: string, sorcery: boolean): boolean {
  if (!STEPS.find((s) => s.id === step)?.priority) return false;
  return !sorcery || (whose === "ME" && (step === "MAIN1" || step === "MAIN2"));
}

/** Steps of one player's turn can't be saved with a deck: the next game has other players. */
export function canSaveLater(s: LaterSpec): boolean {
  return !!s.everyCopy && (s.when !== "STEP" || s.whose === "ME" || s.whose === "OPP");
}

/** The deck's saved ones with this one put in (or taken out: null). */
export function withSavedLater(list: SavedLater[], card: string, text: string, spec: LaterSpec | null): SavedLater[] {
  const rest = list.filter((l) => l.text !== text || l.card !== card);
  if (!spec) return rest;
  const entry: SavedLater = { card, text, when: spec.when };
  if (spec.when === "STEP") {
    entry.phase = spec.phase;
    entry.whose = spec.whose;
  }
  if (spec.ask) entry.ask = true;
  return [...rest, entry];
}
