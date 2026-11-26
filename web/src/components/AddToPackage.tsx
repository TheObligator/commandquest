// "Add to package…" on a card (or the selected cards): pick one of your packages, or name a new one.
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { DeckCard } from "../../convex/model/deckRules";
import { inPackage, MAX_PACKAGE_NAME } from "../../convex/model/packageRules";
import { errorMessage } from "../app/errors";
import { closeOnBackdrop } from "../carddetails";
import { toast } from "../dom";
import { Waiting } from "./Spinner";

export function AddToPackage({ cards, onClose }: { cards: DeckCard[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const packages = useQuery(api.packages.list);
  const addCard = useMutation(api.packages.addCard);
  const create = useMutation(api.packages.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  // One copy: a package says which cards, and basics or a playset can be raised in the package.
  // Each card once (the same card can be selected on two boards).
  const entries: DeckCard[] = [...new Map(cards.map((c) => [c.name.toLowerCase(), { ...c, quantity: 1, board: "main" as const }])).values()];
  const what = cards.length === 1 ? cards[0].name : `${cards.length} cards`;

  async function run(work: () => Promise<unknown>, to: string) {
    setBusy(true);
    try {
      await work();
      toast(`Added ${what} to ${to}`);
      ref.current?.close();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="new-deck folder-dialog" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run(() => create({ name, cards: entries }), name.trim());
        }}
      >
        <h3>Add {what} to a package</h3>
        {packages === undefined ? (
          <Waiting text="Loading your packages…" />
        ) : packages.length > 0 ? (
          <ul className="package-pick">
            {packages.map((p) => {
              const missing = entries.filter((e) => !inPackage(p.cards, e.name));
              const has = missing.length === 0;
              return (
                <li key={p._id}>
                  <button type="button" disabled={busy || has} onClick={() => void run(async () => {
                      for (const card of missing) await addCard({ id: p._id, card });
                    }, p.name)}>
                    <strong>{p.name}</strong>
                    <span className="muted small">{has ? (entries.length === 1 ? "✓ already in it" : "✓ all already in it") : `${p.cards.length} card${p.cards.length === 1 ? "" : "s"}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="tag-editor-add">
          <input value={name} maxLength={MAX_PACKAGE_NAME} placeholder="New package, e.g. Ramp staples" aria-label="New package" onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={busy || !name.trim()}>Create</button>
        </div>
      </form>
    </dialog>
  );
}
