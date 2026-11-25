// "Use later": putting an activated ability off to a step, from its card's right-click menu, and the
// rail's list of what's waiting (docs/use-later.md).
import { createContext, useContext, useState } from "react";
import type { MenuItem } from "../components/CardMenu";
import { Check } from "./AbilityMenu";
import { abilityName } from "./abilities";
import { canSaveLater, laterFor, laterText, LATER_CHOICES, type LaterEntry, type LaterSpec, type SavedLater } from "./later";

export interface LaterControls {
  entries?: LaterEntry[];
  /** What's saved with the deck you're playing; undefined when it's not one of your saved decks. */
  saved?: SavedLater[];
  set: (cardId: number, label: string, spec: LaterSpec) => void;
  cancel: (id: number) => void;
  /** Use one now. */
  use: (cardId: number, label: string) => void;
  /** Not now: you're no longer asked about it. */
  leave: (id: number) => void;
  /** Pick its step on the phase strip. */
  pick: (card: string, sorcery: boolean, done: (step: LaterSpec) => void) => void;
  save: (card: string, text: string, spec: LaterSpec | null) => void;
  nameOf: (id: string) => string;
}

const NOTHING: LaterControls = { set: () => {}, cancel: () => {}, use: () => {}, leave: () => {}, pick: () => {}, save: () => {}, nameOf: (id) => id };
const LaterContext = createContext<LaterControls>(NOTHING);
export const LaterProvider = LaterContext.Provider;

/** An ability as listed for a card's menu, if it can be put off ("sorcery": only to your own main phases). */
export interface LaterAbility {
  label: string;
  later?: "any" | "sorcery";
}

/** The menu rows for the abilities of your card that can be used later. */
export function laterItems(actions: LaterAbility[], cardId: number, card: string): MenuItem[] {
  return actions.filter((a) => a.later).map((a) => ({
    label: laterName(a.label),
    onSelect: () => {},
    badge: <LaterMark cardId={cardId} card={card} label={a.label} />,
    panel: <LaterPanel cardId={cardId} card={card} label={a.label} sorcery={a.later === "sorcery"} />,
  }));
}

/** What an ability does, without its cost: "{T}, Sacrifice …: Search your library" → "Search your library". */
export function laterName(label: string): string {
  const at = label.indexOf(": ");
  return abilityName(at >= 0 && at < label.length - 2 ? label.slice(at + 2) : label);
}

function LaterMark({ cardId, card, label }: { cardId: number; card: string; label: string }) {
  const e = laterFor(useContext(LaterContext).entries, cardId, card, label);
  return e ? <span className="ab-marks"><b className="ab-mark later">{e.ask ? "ask later" : "later"}</b></span> : null;
}

function LaterPanel({ cardId, card, label, sorcery }: { cardId: number; card: string; label: string; sorcery: boolean }) {
  const c = useContext(LaterContext);
  const entry = laterFor(c.entries, cardId, card, label);
  // Before it's set, the choices below are kept here.
  const [draft, setDraft] = useState<Pick<LaterSpec, "ask" | "everyTurn" | "everyCopy">>({});
  const opts = entry ?? draft;
  const saved = c.saved?.find((s) => s.text === label && s.card === card);
  const put = (spec: LaterSpec) => {
    c.set(cardId, label, spec);
    if (saved && canSaveLater(spec)) c.save(card, label, spec);
  };
  const spec = (when: Pick<LaterSpec, "when" | "phase" | "whose">): LaterSpec => ({ ...when, ask: !!opts.ask, everyTurn: !!opts.everyTurn, everyCopy: !!opts.everyCopy });
  const change = (o: Pick<LaterSpec, "ask" | "everyTurn" | "everyCopy">) => {
    const next = { ask: !!opts.ask, everyTurn: !!opts.everyTurn, everyCopy: !!opts.everyCopy, ...o };
    if (entry) put({ when: entry.when, phase: entry.phase, whose: entry.whose, ...next });
    else setDraft(next);
  };
  const step = entry?.when === "STEP" ? laterText(entry, c.nameOf) : null;
  return (
    <div className="ab-panel">
      <p className="ab-text">{label}</p>
      {!sorcery && LATER_CHOICES.map((x) => (
        <Check key={x.when} kind="menuitemradio" on={entry?.when === x.when} onClick={() => put(spec({ when: x.when }))}>{x.label}</Check>
      ))}
      <Check kind="menuitemradio" on={!!step} hint={step ? undefined : "click the phase strip"} onClick={() => c.pick(card, sorcery, (s) => put(spec(s)))}>
        {step ?? (sorcery ? "Pick one of my main phases…" : "Pick a step…")}
      </Check>
      <div className="ab-group" role="group" aria-label="When it comes">
        <div className="card-menu-title">When it comes</div>
        <Check kind="menuitemradio" on={!opts.ask} onClick={() => change({ ask: false })}>Use it for me</Check>
        <Check kind="menuitemradio" on={!!opts.ask} onClick={() => change({ ask: true })}>Just stop and ask me</Check>
      </div>
      <div className="ab-group">
        <Check kind="menuitemcheckbox" on={!!opts.everyTurn || !!opts.everyCopy} disabled={!!opts.everyCopy} onClick={() => change({ everyTurn: !opts.everyTurn })}>Every turn, not just once</Check>
        <Check kind="menuitemcheckbox" on={!!opts.everyCopy} disabled={!!saved} hint={saved ? "saved with the deck" : undefined} onClick={() => change({ everyCopy: !opts.everyCopy, everyTurn: !opts.everyCopy })}>Every copy I have</Check>
        {c.saved && (
          <Check
            kind="menuitemcheckbox"
            on={!!saved}
            disabled={!saved && !(entry && canSaveLater(entry))}
            hint={saved ? undefined : !entry ? "nothing set yet" : !entry.everyCopy ? "only for every copy" : canSaveLater(entry) ? undefined : "not for one player's turn"}
            onClick={() => c.save(card, label, saved || !entry ? null : entry)}
          >
            Save with this deck
          </Check>
        )}
      </div>
      {entry && (
        <div className="ab-group">
          <button role="menuitem" className="danger" onClick={() => c.cancel(entry.id)}>Don't use it later</button>
        </div>
      )}
    </div>
  );
}

/** The rail: what you're asked about now, and what's waiting. */
export function LaterRail() {
  const c = useContext(LaterContext);
  const entries = c.entries ?? [];
  if (!entries.length) return null;
  return (
    <>
      {entries.filter((e) => e.due).map((e) => (
        <section key={`due-${e.id}`} className="ar-decision live">
          <div className="ar-ribbon">{e.threat ? "Warning" : "Now"}</div>
          <h3>{e.card}</h3>
          <p>{e.due} {e.threat ? `It was waiting: ${lower(e.text)}.` : `You put this off until now: ${laterName(e.label)}.`}</p>
          <div className="ar-actions">
            <button className="ar-btn primary" onClick={() => c.use(e.dueCard ?? e.cardId ?? -1, e.label)}>Use it now</button>
            <button className="ar-btn" onClick={() => c.leave(e.id)}>{e.threat ? "Let it go" : "Leave it"}</button>
          </div>
        </section>
      ))}
      <section className="ar-later">
        <header><h3>Waiting</h3></header>
        <ul>
          {entries.map((e) => (
            <li key={e.id} title={e.label}>
              <div>
                <strong>{e.card}{e.everyCopy ? " (every copy)" : ""}</strong>
                <span>{e.text}{e.ask ? ", asks you" : ""}</span>
              </div>
              {e.cardId !== undefined && !e.due && <button className="btn small ghost" onClick={() => c.use(e.cardId!, e.label)}>Use now</button>}
              <button className="btn small ghost" aria-label={`Don't use ${e.card} later`} title="Don't use it later" onClick={() => c.cancel(e.id)}>×</button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
