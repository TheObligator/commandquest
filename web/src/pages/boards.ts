import type { Board } from "../../convex/model/deckRules";

export const BOARDS: { id: Board; label: string }[] = [
  { id: "commander", label: "Commander" },
  { id: "main", label: "Main deck" },
  { id: "side", label: "Sideboard" },
  { id: "maybe", label: "Considering" },
];

export const boardLabel = (b: Board) => BOARDS.find((x) => x.id === b)!.label;
