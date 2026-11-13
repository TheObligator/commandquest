// Rewinding (docs/rewind.md): the game's timeline in the rail. Pick a moment to go back to; when
// other people are playing they all have to agree, and a request from someone else shows here
// with Yes / No.
import { useState } from "react";
import type { LiveGame } from "./useLiveGame";
import type { RewindLevel, RewindPoint, RewindView } from "./view";

/** What each host setting allows, for the setup screen and the rail. */
export const REWIND_LEVELS: { level: RewindLevel; label: string; hint: string }[] = [
  { level: 0, label: "Off", hint: "No rewinding in this game." },
  { level: 1, label: "Last action", hint: "Take back the last thing that happened." },
  { level: 2, label: "This step", hint: "Back to any moment in the current step or phase." },
  { level: 3, label: "This turn", hint: "Back to any moment of the current turn." },
  { level: 4, label: "Last turn", hint: "Back into the previous turn: replay a whole turn." },
];

export function RewindPanel({ game, rewind }: { game: LiveGame; rewind: RewindView }) {
  const [open, setOpen] = useState(false);
  const p = rewind.pending;
  const options = rewind.options ?? [];

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
            <button className="ar-btn primary" onClick={() => game.rewindVote(true)}>Yes, rewind</button>
            <button className="ar-btn" onClick={() => game.rewindVote(false)}>No</button>
          </div>
        )}
        {p.mine && !p.approved && (
          <button className="ar-skip" onClick={game.rewindCancel}>Take it back</button>
        )}
      </section>
    );
  }

  const ask = (o: RewindPoint) => {
    setOpen(false);
    game.rewindTo(o.point);
  };
  const undo = options[0];
  return (
    <section className="rewind-panel">
      <header>
        <h3>Rewind</h3>
        <span className="ar-sub">{REWIND_LEVELS[rewind.level]?.label.toLowerCase()}</span>
      </header>
      <button className="ar-skip" disabled={!undo} title={undo?.label} onClick={() => undo && ask(undo)}>
        Undo last action
      </button>
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
              <li key={o.point}>
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
