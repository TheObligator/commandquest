// "Add to another deck…" on a card or the selected cards: pick one of your other decks and the board
// they go on. Each keeps its printing, number of copies and tags; copies of a card the deck already
// has are added to it (convex/decks.ts addCards).
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Board, DeckCard } from "../../convex/model/deckRules";
import { errorMessage } from "../app/errors";
import { closeOnBackdrop } from "../carddetails";
import { formatLabel, isPlainList, PACKAGE } from "../deckFormats";
import { toast } from "../dom";
import { Waiting } from "./Spinner";

const TO: { id: Board; label: string }[] = [
  { id: "main", label: "Main deck" },
  { id: "side", label: "Sideboard" },
  { id: "maybe", label: "Considering" },
];

export function AddToDeck({ cards, from, onClose }: { cards: DeckCard[]; from?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const decks = useQuery(api.decks.list);
  const addCards = useMutation(api.decks.addCards);
  const [board, setBoard] = useState<Board>("main");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  const copies = cards.reduce((n, c) => n + c.quantity, 0);
  const what = cards.length === 1 ? `${cards[0].quantity > 1 ? `${cards[0].quantity} × ` : ""}${cards[0].name}` : `${cards.length} cards`;
  const others = (decks ?? []).filter((d) => d._id !== from && d.format !== PACKAGE && d.name.toLowerCase().includes(filter.trim().toLowerCase()));

  async function add(d: { _id: Id<"decks">; name: string; format: string }) {
    setBusy(true);
    const to: Board = isPlainList(d.format) ? "main" : board;
    try {
      await addCards({ id: d._id, cards: cards.map((c) => ({ ...c, board: to })) });
      toast(`Added ${what}${cards.length > 1 ? ` (${copies} copies)` : ""} to ${d.name}${to === "main" ? "" : `'s ${TO.find((b) => b.id === to)!.label.toLowerCase()}`}`);
      ref.current?.close();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="new-deck folder-dialog" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>Add {what} to another deck</h3>
      <p className="muted small">They keep their printing and number of copies. If that deck is open in another tab, reload it there before editing it.</p>
      <label className="group-by">
        <span className="muted">Add to the</span>
        <select value={board} onChange={(e) => setBoard(e.target.value as Board)}>
          {TO.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      {decks === undefined ? (
        <Waiting text="Loading your decks…" />
      ) : (
        <>
          {(decks?.length ?? 0) > 8 && <input className="deck-pick-filter" autoFocus value={filter} placeholder="Find a deck" aria-label="Find a deck" onChange={(e) => setFilter(e.target.value)} />}
          {others.length ? (
            <ul className="package-pick deck-pick">
              {others.map((d) => (
                <li key={d._id}>
                  <button type="button" disabled={busy} onClick={() => void add(d)}>
                    <strong>{d.name}</strong>
                    <span className="muted small">{formatLabel(d.format)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{filter ? "No deck by that name." : "You have no other decks yet."}</p>
          )}
        </>
      )}
    </dialog>
  );
}
