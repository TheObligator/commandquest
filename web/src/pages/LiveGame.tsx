// A live game against Forge AI on the game server (#/game?deck=<id>). The table is the same board
// as the preview; the server sends this player's view and Forge's prompts (docs/game-protocol.md).
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useRoute } from "../app/router";
import { toast } from "../dom";
import { useCardData } from "../game/cards";
import { LiveRail } from "../game/LiveRail";
import { REWIND_LEVELS } from "../game/RewindPanel";
import { LayoutPicker, TableBoard, useStored, useTableStops, type LayoutId, type MenuPart, type MenuTarget } from "../game/TableBoard";
import { useHotkeys } from "../game/useHotkeys";
import { useLiveGame, type DeckPayload } from "../game/useLiveGame";
import { tokenArtMap } from "../tokens";
import { useDeckTokens } from "../useDeckTokens";
import type { CardView, GameView, RewindLevel } from "../game/view";
import type { MenuSection } from "../components/CardMenu";
import { CounterDialog } from "../game/CounterDialog";
import { PayPrompt } from "../game/PayPrompt";
import { LibraryDialog, type LibraryCountAction } from "../game/LibraryDialog";

export function LiveGame() {
  const { query } = useRoute();
  const deckId = query.get("deck") ?? "";
  const { isAuthenticated } = useConvexAuth();
  const deck = useQuery(api.decks.get, isAuthenticated && deckId ? { id: deckId } : "skip");
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [layout, setLayout] = useStored<LayoutId>("cq.table.layout", "pod");
  const [opponents, setOpponents] = useState(3);
  const [freePlay, setFreePlay] = useStored<boolean>("cq.game.freePlay", true);
  const [rewindPref, setRewindPref] = useStored<string>("cq.game.rewind", "2");
  const rewind = (Math.max(0, Math.min(4, Number(rewindPref) || 0)) as RewindLevel);
  const game = useLiveGame();
  const { tokens } = useDeckTokens(deck?.cards, deck?.tokenArt);

  useEffect(() => {
    if (game.error) {
      toast(game.error, "error");
      game.clearError();
    }
  }, [game.error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Why a click did nothing (e.g. a land in your upkeep), from the game server.
  useEffect(() => {
    if (game.notice) toast(game.notice.message);
  }, [game.notice]);

  // What happened to a rewind request ("Bob declined to rewind.", "Rewound: …").
  const rewindNote = game.view?.rewind?.noteId;
  useEffect(() => {
    const note = game.view?.rewind?.note;
    if (note && rewindNote) toast(note);
  }, [rewindNote]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (!deck) return;
    const payload: DeckPayload = { name: deck.name, cards: deck.cards.map((c) => ({ name: c.name, quantity: c.quantity, board: c.board, set: c.set, collectorNumber: c.collectorNumber })), tokens: tokenArtMap(tokens) };
    game.start(payload, me?.name ?? "You", opponents, freePlay, rewind);
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
          <span className="muted">{gameOverText(game.view?.log ?? [], game.view?.players[0]?.name ?? "")}</span>
          <span className="sb-spacer" />
          <button className="btn small" onClick={start} disabled={!deck}>Play again</button>
          <a className="btn small ghost" href="#/replays" title="The replay is ready a few seconds after the game ends">Replays</a>
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
              <label className="live-option">
                <input type="checkbox" checked={freePlay} onChange={(e) => setFreePlay(e.target.checked)} />
                <span>
                  Free play
                  <span className="muted small">
                    {" "}Fix things by hand like at a paper table: tap, move and copy cards, add counters, and cast a spell
                    without paying its mana cost when a card that should allow it doesn't. The log shows everything done by
                    hand. Off: only the cards' own effects change the game.
                  </span>
                </span>
              </label>
              <label className="live-option rewind-option">
                <span>
                  Rewind: <strong>{REWIND_LEVELS[rewind]?.label ?? "Off"}</strong>
                  <span className="muted small"> {REWIND_LEVELS[rewind]?.hint} Everyone else in the game has to agree to a rewind.</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={1}
                  value={rewind}
                  list="rewind-levels"
                  aria-valuetext={REWIND_LEVELS[rewind]?.label}
                  onChange={(e) => setRewindPref(e.target.value)}
                />
                <datalist id="rewind-levels">
                  {REWIND_LEVELS.map((l) => (
                    <option key={l.level} value={l.level} label={l.label} />
                  ))}
                </datalist>
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

/** Who won, from Forge's game log ("AI 1 has won because all opponents have lost"). */
function gameOverText(log: string[], me: string): string {
  const line = [...log].reverse().find((l) => /\bhas won\b|\bhave won\b|\bdraw\b/i.test(l));
  if (!line) return log.at(-1) ?? "";
  if (me && line.startsWith(`${me} has won`)) return "You won" + line.slice(`${me} has won`.length);
  return line.replace(/ has won/, " won");
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
    for (const c of game.libraryList?.cards ?? []) if (c.name) all.add(c.name);
    return [...all].sort();
  }, [view, game.libraryList]);
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
  // A double-click is two clicks: the second would hit the card again once it's in play (and tap a
  // land you just played for mana). One click per card per half second.
  const lastClick = useRef({ id: -1, at: 0 });
  const click = (id: number) => {
    const now = performance.now();
    if (lastClick.current.id === id && now - lastClick.current.at < 500) return;
    lastClick.current = { id, at: now };
    castFrom.current ??= view.stack.length;
    game.clickCard(id);
  };
  // What Forge's prompt lets you click: cards to pick or target, and while paying, your mana sources.
  const sel = view.selection;
  const selectable = useMemo(() => new Set([...(sel?.cards ?? []), ...(game.prompt?.pay?.sources ?? [])]), [sel, game.prompt?.pay]);
  const chosen = useMemo(() => new Set((sel?.chosen ?? []).filter((x): x is number => typeof x === "number")), [sel]);
  const targetPlayers = useMemo(() => new Set(sel?.players ?? []), [sel]);
  const playable = useMemo(() => new Set(game.prompt && isPriorityPrompt(game.prompt) && !game.ask ? view.playable ?? [] : []), [view.playable, game.prompt, game.ask]);

  // Right-click menus. Forge's abilities for the card (enabled when you can use them now), then
  // the things players do by hand at a paper table: tap, counters, move it to another zone…
  const [counterFor, setCounterFor] = useState<CardView | null>(null);
  const me = view.viewer;
  const opponents = view.players.slice(1);

  /** A counter row: "+1/+1 (2)" with + and − buttons. Counters work on any permanent. */
  const counterRow = (card: CardView, kind: string): MenuSection["items"][number] => {
    const n = card.counters?.[kind] ?? 0;
    return {
      label: `${kind === "Loyalty" ? "Loyalty" : kind}${n ? ` (${n})` : ""}`,
      keepOpen: true,
      onSelect: () => game.counter(card.id, kind, 1),
      steppers: [
        { label: "+", title: `Add a ${kind} counter`, onSelect: () => game.counter(card.id, kind, 1) },
        { label: "−", title: `Remove a ${kind} counter`, onSelect: () => n > 0 && game.counter(card.id, kind, -1) },
      ],
    };
  };

  const moves = (card: CardView): MenuSection["items"] => {
    const go = (action: Parameters<typeof game.manual>[1]) => () => game.manual(card.id, action);
    const items: MenuSection["items"] = [];
    if (card.zone !== "battlefield") items.push({ label: "Put onto the battlefield", onSelect: go("toBattlefield") });
    if (card.zone !== "hand") items.push({ label: card.zone === "battlefield" ? "Return to hand" : "Put into hand", onSelect: go("toHand") });
    if (card.zone !== "graveyard") items.push({ label: "Put into graveyard", onSelect: go("toGraveyard") });
    if (card.zone !== "exile") items.push({ label: "Exile", onSelect: go("toExile") });
    if (card.zone !== "command") items.push({ label: "Command zone", onSelect: go("toCommand") });
    items.push({ label: "On top of library", onSelect: go("toLibraryTop") });
    items.push({ label: "On the bottom of library", onSelect: go("toLibraryBottom") });
    return items;
  };

  /** Reveal to ▸ Everyone (the only choice 1v1), or one opponent. */
  const revealItem = (card: CardView): MenuSection["items"][number] => ({
    label: "👁 Reveal to",
    onSelect: () => {},
    submenu: [
      { label: "Everyone", onSelect: () => game.manual(card.id, "reveal", opponents.map((p) => p.id)) },
      ...(opponents.length > 1 ? opponents.map((p) => ({ label: p.name, onSelect: () => game.manual(card.id, "reveal", [p.id]) })) : []),
    ],
  });

  // Free play on your library: search it or look at its top cards (a viewer only you see, where
  // right-clicking a card moves it), and draw, mill, exile, reveal or shuffle by hand.
  const myLibrary = view.players[0].libraryCount;
  /** Changes when your library might have: its size, or a new line in the game log (a shuffle). */
  const libKey = `${myLibrary}|${view.log.length}|${view.log.at(-1) ?? ""}`;
  const [peek, setPeek] = useState<{ top: number; ids?: Set<number> } | null>(null);
  const [libDialog, setLibDialog] = useState<LibraryCountAction | null>(null);
  const openPeek = (top: number) => {
    setPeek({ top });
    peekKey.current = libKey;
    game.listLibrary(top, true);
  };
  const closePeek = () => {
    setPeek(null);
    game.clearLibraryList();
  };
  // Keep the list current as cards leave or the library is shuffled.
  const peekKey = useRef("");
  useEffect(() => {
    if (!peek) return;
    if (libKey === peekKey.current) return;
    peekKey.current = libKey;
    game.listLibrary(peek.top, false);
  }, [peek, libKey, game]);
  // Looking at the top N: only those cards stay in view (the next ones don't slide in as they leave).
  useEffect(() => {
    const list = game.libraryList;
    if (peek && peek.top > 0 && !peek.ids && list && list.top === peek.top) setPeek({ ...peek, ids: new Set(list.cards.map((c) => c.id)) });
  }, [game.libraryList, peek]);
  const peekCards = !peek || !game.libraryList || game.libraryList.top !== peek.top
    ? []
    : peek.ids ? game.libraryList.cards.filter((c) => peek.ids!.has(c.id)) : game.libraryList.cards;
  const librarySection = (): MenuSection => {
    const empty = myLibrary === 0;
    return {
      title: "Library (by hand)",
      items: [
        { label: "Draw a card", disabled: empty, onSelect: () => game.library("draw", 1) },
        { label: "🔍 Search library", disabled: empty, onSelect: () => openPeek(0) },
        { label: "Look at the top cards…", disabled: empty, onSelect: () => setLibDialog("look") },
        {
          label: "👁 Reveal the top card to",
          disabled: empty,
          onSelect: () => {},
          submenu: [
            { label: "Everyone", onSelect: () => game.library("revealTop", 1, opponents.map((p) => p.id)) },
            ...(opponents.length > 1 ? opponents.map((p) => ({ label: p.name, onSelect: () => game.library("revealTop", 1, [p.id]) })) : []),
          ],
        },
        { label: "Mill a card", disabled: empty, onSelect: () => game.library("mill", 1) },
        { label: "Exile the top card", disabled: empty, onSelect: () => game.library("exile", 1) },
        { label: "Draw, mill or exile several…", disabled: empty, onSelect: () => setLibDialog("draw") },
        { label: "🔀 Shuffle", onSelect: () => game.library("shuffle") },
      ],
    };
  };

  const manualSection = (card: CardView): MenuSection => {
    if (view.freePlay === false) return { items: [] };
    const mine = (card.zone === "battlefield" ? card.controller : card.owner) === me;
    const items: MenuSection["items"] = [];
    if (card.zone === "battlefield") {
      if (mine) {
        items.push({ label: card.tapped ? "Untap" : "Tap", onSelect: () => game.manual(card.id, card.tapped ? "untap" : "tap") });
        items.push({ label: card.faceDown ? "Turn face up" : "Turn face down", onSelect: () => game.manual(card.id, card.faceDown ? "faceUp" : "faceDown") });
      }
      const kinds = ["+1/+1", ...(card.counters?.["-1/-1"] ? ["-1/-1"] : []), ...(card.types?.includes("Planeswalker") ? ["Loyalty"] : [])];
      for (const k of Object.keys(card.counters ?? {})) if (!kinds.includes(k)) kinds.push(k);
      for (const k of kinds) items.push(counterRow(card, k));
      if (mine) {
        if (card.untapLock) {
          items.push({ label: "🔓 Untaps normally", onSelect: () => game.manual(card.id, "untapNormally") });
        }
        if (card.untapLock !== "next" && card.untapLock !== "never") items.push({ label: "🔒 Doesn't untap next turn", onSelect: () => game.manual(card.id, "skipUntap") });
        if (card.untapLock !== "never") items.push({ label: "🔒 Never untaps by itself", onSelect: () => game.manual(card.id, "neverUntap") });
      }
      items.push({ label: "Counter…", onSelect: () => setCounterFor(card), steppers: [] });
      if (mine) items.push({ label: "Create a token copy", onSelect: () => game.manual(card.id, "tokenCopy") });
      if (mine) items.push(...moves(card));
    } else if (mine) {
      if (card.zone === "hand") items.push(revealItem(card));
      items.push(...moves(card));
    }
    return { items };
  };

  // Until combat damage, a creature of yours can be put in or taken out of the attack (or the blocks):
  // a rewind to just before they were declared, with the rest declared as before (docs/rewind.md).
  const combatSection = (card: CardView): MenuSection => {
    const rw = view.rewind;
    if (!rw?.level || card.zone !== "battlefield" || card.controller !== me || !card.types?.includes("Creature")) return { items: [] };
    const attacking = view.active === me;
    const kind = attacking ? "attackers" : "blockers";
    if (!rw.options?.some((o) => o.kind === kind)) return { items: [] };
    const inIt = attacking ? !!card.attacking : !!card.blocking;
    const label = attacking
      ? inIt ? `Stop attacking with ${card.name}` : `Attack with ${card.name} too`
      : inIt ? `Stop blocking with ${card.name}` : `Block with ${card.name} too`;
    return {
      title: "Combat (rewind)",
      items: [{ label: `↶ ${label}`, disabled: !!rw.pending, onSelect: () => game.rewindChange(card.id) }],
    };
  };

  const menuFor = (t: MenuTarget): MenuPart | Promise<MenuPart> => {
    const passing: MenuPart["sections"] = [
      {
        title: "Priority",
        items: [
          { label: game.prompt?.ok.label && game.prompt.ok.label !== "OK" ? game.prompt.ok.label : "Pass priority (OK)", disabled: !game.prompt?.ok.enabled, onSelect: ok },
          { label: "Pass until end of turn", onSelect: () => game.setAutoPass("END_OF_TURN") },
          { label: "Pass until my turn", onSelect: () => game.setAutoPass("BEFORE_MY_TURN") },
        ],
      },
    ];
    if (t.kind === "zone" && t.zone === "library" && t.owner === me) {
      return view.freePlay === false
        ? { sections: passing, note: "Free play is off in this game, so your library can't be changed by hand." }
        : { sections: [librarySection(), ...passing] };
    }
    if (t.kind !== "card") return { sections: passing };
    const card = t.card;
    if (card.hidden) return { sections: card.zone === "battlefield" ? [combatSection(card), manualSection(card)] : [] };
    return game.actions(card.id).then(({ actions, reason }) => ({
      sections: [
        {
          title: actions.length ? "Abilities" : undefined,
          items: actions.map((a) => ({
            label: a.label,
            disabled: !a.enabled,
            onSelect: () => {
              castFrom.current ??= view.stack.length;
              game.useAbility(card.id, a);
            },
          })),
        },
        combatSection(card),
        manualSection(card),
      ],
      note: actions.length && !actions.some((a) => a.enabled) ? reason : undefined,
    }));
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
    // Wait for OK to be enabled: Forge can show the priority buttons disabled for a moment first.
    if (!castDone.current || !p || game.ask || !isPriorityPrompt(p) || !p.ok.enabled) return;
    castDone.current = false;
    if (!st.holdPriority) game.ok();
  }, [game.prompt, game.ask, view, st.holdPriority, game]);
  const ok = () => {
    // Only OK at "you have priority" passes; OK while casting (Auto-pay, skipping convoke, done
    // choosing targets) is part of the cast, so keep watching for it to land.
    if (game.prompt && isPriorityPrompt(game.prompt)) {
      castFrom.current = null;
      castDone.current = false;
    }
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
    <>
    {game.prompt?.pay && !game.ask && <PayPrompt prompt={game.prompt} game={{ ok, cancel, payFree: game.payFree }} />}
    {libDialog && (
      <LibraryDialog
        size={myLibrary}
        initial={libDialog}
        onClose={() => setLibDialog(null)}
        onApply={(action, n) => (action === "look" ? openPeek(n) : game.library(action, n))}
      />
    )}
    {counterFor && (
      <CounterDialog
        card={counterFor}
        onClose={() => setCounterFor(null)}
        onApply={(type, delta) => game.counter(counterFor.id, type, delta)}
      />
    )}
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
      playable={playable}
      selectable={selectable}
      chosen={chosen}
      targetPlayers={targetPlayers}
      menuFor={menuFor}
      detailsFor={game.details}
      peek={peek ? { title: peek.top > 0 ? `Top ${peek.top === 1 ? "card" : `${peek.top} cards`} of your library` : "Your library (only you see this)", cards: peekCards, onClose: closePeek } : null}
      stackItemMenu={(s) => {
        const tick = (on: boolean | undefined, label: string) => `${on ? "✓ " : ""}${label}`;
        const key = s.yieldKey;
        return [
          {
            items: key
              ? [
                  { label: tick(s.autoYield, "Auto-yield"), onSelect: () => game.setYield(key, { autoYield: !s.autoYield }) },
                  ...(s.optional
                    ? [
                        { label: tick(s.decision === "ACCEPT", "Always Yes"), onSelect: () => game.setYield(key, { decision: s.decision === "ACCEPT" ? "ASK" : "ACCEPT" }) },
                        { label: tick(s.decision === "DECLINE", "Always No"), onSelect: () => game.setYield(key, { decision: s.decision === "DECLINE" ? "ASK" : "DECLINE" }) },
                      ]
                    : []),
                ]
              : [],
          },
          { items: [{ label: tick(view.autoYieldsOff, "Disable auto-yields"), onSelect: () => game.setYieldsOff(!view.autoYieldsOff) }] },
        ];
      }}
    />
    </>
  );
}

/** Forge's "you have priority" prompt (InputPassPriority): OK, and End Turn or Undo. */
function isPriorityPrompt(p: { ok: { label: string }; cancel: { label: string } }) {
  return p.ok.label === "OK" && (p.cancel.label === "End Turn" || p.cancel.label.startsWith("Undo"));
}
