// Watching a replay (#/replay?id=…, docs/replays.md): the finished game on the usual table,
// every hand face up, moment by moment. Step through it, jump by turn, or let it play.
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useRoute } from "../app/router";
import { Loading } from "../components/Spinner";
import { useCardData } from "../game/cards";
import { loadReplay, type Replay } from "../game/replay";
import { LayoutPicker, TableBoard, useStored, useTableStops, type LayoutId } from "../game/TableBoard";
import type { GameView } from "../game/view";

const SPEEDS = [
  { label: "Slow", ms: 2000 },
  { label: "Normal", ms: 900 },
  { label: "Fast", ms: 300 },
];

export function ReplayViewer() {
  const { query } = useRoute();
  const id = query.get("id") ?? "";
  const info = useQuery(api.replays.get, id ? { id } : "skip");
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = info?.url;

  useEffect(() => {
    if (!url) return;
    let live = true;
    loadReplay(url).then(
      (r) => live && setReplay(r),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [url]);

  return (
    <div className="game">
      <div className="game-toolbar">
        <h1>
          {info?.title ?? "Replay"} <span className="muted small">replay · every hand shown</span>
        </h1>
        <span className="sb-spacer" />
        <a className="btn small ghost" href="#/replays">All replays</a>
      </div>
      {info === null ? (
        <div className="card live-start">
          <p>That replay wasn't found: it may have been replaced by newer games or deleted. <a className="link" href="#/replays">Your replays</a></p>
        </div>
      ) : error ? (
        <div className="card live-start"><p>{error}</p></div>
      ) : !replay ? (
        <Loading text="Loading the replay…" />
      ) : (
        <Player replay={replay} />
      )}
    </div>
  );
}

function Player({ replay }: { replay: Replay }) {
  const [layout, setLayout] = useStored<LayoutId>("cq.table.layout", "pod");
  const players = useMemo(() => replay.players(), [replay]);
  const [seat, setSeat] = useState(players[0]?.id ?? "");
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useStored<string>("cq.replay.speed", "Normal");
  const last = replay.length - 1;
  const view: GameView = useMemo(() => replay.view(i, seat), [replay, i, seat]);
  const st = useTableStops(view.viewer, view.players.slice(1).map((p) => p.id));

  const names = useMemo(() => {
    const all = new Set<string>();
    for (const p of view.players) for (const z of [p.hand, p.battlefield, p.graveyard, p.exile, p.command]) for (const c of z) if (c.name) all.add(c.name);
    for (const s of view.stack) if (s.card?.name) all.add(s.card.name);
    return [...all].sort();
  }, [view]);
  useCardData(names);

  useEffect(() => {
    if (!playing) return;
    if (i >= last) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setI((n) => Math.min(last, n + 1)), SPEEDS.find((s) => s.label === speed)?.ms ?? 900);
    return () => window.clearTimeout(t);
  }, [playing, i, last, speed]);

  // Arrow keys step, Shift+arrows jump a turn, space plays or pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") setI((n) => (e.shiftKey ? replay.turnStart(n, 1) : Math.min(last, n + 1)));
      else if (e.key === "ArrowLeft") setI((n) => (e.shiftKey ? replay.turnStart(n, -1) : Math.max(0, n - 1)));
      else if (e.key === " ") setPlaying((p) => !p);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, last]);

  const nameOf = (pid: string) => view.players.find((p) => p.id === pid)?.name ?? pid;

  return (
    <TableBoard
      view={view}
      layout={layout}
      stops={st}
      priority={false}
      hand={{ onPlay: () => undefined, onClick: () => undefined }}
      onCardClick={() => undefined}
      rail={() => (
        <aside className="action-rail replay-rail">
          <section className="replay-controls">
            <header>
              <h3>Turn {view.turn}</h3>
              <span className="ar-sub">{nameOf(view.active)} · {view.step.replace(/_/g, " ").toLowerCase()}</span>
            </header>
            <input
              type="range"
              min={0}
              max={last}
              value={i}
              aria-label="Moment"
              aria-valuetext={`Moment ${i + 1} of ${last + 1}, turn ${view.turn}`}
              onChange={(e) => setI(Number(e.target.value))}
            />
            <div className="replay-buttons">
              <button className="ar-btn" title="Previous turn (Shift+←)" onClick={() => setI(replay.turnStart(i, -1))} disabled={i === 0}>⏮</button>
              <button className="ar-btn" title="Back (←)" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>◀</button>
              <button className="ar-btn primary" title="Play / pause (space)" onClick={() => setPlaying(!playing)}>{playing ? "❚❚" : "▶"}</button>
              <button className="ar-btn" title="Forward (→)" onClick={() => setI(Math.min(last, i + 1))} disabled={i >= last}>▶</button>
              <button className="ar-btn" title="Next turn (Shift+→)" onClick={() => setI(replay.turnStart(i, 1))} disabled={i >= last}>⏭</button>
            </div>
            <div className="replay-settings">
              <label>
                Speed{" "}
                <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
                  {SPEEDS.map((s) => <option key={s.label}>{s.label}</option>)}
                </select>
              </label>
              <label>
                Seat{" "}
                <select value={seat} onChange={(e) => setSeat(e.target.value)} title="Whose seat is at the bottom of the table">
                  {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <LayoutPicker layout={layout} onChange={setLayout} />
            </div>
            <p className="muted small">Moment {i + 1} of {last + 1}{replay.meta.truncated && i === last ? " · the recording stops here" : ""}</p>
          </section>
          <section>
            <header><h3>What happened</h3></header>
            {replay.added(i).length === 0 ? (
              <p className="muted small">{i === 0 ? "The game begins." : "Priority passed."}</p>
            ) : (
              <ul className="replay-happened">
                {replay.added(i).slice(-8).map((l, k) => <li key={k}>{l}</li>)}
              </ul>
            )}
          </section>
          <section>
            <header><h3>Hands</h3></header>
            {view.players.slice(1).map((p) => (
              <p key={p.id} className="small replay-hand">
                <strong>{p.name}:</strong> {p.hand.length ? p.hand.map((c) => c.name ?? "?").join(", ") : <span className="muted">empty</span>}
              </p>
            ))}
          </section>
        </aside>
      )}
    />
  );
}
