// The deck editor's Combos: the deck's combos from Commander Spellbook, and the ones it's a card away from.
import { FoldSection } from "./Collapsible";
import { useState } from "react";
import { comboCards, comboUrl, guideSteps, resultsText, type SpellbookCombo } from "../game/spellbook";
import { useDeckCombos } from "../useDeckCombos";
import { Waiting } from "./Spinner";
import "./deckCombos.css";

const SHOWN = 8;

export function DeckCombos({ deckId }: { deckId?: string }) {
  const { found, looking, error, retry } = useDeckCombos(deckId);
  const [all, setAll] = useState(false);
  const [near, setNear] = useState(false);
  if (!deckId || (!found && !looking && !error)) return null;
  const combos = found?.combos ?? [];
  const away = found?.near ?? [];
  const shown = all ? combos : combos.slice(0, SHOWN);
  return (
    <FoldSection id="combos" className="deck-combos" title={<>Combos{found && <span className="muted"> {combos.length}</span>}</>}>
      {looking && <p className="muted small"><Waiting text={found ? "Checking again for this deck's combos…" : "Looking up this deck's combos…"} /></p>}
      {error && (
        <p className="muted small">
          {error} <button className="btn small ghost" onClick={retry}>Try again</button>
        </p>
      )}
      {found && !combos.length && !looking && <p className="muted small">None of the known combos are all in this deck.</p>}
      {combos.length > 0 && (
        <ul>
          {shown.map((c) => (
            <li key={c.id}><ComboRow combo={c} /></li>
          ))}
        </ul>
      )}
      {combos.length > SHOWN && <button className="btn small ghost" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${combos.length}`}</button>}
      {away.length > 0 && (
        <>
          <button className="btn small ghost" aria-expanded={near} onClick={() => setNear(!near)}>{near ? "▾" : "▸"} One card away ({away.length}{away.length === 30 ? ", the most played" : ""})</button>
          {near && (
            <ul>
              {away.map((c) => (
                <li key={c.id}>
                  <div className="dc-row">
                    <span className="dc-cards">
                      <strong>Add {c.missing.split(" // ")[0]}</strong>
                      <span className="small muted">with {comboCards({ cards: c.cards.filter((n) => n !== c.missing) })}</span>
                    </span>
                    <span className="small" title={c.results.join(", ")}>{resultsText(c.results)}</span>
                    <a className="small" href={comboUrl(c.id)} target="_blank" rel="noreferrer">Details</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="muted small dc-credit">
        Combos from <a href="https://commanderspellbook.com" target="_blank" rel="noreferrer">Commander Spellbook</a>. In a game, a combo that's ready shows in the left rail.
      </p>
    </FoldSection>
  );
}

function ComboRow({ combo }: { combo: SpellbookCombo }) {
  return (
    <details>
      <summary className="dc-row">
        <span className="dc-cards"><strong>{comboCards(combo)}</strong></span>
        <span className="small" title={combo.results.join(", ")}>{resultsText(combo.results)}</span>
      </summary>
      <ComboText combo={combo} />
    </details>
  );
}

/** What a combo needs and how it goes. Also in the game's window. */
export function ComboText({ combo }: { combo: SpellbookCombo }) {
  const steps = guideSteps(combo.steps);
  const rest = combo.steps.slice(steps.length);
  return (
    <div className="dc-text small">
      {combo.results.length > 2 && <p><span className="muted">Makes:</span> {combo.results.join(", ")}</p>}
      {combo.mana && <p><span className="muted">Mana to start:</span> {combo.mana}</p>}
      {combo.before && <p><span className="muted">First:</span> {combo.before}</p>}
      <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {rest.length > 0 && <p>{rest.join(" ")}</p>}
      <a href={comboUrl(combo.id)} target="_blank" rel="noreferrer">On Commander Spellbook</a>
    </div>
  );
}
