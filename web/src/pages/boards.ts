import type { Board } from "../../convex/model/deckRules";

export const BOARDS: { id: Board; label: string }[] = [
  { id: "commander", label: "Commander" },
  { id: "main", label: "Main deck" },
  { id: "side", label: "Sideboard" },
  { id: "maybe", label: "Considering" },
];

export const boardLabel = (b: Board) => BOARDS.find((x) => x.id === b)!.label;

const SHORT_BOARD: Record<Board, string> = { commander: "commander", main: "main", side: "side", maybe: "considering" };

/**
 * Where a search result already is in the deck: "1 in main deck", "Commander", or for several
 * boards a short list ("1 main · 1 considering").
 */
export function inDeckText(entries: { board: Board; quantity: number }[]): string {
  const order: Board[] = ["commander", "main", "side", "maybe"];
  const sorted = [...entries].sort((a, z) => order.indexOf(a.board) - order.indexOf(z.board));
  if (sorted.length === 1) {
    const [e] = sorted;
    return e.board === "commander" ? (e.quantity > 1 ? `${e.quantity} as commander` : "Commander") : `${e.quantity} in ${boardLabel(e.board).toLowerCase()}`;
  }
  return sorted.map((e) => `${e.quantity} ${SHORT_BOARD[e.board]}`).join(" · ");
}

