// Asks before you give up priority in a way that ends your main phases while you could still play
// a land (`passSkipsLandDrop` in phases.ts). After a yes it doesn't ask again that turn.
import { useRef } from "react";
import { passSkipsLandDrop, type PassKind, type StepId, type TableStops } from "./phases";

export function useLandCheck(s: {
  stops: TableStops;
  me: string;
  active: string;
  step: StepId;
  turn: number;
  stackNonEmpty: boolean;
  landDrop: boolean;
}): (kind: PassKind) => boolean {
  const yesOnTurn = useRef(-1);
  return (kind) => {
    if (yesOnTurn.current === s.turn) return true;
    if (!passSkipsLandDrop(s.stops, { me: s.me, activePlayer: s.active, step: s.step, stackNonEmpty: s.stackNonEmpty, landDrop: s.landDrop, kind })) {
      return true;
    }
    const message =
      kind === "skip"
        ? "You can still play a land this turn.\n\nSkip the rest of your turn anyway?"
        : s.step === "MAIN2"
          ? "You can still play a land this turn. Passing now moves on to your end step.\n\nPass anyway?"
          : "You can still play a land this turn, and your Main 2 stop is off, so passing now takes you past your last main phase.\n\nPass anyway?";
    const yes = window.confirm(message);
    if (yes) yesOnTurn.current = s.turn;
    return yes;
  };
}

/** The question for turning off one of your own main-phase stops. */
export function confirmVitalStop(label: string): boolean {
  return window.confirm(
    `Turn off your ${label} stop?\n\nWithout it you lose priority in your own ${label} whenever the stack is empty, so you can't play lands or cast creatures and sorceries there. You need this stop to play normally.`,
  );
}
