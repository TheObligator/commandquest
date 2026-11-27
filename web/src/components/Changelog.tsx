// A deck's changelog (convex/changelog.ts): one entry per sitting of edits, newest first.
import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import { describeCards, type CardDelta } from "../../convex/model/changelog";
import type { Board } from "../../convex/model/deckRules";
import { closeOnBackdrop } from "../carddetails";
import { formatLabel } from "../deckFormats";
import { Loading } from "./Spinner";

const BOARD: Record<Board, string> = { commander: "Commander", main: "Deck", side: "Sideboard", maybe: "Maybeboard" };

function when(start: number, end: number): string {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString(undefined, { year: s.getFullYear() === new Date().getFullYear() ? undefined : "numeric", month: "short", day: "numeric" });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (end - start < 60_000) return `${day}, ${time(s)}`;
  return s.toDateString() === e.toDateString() ? `${day}, ${time(s)}–${time(e)}` : `${day}, ${time(s)} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time(e)}`;
}

const where = (b: Board) => (b === "main" ? "" : ` (${BOARD[b]})`);

function field(f: { field: string; from: string; to: string }): string {
  if (f.field === "name") return `Renamed “${f.from}” → “${f.to}”`;
  if (f.field === "format") return `Format: ${formatLabel(f.from)} → ${formatLabel(f.to)}`;
  if (f.field === "bracket") return f.to ? (f.from ? `Bracket ${f.from} → ${f.to}` : `Bracket set to ${f.to}`) : `Bracket ${f.from} cleared`;
  return `${f.field}: ${f.from} → ${f.to}`;
}

function Cards({ cards }: { cards: CardDelta[] }) {
  const { added, removed, moved } = describeCards(cards);
  return (
    <ul className="changes">
      {added.map((c) => <li key={`+${c.board}${c.name}`} className="added"><b>+{c.delta}</b> {c.name}<span className="muted">{where(c.board)}</span></li>)}
      {removed.map((c) => <li key={`-${c.board}${c.name}`} className="removed"><b>−{-c.delta}</b> {c.name}<span className="muted">{where(c.board)}</span></li>)}
      {moved.map((m) => <li key={`>${m.name}${m.from}${m.to}`} className="moved"><b>⇄{m.count > 1 ? ` ${m.count}` : ""}</b> {m.name} <span className="muted">{BOARD[m.from]} → {BOARD[m.to]}</span></li>)}
    </ul>
  );
}

/** By share key (a shared deck) or id (one of yours). */
export function Changelog({ shareKey, id }: { shareKey?: string; id?: string }) {
  const entries = useQuery(api.changelog.forDeck, shareKey ? { key: shareKey } : { id });
  if (entries === undefined) return <Loading text="Loading the changelog…" />;
  if (!entries?.length) return <p className="muted">No changes recorded yet. Edits from now on show up here, one entry per sitting.</p>;
  return (
    <ol className="changelog">
      {entries.map((e) => {
        const n = e.cards.reduce((t, c) => t + Math.abs(c.delta), 0);
        return (
          <li key={e.id}>
            <div className="changelog-head">
              <time dateTime={new Date(e.at).toISOString()}>{when(e.startedAt, e.at)}</time>
              <span className="muted small">{e.created ? `Created with ${n} card${n === 1 ? "" : "s"}` : `${n} card change${n === 1 ? "" : "s"}`}</span>
            </div>
            {e.fields.length > 0 && <ul className="changes">{e.fields.map((f) => <li key={f.field} className="field">{field(f)}</li>)}</ul>}
            {!e.created && <Cards cards={e.cards} />}
          </li>
        );
      })}
    </ol>
  );
}

export function ChangelogDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} className="new-deck changelog-dialog" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>History of “{name}”</h3>
      <p className="muted small">Each entry is one sitting: edits go together until an hour passes without one. Cards added and taken out again in the same sitting don't show.</p>
      <div className="changelog-scroll"><Changelog id={id} /></div>
    </dialog>
  );
}
