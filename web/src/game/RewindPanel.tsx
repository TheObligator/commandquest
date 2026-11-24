// Rewinding (docs/rewind.md): the game's timeline in the rail. Pick a moment to go back to; when
// other people are playing they all have to agree, and a request from someone else shows here
// with Yes / No.
import { useState } from "react";
import { PressButton } from "./PressButton";
import type { LiveGame } from "./useLiveGame";
import type { RewindLevel, RewindPoint, RewindView } from "./view";

/** What each host setting allows, for the setup screen and the rail. */
export const REWIND_LEVELS: { level: RewindLevel; label: string; hint: string }[] = [
  { level: 0, label: "Off", hint: "No rewinding in this game." },
  { level: 1, label: "Last action", hint: "Take back your last spell, ability, land or attack, unless it showed you something new (a card drawn, an opponent's card from their hand)." },
  { level: 2, label: "Until new information", hint: "Back to any moment this turn since you last learned something hidden: a card you drew, scryed or looked at, or one an opponent played from their hand." },
  { level: 3, label: "This turn", hint: "Back to any moment of the current turn." },
  { level: 4, label: "Last turn", hint: "Back into the previous turn: replay a whole turn." },
];

export function RewindPanel({ game, rewind }: { game: LiveGame; rewind: RewindView }) {
  const [open, setOpen] = useState(false);
  const p = rewind.pending;
  const all = rewind.options ?? [];
  const options = all.filter((o) => o.kind === "timeline");
  const combat = all.filter((o) => o.kind !== "timeline");

  if (p) {
    return (
      <section className={`rewind-panel${p.needsMe ? " ar-decision live" : ""}`}>
        {p.needsMe && <div className="ar-ribbon">Rewind?</div>}
        <header>
          <h3>{p.mine ? "You asked to rewind" : `${p.by} asks to rewind`}</h3>
        </header>
        <p className="rewind-what">{p.label}</p>
        <p className="ar-sub">
          {p.approved ? "Agreed: it happens at the next priority." : `Waiting for ${p.waitingOn.join(", ")}.`}
        </p>
        {p.needsMe && (
          <div className="ar-actions">
            <PressButton what="yes" sent={game.rewindSent} className="ar-btn primary" onClick={() => game.rewindVote(true)}>Yes, rewind</PressButton>
            <PressButton what="no" sent={game.rewindSent} className="ar-btn" onClick={() => game.rewindVote(false)}>No</PressButton>
          </div>
        )}
        {p.mine && !p.approved && (
          <PressButton what="cancel" sent={game.rewindSent} className="ar-skip" onClick={game.rewindCancel}>Take it back</PressButton>
        )}
      </section>
    );
  }

  const ask = (o: RewindPoint) => {
    setOpen(false);
    game.rewindTo(o.point, o.kind);
  };
  const undo = options.find((o) => o.last);
  return (
    <section className="rewind-panel">
      <header>
        <h3>Rewind</h3>
        <span className="ar-sub">{REWIND_LEVELS[rewind.level]?.label.toLowerCase()}</span>
      </header>
      <PressButton what={undo ? `ask:${undo.kind}:${undo.point}` : ""} sent={game.rewindSent} className="ar-skip" disabled={!undo} title={undo?.label ?? "Nothing of yours to take back this turn (or it showed you something new)"} onClick={() => undo && ask(undo)}>
        Undo last action
      </PressButton>
      {combat.map((o) => (
        <PressButton
          key={o.kind}
          what={`ask:${o.kind}:${o.point}`}
          sent={game.rewindSent}
          className="ar-skip"
          title={o.kind === "attackers" ? "Back to just before attackers were declared, to declare them again" : "Back to just before blockers were declared, to declare them again (add or change blockers)"}
          onClick={() => ask(o)}
        >
          {o.label}
        </PressButton>
      ))}
      {rewind.level >= 2 && (
        <button className="ar-skip" disabled={options.length < 2} aria-expanded={open} onClick={() => setOpen(!open)}>
          Timeline {open ? "▴" : "▾"}
        </button>
      )}
      {open && <Timeline options={options} onPick={(o) => confirm(`Rewind the game? ${o.label}`) && ask(o)} />}
    </section>
  );
}

/** The moments you can go back to, newest first, under a heading per step. */
function Timeline({ options, onPick }: { options: RewindPoint[]; onPick: (o: RewindPoint) => void }) {
  const groups: { key: string; title: string; items: RewindPoint[] }[] = [];
  for (const o of options) {
    const key = `${o.turn}|${o.phase}`;
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      g = { key, title: `Turn ${o.turn} · ${o.player} · ${o.phase}`, items: [] };
      groups.push(g);
    }
    g.items.push(o);
  }
  return (
    <ol className="rewind-timeline">
      {groups.map((g) => (
        <li key={g.key}>
          <div className="rewind-step">{g.title}</div>
          <ul>
            {g.items.map((o) => (
              <li key={`${o.kind}-${o.point}`}>
                <button title="Rewind to here" onClick={() => onPick(o)}>
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
