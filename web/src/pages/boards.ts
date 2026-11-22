import type { Board } from "../../convex/model/deckRules";

export const BOARDS: { id: Board; label: string }[] = [
  { id: "commander", label: "Commander" },
  { id: "main", label: "Main deck" },
  { id: "side", label: "Sideboard" },
  { id: "maybe", label: "Considering" },
];

export const boardLabel = (b: Board) => BOARDS.find((x) => x.id === b)!.label;

const SHORT_BOARD: Record<Board, string> = { commander: "commander", main: "main", side: "side", maybe: "considering" };

/** Where a search result already is in the deck, one part per board, commander first. */
export function inDeckParts(entries: { board: Board; quantity: number }[]): { board: Board; text: string }[] {
  const order: Board[] = ["commander", "main", "side", "maybe"];
  const sorted = [...entries].sort((a, z) => order.indexOf(a.board) - order.indexOf(z.board));
  if (sorted.length === 1) {
    const [e] = sorted;
    const text = e.board === "commander" ? (e.quantity > 1 ? `${e.quantity} as commander` : "Commander") : `${e.quantity} in ${boardLabel(e.board).toLowerCase()}`;
    return [{ board: e.board, text }];
  }
  return sorted.map((e) => ({ board: e.board, text: `${e.quantity} ${SHORT_BOARD[e.board]}` }));
}

/** The same as one line: "1 in main deck", "Commander", "1 main · 1 considering". */
export const inDeckText = (entries: { board: Board; quantity: number }[]) => inDeckParts(entries).map((p) => p.text).join(" · ");
