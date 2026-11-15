import type { Board } from "../../convex/model/deckRules";

export const BOARDS: { id: Board; label: string }[] = [
  { id: "commander", label: "Commander" },
  { id: "main", label: "Main deck" },
  { id: "side", label: "Sideboard" },
  { id: "maybe", label: "Considering" },
];

export const boardLabel = (b: Board) => BOARDS.find((x) => x.id === b)!.label;

/** Card type groups in a deck view, in display order (see scryfall.primaryType). */
export const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"];
