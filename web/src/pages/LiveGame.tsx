// A live game against Forge AI on the game server (#/game?deck=<id>). The table is the same board
// as the preview; the server sends this player's view and Forge's prompts (docs/game-protocol.md).
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useRoute } from "../app/router";
import { toast } from "../dom";
import { useCardData } from "../game/cards";
import { LiveRail } from "../game/LiveRail";
import { LayoutPicker, TableBoard, useStored, useTableStops, type LayoutId } from "../game/TableBoard";
import { useHotkeys } from "../game/useHotkeys";
import { useLiveGame, type DeckPayload } from "../game/useLiveGame";
import { tokenArtMap } from "../tokens";
import { useDeckTokens } from "../useDeckTokens";
import type { GameView } from "../game/view";

export function LiveGame() {
  const { query } = useRoute();
  const deckId = query.get("deck") ?? "";
  const { isAuthenticated } = useConvexAuth();
  const deck = useQuery(api.decks.get, isAuthenticated && deckId ? { id: deckId } : "skip");
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [layout, setLayout] = useStored<LayoutId>("cq.table.layout", "pod");
  const [opponents, setOpponents] = useState(3);
  const game = useLiveGame();
  const { tokens } = useDeckTokens(deck?.cards, deck?.tokenArt);

  useEffect(() => {
    if (game.error) {
      toast(game.error, "error");
      game.clearError();
    }
  }, [game.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (!deck) return;
    const payload: DeckPayload = { name: deck.name, cards: deck.cards.map((c) => ({ name: c.name, quantity: c.quantity, board: c.board, set: c.set, collectorNumber: c.collectorNumber })), tokens: tokenArtMap(tokens) };
    game.start(payload, me?.name ?? "You", opponents);
  };

  const playing = game.view && (game.status === "playing" || game.status === "over");

  return (
    <div className="game">
      <div className="game-toolbar">
        <h1>
          {deck?.name ?? "Game"} <span className="muted small">vs Forge AI</span>
        </h1>
        <span className="status" data-state={game.status === "offline" ? "closed" : "open"}>
          {STATUS[game.status]}
        </span>
        {playing && game.status === "playing" && (
          <button className="btn small ghost" onClick={() => confirm("Concede this game?") && game.concede()}>
            Concede
          </button>
        )}
        <span className="sb-spacer" />
        <LayoutPicker layout={layout} onChange={setLayout} />
      </div>

      {game.status === "over" && (
        <div className="live-banner">
          <strong>Game over.</strong>
          <span className="muted">{game.view?.log.at(-1)}</span>
          <span className="sb-spacer" />
          <button className="btn small" onClick={start} disabled={!deck}>Play again</button>
          <a className="btn small ghost" href="#/play">Back</a>
        </div>
      )}

      {playing ? (
        <LiveTable game={game} view={game.view!} layout={layout} />
      ) : (
        <div className="card live-start">
          {!deckId ? (
            <p>Pick a deck on the <a className="link" href="#/play">Play page</a> first.</p>
          ) : deck === null ? (
            <p>That deck wasn't found. <a className="link" href="#/play">Back to Play</a></p>
          ) : (
            <>
              <h2>Quick game</h2>
              <p className="muted">
                You and Forge AI opponents playing Commander precons that ship with Forge. The game runs on the CommandQuest
                game server; if you close this tab, the game ends.
              </p>
              <label>
                Opponents{" "}
                <select value={opponents} onChange={(e) => setOpponents(Number(e.target.value))}>
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button className="btn" onClick={start} disabled={!deck || game.status !== "ready"}>
                {game.status === "starting" ? "Starting…" : game.status === "ready" ? "Start game" : STATUS[game.status]}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS: Record<ReturnType<typeof useLiveGame>["status"], string> = {
  connecting: "Connecting to the game server…",
  "signing-in": "Signing in…",
  ready: "Game server online",
  starting: "Starting the game…",
  playing: "Playing",
  over: "Game over",
  offline: "Game server offline, retrying…",
};

function LiveTable({ game, view, layout }: { game: ReturnType<typeof useLiveGame>; view: GameView; layout: LayoutId }) {
  const oppIds = useMemo(() => view.players.slice(1).map((p) => p.id), [view.players.map((p) => p.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useTableStops(view.viewer, oppIds);
  const names = useMemo(() => {
    const all = new Set<string>();
    for (const p of view.players) for (const z of [p.hand, p.battlefield, p.graveyard, p.exile, p.command]) for (const c of z) if (c.name) all.add(c.name);
    for (const s of view.stack) if (s.card?.name) all.add(s.card.name);
    return [...all].sort();
  }, [view]);
  useCardData(names);

  // Send your stops to the server at the start and whenever you change them.
  const sentStops = useRef("");
  const commander = view.players[0].command.find((c) => c.commander);
  useEffect(() => {
    const record: Record<string, string[]> = {};
    for (const [player, steps] of st.stops) record[player] = [...steps];
    const key = JSON.stringify(record);
    if (key !== sentStops.current) {
      sentStops.current = key;
      game.setStops(record as Record<string, never[]>);
    }
  }, [st.stops, game]);

  // Hold priority off (the default): once something you cast or activated goes on the stack and
  // Forge gives you priority back, pass right away, like MTGO. On: you keep priority to do more.
  // `castFrom`: the stack when you started (clicked a card). Once your item is on top of a bigger
  // stack, the next priority prompt (Forge's OK + End Turn / Undo) is passed. Other prompts, like
  // paying mana or choosing targets, are left alone.
  const castFrom = useRef<number | null>(null);
  const castDone = useRef(false);
  const click = (id: number) => {
    castFrom.current ??= view.stack.length;
    game.clickCard(id);
  };
  const stepKey = `${view.turn}|${view.step}`;
  useEffect(() => {
    castFrom.current = null;
    castDone.current = false;
  }, [stepKey]);
  useEffect(() => {
    if (castFrom.current !== null && view.stack.length > castFrom.current && view.stack.at(-1)?.controller === view.viewer) {
      castFrom.current = null;
      castDone.current = true;
    }
    const p = game.prompt;
    if (!castDone.current || !p || game.ask || !isPriorityPrompt(p)) return;
    castDone.current = false;
    if (!st.holdPriority && p.ok.enabled) game.ok();
  }, [game.prompt, game.ask, view, st.holdPriority, game]);
  const ok = () => {
    castFrom.current = null;
    castDone.current = false;
    game.ok();
  };
  const cancel = () => {
    castFrom.current = null;
    castDone.current = false;
    game.cancel();
  };

  // Your hotkeys (Settings): auto-pass skips, hold priority, cast your commander.
  useHotkeys({
    autoEndOfTurn: () => game.setAutoPass("END_OF_TURN"),
    autoBeforeMyTurn: () => game.setAutoPass("BEFORE_MY_TURN"),
    autoActionOrEnd: () => game.setAutoPass("ACTION_OR_END_STEP"),
    holdPriority: () => st.setHoldPriority(!st.holdPriority),
    castCommander: () => (commander ? click(commander.id) : false),
  });

  const seatOf = (id: string) => view.players.find((p) => p.id === id);
  const nameOf = (id: string) => (id === view.viewer ? "you" : seatOf(id)?.name ?? id);
  const colorOf = (id: string) => seatOf(id)?.color ?? "#888";

  return (
    <TableBoard
      view={view}
      layout={layout}
      stops={st}
      priority={!!game.prompt?.ok.enabled || !!game.ask}
      rail={(preview) => <LiveRail game={{ ...game, ok, cancel, clickCard: click }} nameOf={nameOf} colorOf={colorOf} preview={preview} />}
      hand={{ onPlay: click, onClick: click }}
      onCardClick={click}
      onPlayerClick={game.clickPlayer}
      onCastCommander={click}
    />
  );
}

/** Forge's "you have priority" prompt (InputPassPriority): OK, and End Turn or Undo. */
function isPriorityPrompt(p: { ok: { label: string }; cancel: { label: string } }) {
  return p.ok.label === "OK" && (p.cancel.label === "End Turn" || p.cancel.label.startsWith("Undo"));
}
