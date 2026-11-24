// The deck editor's Saved abilities: the auto-yield and always yes / no settings saved with this deck
// from a game ("Save with this deck" in an ability's right-click menu), to look over and remove.
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "../app/errors";
import { toast } from "../dom";
import { AbilityMarks } from "../game/AbilityMenu";
import "../game/abilityMarks.css";

export function DeckAbilities({ deckId }: { deckId?: string }) {
  const saved = useQuery(api.decks.get, deckId ? { id: deckId } : "skip")?.abilities ?? [];
  const setAbility = useMutation(api.decks.setAbility);
  if (!deckId || !saved.length) return null;
  const remove = (card: string, text: string) =>
    setAbility({ id: deckId as Id<"decks">, card, text, autoYield: false, decision: "ASK" }).catch((e) => toast(errorMessage(e), "error"));
  return (
    <section className="board deck-abilities">
      <h2>
        Saved abilities<span className="muted"> {saved.length}</span>
      </h2>
      <p className="muted small">Used whenever you play this deck. Add one in a game: right-click a card, pick the ability, and tick “Save with this deck”.</p>
      <ul>
        {saved.map((a) => (
          <li key={a.text}>
            <div>
              <strong>{a.card}</strong>
              <span className="small muted">{a.text}</span>
            </div>
            <AbilityMarks setting={a} />
            <button className="btn small ghost" onClick={() => void remove(a.card, a.text)} aria-label={`Remove the setting for ${a.card}`}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
