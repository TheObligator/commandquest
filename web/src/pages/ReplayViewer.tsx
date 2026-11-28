// Watching a replay (#/replay?id=…, docs/replays.md): the finished game on the usual table,
// every hand face up, moment by moment. Step through it, jump by turn, or let it play.
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useRoute } from "../app/router";
import { Loading } from "../components/Spinner";
import { useCardData } from "../game/cards";
import { KIND_ORDER, loadReplay, type Bookmark, type BookmarkKind, type Replay } from "../game/replay";
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
  const marks = useMemo(() => replay.bookmarks(), [replay]);
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

  // Arrow keys step, Shift+arrows jump a turn, [ and ] jump between bookmarks, space plays or pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") setI((n) => (e.shiftKey ? replay.turnStart(n, 1) : Math.min(last, n + 1)));
      else if (e.key === "ArrowLeft") setI((n) => (e.shiftKey ? replay.turnStart(n, -1) : Math.max(0, n - 1)));
      else if (e.key === " ") setPlaying((p) => !p);
      else if (e.key === "]" || e.key === "[") {
        const fwd = e.key === "]";
        setI((n) => (fwd ? marks.find((m) => m.frame > n) : [...marks].reverse().find((m) => m.frame < n))?.frame ?? n);
      }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, last, marks]);

  const nameOf = (pid: string) => view.players.find((p) => p.id === pid)?.name ?? pid;

  const jump = (dir: 1 | -1) => {
    const b = dir === 1 ? marks.find((m) => m.frame > i) : [...marks].reverse().find((m) => m.frame < i);
    if (b) setI(b.frame);
  };

  return (
    <>
      <TableBoard
        view={view}
        layout={layout}
        stops={st}
        priority={false}
        hand={{ onPlay: () => undefined, onClick: () => undefined }}
        onCardClick={() => undefined}
        rail={() => (
          <aside className="action-rail replay-rail">
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
      <div className="replay-bar">
        <div className="replay-now">
          <div className="replay-buttons">
            <button className="ar-btn mark" title="Previous bookmark ([)" onClick={() => jump(-1)} disabled={!marks.some((m) => m.frame < i)}>⇤</button>
            <button className="ar-btn" title="Previous turn (Shift+←)" onClick={() => setI(replay.turnStart(i, -1))} disabled={i === 0}>⏮</button>
            <button className="ar-btn" title="Back (←)" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>◀</button>
            <button className="ar-btn primary" title="Play / pause (space)" onClick={() => setPlaying(!playing)}>{playing ? "❚❚" : "▶"}</button>
            <button className="ar-btn" title="Forward (→)" onClick={() => setI(Math.min(last, i + 1))} disabled={i >= last}>▶</button>
            <button className="ar-btn" title="Next turn (Shift+→)" onClick={() => setI(replay.turnStart(i, 1))} disabled={i >= last}>⏭</button>
            <button className="ar-btn mark" title="Next bookmark (])" onClick={() => jump(1)} disabled={!marks.some((m) => m.frame > i)}>⇥</button>
          </div>
          <p className="small">
            <strong>Turn {view.turn}</strong> <span className="muted">· {nameOf(view.active)} · {view.step.replace(/_/g, " ").toLowerCase()} · moment {i + 1}/{last + 1}
            {replay.meta.truncated && i === last ? " · the recording stops here" : ""}</span>
          </p>
        </div>
        <Timeline replay={replay} marks={marks} i={i} last={last} onSeek={setI} />
        <div className="replay-settings">
          <select value={speed} onChange={(e) => setSpeed(e.target.value)} aria-label="Speed" title="Speed">
            {SPEEDS.map((s) => <option key={s.label}>{s.label}</option>)}
          </select>
          <select value={seat} onChange={(e) => setSeat(e.target.value)} aria-label="Seat" title="Whose seat is at the bottom of the table">
            {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <LayoutPicker layout={layout} onChange={setLayout} />
        </div>
      </div>
    </>
  );
}

const ICONS: Record<BookmarkKind, string> = { win: "🏆", out: "☠", wipe: "✹", commander: "♛", hit: "⚔", attack: "➶", spell: "✧" };

/** Marks closer than this (share of the track) draw as one. */
const CLUSTER = 0.012;

/** The scrubber across the bottom: turn ticks below, bookmarks above. */
function Timeline({ replay, marks, i, last, onSeek }: { replay: Replay; marks: Bookmark[]; i: number; last: number; onSeek: (i: number) => void }) {
  const [hover, setHover] = useState<Bookmark[] | null>(null);
  const minor = useMemo(() => replay.minorMarks(), [replay]);
  const at = (frame: number) => (last > 0 ? frame / last : 0);
  const turns = useMemo(() => replay.turnStarts(), [replay]);
  const every = Math.max(1, Math.ceil(turns.length / 24));
  const clusters = useMemo(() => {
    const out: Bookmark[][] = [];
    for (const m of marks) {
      const c = out[out.length - 1];
      if (c && at(m.frame) - at(c[0].frame) < CLUSTER) c.push(m);
      else out.push([m]);
    }
    return out;
  }, [marks, last]);
  const shown = hover;

  return (
    <div className="replay-timeline" style={{ "--at": `${at(i) * 100}%` } as React.CSSProperties}>
      <div className="rt-marks">
        {clusters.map((c) => {
          const kind = c.flatMap((m) => m.events).sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind))[0].kind;
          return (
            <button
              key={c[0].frame}
              className={`rt-mark k-${kind}${c.some((m) => m.frame === i) ? " on" : ""}`}
              style={{ left: `${at(c[0].frame) * 100}%` }}
              onClick={() => onSeek(c[0].frame)}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(c)}
              onBlur={() => setHover(null)}
              aria-label={c.flatMap((m) => m.events.map((e) => e.text)).join("; ")}
            >
              {ICONS[kind]}
              {c.length > 1 && <span className="rt-count">{c.length}</span>}
            </button>
          );
        })}
        {shown && (
          <div
            className="rt-tip"
            style={{ left: `${at(shown[0].frame) * 100}%`, transform: `translateX(${at(shown[0].frame) < 0.15 ? "-10%" : at(shown[0].frame) > 0.85 ? "-90%" : "-50%"})` }}
          >
            {shown.map((m) => (
              <div key={m.frame}>
                {m.events.map((e, k) => <div key={k}>{ICONS[e.kind]} {e.text}</div>)}
                <em>Turn {m.turn} · click to jump</em>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rt-minor">
        {minor.map((m) => (
          <button
            key={m.frame}
            tabIndex={-1}
            className={`rt-small k-${m.events[0].kind}${m.frame === i ? " on" : ""}`}
            style={{ left: `${at(m.frame) * 100}%` }}
            onClick={() => onSeek(m.frame)}
            onMouseEnter={() => setHover([m])}
            onMouseLeave={() => setHover(null)}
            aria-label={m.events.map((e) => e.text).join("; ")}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={last}
        value={i}
        aria-label="Moment"
        aria-valuetext={`Moment ${i + 1} of ${last + 1}, turn ${replay.turn(i)}`}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <div className="rt-turns" aria-hidden>
        {turns.map((t, k) => (
          <span key={t.frame} className="rt-tick" style={{ left: `${at(t.frame) * 100}%` }}>
            {k % every === 0 ? t.turn : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
