// A live game on the game server. A quick game against Forge AI (#/game?deck=<id>): before the game
// starts this is where you pick your deck (the choice is kept in the URL and remembered). A
// multiplayer table's game (#/game?table=<id>, docs/tables.md): joins it with the deck picked at the
// table. The table is the same board as the preview; the server sends this player's view and
// Forge's prompts (docs/game-protocol.md).
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { navigate, useRoute } from "../app/router";
import { errorMessage } from "../app/errors";
import { useCardSupport } from "../cardsupport";
import { useGameChecks } from "../useGameDecks";
import { toast } from "../dom";
import { AbilityPanel, AbilityProvider, abilityItems, type AbilityControls } from "../game/AbilityMenu";
import "../game/abilityMarks.css";
import { BusyLabel, Spinner, Waiting } from "../components/Spinner";
import { useCardData } from "../game/cards";
import { LaterProvider, laterItems, type LaterControls } from "../game/LaterMenu";
import { canPickStep, type LaterSpec } from "../game/later";
import type { MyZones } from "../game/spellbook";
import { useDeckCombos } from "../useDeckCombos";
import { LiveRail } from "../game/LiveRail";
import { REWIND_LEVELS } from "../game/RewindPanel";
import { LAYOUTS, LayoutPicker, TableBoard, useStored, useTableStops, type LayoutId, type MenuPart, type MenuTarget } from "../game/TableBoard";
import { useHotkeys } from "../game/useHotkeys";
import { useTablePresence } from "../game/useTablePresence";
import { useLiveGame, type DeckPayload, type ManaOptions, type StandIn } from "../game/useLiveGame";
import * as scry from "../scryfall";
import { ManaDialog, type ManaDialogCard } from "../game/ManaDialog";
import { painText, symbols } from "../game/manaPlan";
import { useLandCheck } from "../game/useLandCheck";
import type { AutoPassMode } from "../game/phases";
import { tokenArtMap } from "../tokens";
import { useDeckTokens } from "../useDeckTokens";
import { isPermanentCard, type CardView, type GameView, type RewindLevel } from "../game/view";
import { usePreloadZoom } from "../game/CardZoom";
import type { MenuSection } from "../components/CardMenu";
import { CounterDialog } from "../game/CounterDialog";
import { PayPrompt } from "../game/PayPrompt";
import { ManaChoice } from "../game/ManaChoice";
import { manaChoiceFor } from "../game/manaOptions";
import { LibraryDialog, type LibraryCountAction } from "../game/LibraryDialog";
import { AskPick, PickDialog } from "../game/PickDialog";
import { askBoard, askPickCards, pickPiles, pilesFor } from "../game/pickZones";
import { askInWindow, DecisionWindow } from "../game/DecisionWindow";
import { TargetBar } from "../game/TargetBar";
import { ScryDialog, type ArrangeKind } from "../game/ScryDialog";
import { ShownWindow } from "../game/CardWindow";
import { TopLayer } from "../game/TopLayer";
import { CostDialog } from "../game/CostDialog";
import { isAttackPrompt, type AttackTarget } from "../game/AttackArrows";

/** Combat steps once attackers are declared: when a creature can be put into combat attacking. */
const AFTER_ATTACKERS = new Set<string>(["COMBAT_DECLARE_ATTACKERS", "COMBAT_DECLARE_BLOCKERS", "COMBAT_FIRST_STRIKE_DAMAGE", "COMBAT_DAMAGE"]);

/** Counters people put on by hand most, for "Add a counter ▸" (Forge's names). Any other: "Counter…". */
const QUICK_COUNTERS = ["+1/+1", "-1/-1", "Loyalty", "Shield", "Stun", "Charge", "Lore", "Time", "Oil", "Finality",
  "Flying", "First Strike", "Deathtouch", "Lifelink", "Trample", "Menace", "Reach", "Vigilance", "Hexproof", "Indestructible"];

/** "Until end of turn ▸" groups: [server key (ManualActions.EOT), label]. `creature`: only on creatures. */
const EOT_GROUPS: { label: string; creature?: boolean; items: [string, string][] }[] = [
  { label: "Power / toughness", creature: true, items: [
    ["pt:+1:+1", "+1/+1"], ["pt:+2:+2", "+2/+2"], ["pt:+3:+3", "+3/+3"], ["pt:+1:+0", "+1/+0"], ["pt:+2:+0", "+2/+0"],
    ["pt:-1:-1", "−1/−1"], ["pt:-2:-2", "−2/−2"], ["pt:-3:-3", "−3/−3"], ["pt:-1:+0", "−1/−0"], ["pt:-2:+0", "−2/−0"],
    ["switchPT", "Switch power and toughness"],
  ] },
  { label: "Evasion and combat", creature: true, items: [
    ["unblockable", "Can't be blocked"], ["flying", "Flying"], ["menace", "Menace"], ["trample", "Trample"],
    ["firstStrike", "First strike"], ["doubleStrike", "Double strike"], ["vigilance", "Vigilance"], ["haste", "Haste"],
    ["lifelink", "Lifelink"], ["deathtouch", "Deathtouch"], ["reach", "Reach"],
  ] },
  { label: "Restrictions", creature: true, items: [
    ["cantBlock", "Can't block"], ["cantAttack", "Can't attack"], ["cantAttackOrBlock", "Can't attack or block"],
    ["mustBeBlocked", "Must be blocked if able"], ["lure", "All creatures able to block it do so"],
    ["preventDealtBy", "Prevent the combat damage it would deal"], ["preventDealtTo", "Prevent all damage dealt to it"],
  ] },
  { label: "Protection", items: [
    ["indestructible", "Indestructible"], ["hexproof", "Hexproof"], ["shroud", "Shroud"],
    ["protWhite", "Protection from white"], ["protBlue", "Protection from blue"], ["protBlack", "Protection from black"],
    ["protRed", "Protection from red"], ["protGreen", "Protection from green"], ["protEverything", "Protection from everything"],
  ] },
];

export function LiveGame() {
  const { query } = useRoute();
  const { isAuthenticated } = useConvexAuth();
  // Decks that can't start a game aren't offered here; the Decks page marks them and says why.
  const decks = useQuery(api.decks.forPlay, isAuthenticated ? {} : "skip");
  const checks = useGameChecks(decks);
  const ready = checks && decks ? decks.filter((d) => !checks.get(d._id)?.problems.length) : undefined;
  const notReady = checks && decks ? decks.length - (ready?.length ?? 0) : 0;
  const [lastDeck, setLastDeck] = useStored<string>("cq.game.deck", "");
  const urlDeck = query.get("deck") ?? "";
  // A table's game: the table and the deck you picked there.
  const tableParam = query.get("table") ?? "";
  const table = useQuery(api.tables.get, isAuthenticated && tableParam ? { id: tableParam } : "skip");
  useTablePresence(table?._id);
  const deckId = tableParam
    ? (table?.me.deckId ?? "")
    : urlDeck || (ready?.some((d) => d._id === lastDeck) ? lastDeck : ready?.[0]?._id) || "";
  const pickDeck = (id: string) => {
    setLastDeck(id);
    navigate(`/game?deck=${encodeURIComponent(id)}`, true);
  };
  const deck = useQuery(api.decks.get, isAuthenticated && deckId ? { id: deckId } : "skip");
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [layout, setLayout] = useStored<LayoutId>("cq.table.layout", "pod");
  const [opponents, setOpponents] = useState(3);
  const [freePlay, setFreePlay] = useStored<boolean>("cq.game.freePlay", true);
  const [rewindPref, setRewindPref] = useStored<string>("cq.game.rewind", "2");
  const rewind = (Math.max(0, Math.min(4, Number(rewindPref) || 0)) as RewindLevel);
  const game = useLiveGame();
  const { tokens } = useDeckTokens(deck?.cards, deck?.tokenArt);
  const support = useCardSupport();
  /** Why this deck can't start a game (not Commander-legal, cards Forge doesn't have, ...). */
  const deckList = useMemo(() => (deck ? [{ ...deck, _id: deck._id as string }] : undefined), [deck]);
  const deckCheck = useGameChecks(deckList)?.get(deck?._id ?? "");
  const deckProblems = deckCheck?.problems ?? [];
  /** Cards the engine doesn't have: played by hand as stand-ins, so the game needs free play. */
  const needsFreePlay = deckCheck?.needsFreePlay ?? [];

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

  const deckPayload = (): DeckPayload | null => {
    if (!deck) return null;
    return {
      id: deck._id,
      abilities: deck.abilities?.map(({ text, autoYield, decision }) => ({ text, autoYield, decision })),
      later: deck.later,
      name: deck.name,
      cards: deck.cards.map((c) => {
        const missing = support?.notInForge(c.name);
        const card = missing ? (scry.cachedExact(c) ?? scry.cached(c)) : undefined;
        return { name: support?.forgeName(c.name) ?? c.name, quantity: c.quantity, board: c.board, set: c.set, collectorNumber: c.collectorNumber, standIn: card && standIn(card) };
      }),
      tokens: tokenArtMap(tokens),
    };
  };
  const start = () => {
    const payload = deckPayload();
    if (payload) game.start(payload, me?.name ?? "You", opponents, freePlay, rewind);
  };

  // A table's game: join it once the game server is ready and the table says it's on.
  const joinedKey = useRef<string | null>(null);
  const gameKey = table?.status === "playing" ? table.gameKey : null;
  useEffect(() => {
    if (!tableParam || !gameKey || game.status !== "ready" || joinedKey.current === gameKey) return;
    const payload = deckPayload();
    if (!payload) return;
    joinedKey.current = gameKey;
    game.joinTable(gameKey, payload);
  }, [tableParam, gameKey, game.status, deck]); // eslint-disable-line react-hooks/exhaustive-deps

  const playing = game.view && (game.status === "playing" || game.status === "reconnecting" || game.status === "moved" || game.status === "over");

  // While a game is on, the site's bars and this page's toolbar are hidden (table.css): the table
  // gets the whole window, and their controls move to the Game menu.
  useEffect(() => {
    if (!playing) return;
    document.body.classList.add("in-game");
    return () => document.body.classList.remove("in-game");
  }, [playing]);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const gameMenu: MenuSection[] = [
    {
      title: "Game",
      items: [
        {
          label: "Layout",
          onSelect: () => {},
          submenu: LAYOUTS.map((l) => ({ label: `${l.id === layout ? "✓ " : ""}${l.label}`, onSelect: () => setLayout(l.id) })),
        },
        {
          label: fullscreen ? "Exit full screen" : "Full screen",
          onSelect: () => void (fullscreen ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined),
        },
        { label: "Hotkeys and settings (new tab)", onSelect: () => window.open("#/settings", "_blank", "noopener") },
        {
          label: tableParam
            ? (game.status === "over" ? "Back to the table" : "Leave (the game is kept 5 minutes)")
            : (game.status === "over" ? "Back to Play" : "Leave (the game is kept 5 minutes)"),
          onSelect: () => navigate(tableParam ? `/tables/${tableParam}` : "/play"),
        },
        ...(game.status === "playing"
          ? [{ label: "Concede", danger: true, onSelect: () => confirm("Concede this game?") && game.concede() }]
          : []),
      ],
    },
  ];

  return (
    <div className="game">
      <div className="game-toolbar">
        <h1>
          {tableParam ? (table?.name ?? "Table") : (deck?.name ?? "Game")}{" "}
          <span className="muted small">{tableParam ? (deck?.name ?? "") : "vs Forge AI"}</span>
        </h1>
        <span className="status" data-state={game.status === "offline" || game.status === "reconnecting" || game.status === "moved" ? "closed" : "open"}>
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

      {game.status === "reconnecting" && (
        <div className="live-banner lost" role="status">
          <Spinner />
          <strong>Connection lost.</strong>
          <span className="muted">Reconnecting… Your game is kept for 5 minutes.</span>
        </div>
      )}

      {game.status === "moved" && (
        <div className="live-banner">
          <strong>This game is open in another tab.</strong>
          <span className="sb-spacer" />
          <button className="btn small" onClick={game.takeBack}>Play here</button>
        </div>
      )}

      {game.status === "over" && (
        <div className="live-banner">
          <strong>Game over.</strong>
          <span className="muted">{game.view?.outcome ?? gameOverText(game.view?.log ?? [], game.view?.players[0]?.name ?? "")}</span>
          <span className="sb-spacer" />
          {tableParam ? (
            <a className="btn small" href={`#/tables/${tableParam}`}>Back to the table</a>
          ) : (
            <button className="btn small" onClick={start} disabled={!deck}>Play again</button>
          )}
          <a className="btn small ghost" href="#/replays" title="The replay is ready a few seconds after the game ends">Replays</a>
          {!tableParam && <a className="btn small ghost" href="#/play">Back</a>}
        </div>
      )}

      {playing ? (
        <LiveTable game={game} view={game.view!} layout={layout} gameMenu={gameMenu} />
      ) : tableParam ? (
        <TableJoin game={game} table={table} tableId={tableParam} hasDeck={!!deck} />
      ) : (
        <div className="card live-start">
          {decks === undefined || (decks.length > 0 && !ready) ? (
            <p><Waiting text="Checking your decks…" slow="Still checking your decks… Scryfall is slow right now." /></p>
          ) : !decks.length ? (
            <p>You have no decks yet. <a className="link" href="#/decks">Build or import one first</a></p>
          ) : (
            <>
              <h2>Quick game</h2>
              <p className="muted">
                You and Forge AI opponents playing Commander precons that ship with Forge. The game runs on the CommandQuest
                game server. If you lose your connection or reload the page, come back within 5 minutes to carry on.
              </p>
              <label className="live-deck">
                Your deck{" "}
                <select value={deckId} disabled={!ready?.length} onChange={(e) => pickDeck(e.target.value)}>
                  {!ready?.length && !urlDeck && <option value="">None of your decks can be played yet</option>}
                  {urlDeck && !ready?.some((d) => d._id === urlDeck) && <option value={urlDeck}>{deck?.name ?? "This deck"}</option>}
                  {ready?.map((d) => (
                    <option key={d._id} value={d._id}>
                      {`${d.name}${d.commanders.length ? ` (${d.commanders.join(" & ")})` : ""}${checks?.get(d._id)?.needsFreePlay.length ? " · needs free play" : ""}`}
                    </option>
                  ))}
                </select>
                {notReady > 0 && (
                  <span className="muted small">
                    {" "}{notReady} {notReady === 1 ? "deck can't" : "decks can't"} be played yet: they're marked on <a className="link" href="#/decks">your Decks page</a>.
                  </span>
                )}
              </label>
              {urlDeck && deck === null && <p className="form-error">That deck wasn't found. Pick another one.</p>}
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
              {deckProblems.length > 0 && (
                <div className="form-error">
                  This deck can't start a game yet. <a className="link" href={`#/decks/${deckId}`}>Edit the deck</a>
                  <ul>{deckProblems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
              {needsFreePlay.length > 0 && (
                <p className={freePlay ? "free-play-note small" : "form-error"}>
                  ✋ {needsFreePlay.join(", ")} {needsFreePlay.length === 1 ? "isn't" : "aren't"} in the rules engine yet: you play{" "}
                  {needsFreePlay.length === 1 ? "it" : "them"} by hand, so this deck needs free play{freePlay ? "." : ". Turn on Free play to start."}
                </p>
              )}
              <button className="btn" onClick={start} disabled={!deck || game.status !== "ready" || deckProblems.length > 0 || (needsFreePlay.length > 0 && !freePlay)}>
                {deckId && deck === undefined ? <><Spinner /> Loading your deck…</>
                  : game.status === "ready" || game.status === "starting" ? <BusyLabel busy={game.status === "starting"} working="Starting…">Start game</BusyLabel>
                  : <>{CONNECTING.has(game.status) && <Spinner />} {STATUS[game.status]}</>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A table's game before it shows: joining it, waiting for the others, or why it isn't on. */
function TableJoin({ game, table, tableId, hasDeck }: {
  game: ReturnType<typeof useLiveGame>;
  table: { name: string; status: string } | null | undefined;
  tableId: string;
  hasDeck: boolean;
}) {
  const back = <a className="btn" href={`#/tables/${tableId}`}>Back to the table</a>;
  let body: React.ReactNode;
  if (table === undefined) body = <p><Waiting text="Loading the table…" /></p>;
  else if (table === null) body = <><p>You're not at this table any more.</p><p><a className="btn" href="#/play">Back to Play</a></p></>;
  else if (game.tableGone) body = <><p>{game.tableGone}</p><p>{back}</p></>;
  else if (table.status !== "playing") body = <><p>This table's game isn't on: it hasn't started, or it's over.</p><p>{back}</p></>;
  else {
    const w = game.tableWaiting;
    const connected = !CONNECTING.has(game.status);
    // What joining takes, in order; the first that isn't done yet is the one being waited on.
    const steps: { label: string; done: boolean; doing: string }[] = [
      { label: "Connected to the game server", done: connected, doing: game.status === "offline" ? "Can't reach the game server. Retrying…" : game.status === "signing-in" ? "Signing in to the game server…" : "Connecting to the game server…" },
      { label: "Your deck is loaded", done: hasDeck, doing: "Loading your deck…" },
      { label: "Joined the game", done: !!w, doing: "Joining the game…" },
      { label: "", done: false, doing: w ? `Waiting for ${w.waitingFor.join(", ") || "the others"} (${w.joined} of ${w.total} here)` : "Waiting for everyone to join" },
    ];
    const now = steps.findIndex((s) => !s.done);
    body = (
      <>
        <ol className="join-steps" role="status">
          {steps.map((s, i) => (
            <li key={i} className={s.done ? "done" : i === now ? "now" : "later"}>
              {s.done ? <span className="join-tick" aria-hidden="true">✓</span> : i === now ? <Spinner /> : <span className="join-later" aria-hidden="true" />}
              <span>{s.done ? s.label : s.doing}</span>
            </li>
          ))}
        </ol>
        {w && <p className="muted small">If they haven't joined within {w.seconds} seconds, the game starts without them.</p>}
      </>
    );
  }
  return (
    <div className="card live-start">
      <h2>{table?.name ?? "Table"}</h2>
      {body}
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

/** Not connected to the game server yet (or any more), but trying. */
const CONNECTING = new Set<ReturnType<typeof useLiveGame>["status"]>(["connecting", "signing-in", "reconnecting", "offline"]);

const STATUS: Record<ReturnType<typeof useLiveGame>["status"], string> = {
  connecting: "Connecting to the game server…",
  "signing-in": "Signing in…",
  ready: "Game server online",
  starting: "Starting the game…",
  playing: "Playing",
  reconnecting: "Reconnecting…",
  moved: "Open in another tab",
  over: "Game over",
  offline: "Game server offline, retrying…",
};

function LiveTable({ game, view, layout, gameMenu }: { game: ReturnType<typeof useLiveGame>; view: GameView; layout: LayoutId; gameMenu: MenuSection[] }) {
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
  // Ability settings: changed on the game server, and saved with the deck (when it's one of yours).
  const deck = useQuery(api.decks.get, view.deckId ? { id: view.deckId } : "skip");
  const setAbility = useMutation(api.decks.setAbility);
  const abilityControls: AbilityControls = {
    settings: view.abilities,
    saved: deck ? (deck.abilities ?? []) : undefined,
    change: game.setYield,
    save: (card, text, setting) => {
      if (!deck) return;
      setAbility({ id: deck._id, card, text, ...setting }).catch((e) => toast(errorMessage(e), "error"));
    },
  };
  // Your deck's combos (docs/combos.md): the ones whose cards are where they need to be are offered.
  const knownCombos = useDeckCombos(view.deckId).found?.combos;
  const myZones = useMemo<MyZones>(() => {
    const me = view.players[0];
    return {
      H: me.hand,
      B: view.players.flatMap((p) => p.battlefield).filter((c) => c.controller === view.viewer),
      C: me.command,
      E: view.players.flatMap((p) => p.exile).filter((c) => c.owner === view.viewer),
      G: me.graveyard,
    };
  }, [view]);
  // Abilities put off to a step (docs/use-later.md).
  const saveLater = useMutation(api.decks.setLater);
  const [stepPick, setStepPick] = useState<{ card: string; sorcery: boolean; done: (s: LaterSpec) => void } | null>(null);
  useEffect(() => {
    if (!stepPick) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setStepPick(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stepPick]);
  const laterControls: LaterControls = {
    entries: view.later,
    saved: deck ? (deck.later ?? []) : undefined,
    set: game.setLater,
    cancel: game.cancelLater,
    leave: game.leaveLater,
    use: (id, label) => {
      castFrom.current ??= view.stack.length;
      game.useAbility(id, { ability: -1, label, enabled: true });
    },
    pick: (card, sorcery, done) => setStepPick({ card, sorcery, done }),
    save: (card, text, spec) => {
      if (!deck) return;
      const s = spec && { when: spec.when, phase: spec.phase, whose: spec.whose, ask: spec.ask };
      saveLater({ id: deck._id, card, text, spec: s }).catch((e) => toast(errorMessage(e), "error"));
    },
    nameOf: (id) => view.players.find((p) => p.id === id)?.name ?? "A player",
  };
  // Every card on the table, ready to zoom before you hover it (hidden ones have no image).
  const visible = useMemo(() => {
    const all: CardView[] = [];
    for (const p of view.players) for (const z of [p.hand, p.battlefield, p.graveyard, p.exile, p.command]) for (const c of z) if (!c.hidden) all.push(c);
    for (const s of view.stack) if (s.card && !s.card.hidden) all.push(s.card);
    return all;
  }, [view]);
  usePreloadZoom(visible);

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
    if (board?.cards.has(id)) return toggleBoard(id); // a question answered by clicking on the table
    castFrom.current ??= view.stack.length;
    game.clickCard(id);
  };
  const clickPlayer = (id: string) => (board?.players.has(id) ? toggleBoard(id) : game.clickPlayer(id));
  // A question answered by clicking on the table (sacrifice a permanent, discard from your hand): what
  // you've clicked so far, kept here until OK answers it.
  const board = useMemo(() => askBoard(game.ask, view.viewer), [game.ask, view.viewer]);
  const [boardPick, setBoardPick] = useState<{ ask: number; picked: (number | string)[] }>({ ask: -1, picked: [] });
  const boardPicked = board && game.ask && boardPick.ask === game.ask.id ? boardPick.picked : [];
  const toggleBoard = (key: number | string) => {
    const a = game.ask;
    if (!a) return;
    const now = boardPick.ask === a.id ? boardPick.picked : [];
    const next = now.includes(key) ? now.filter((x) => x !== key) : a.max === 1 ? [key] : now.length < a.max ? [...now, key] : now;
    setBoardPick({ ask: a.id, picked: next });
  };
  const answerBoard = () => {
    if (!board || !game.ask) return;
    game.answer(game.ask.id, boardPicked.map((k) => (typeof k === "number" ? board.cards.get(k)! : board.players.get(k)!)));
  };

  // What Forge's prompt lets you click: cards to pick or target, and while paying, your mana sources.
  const sel = view.selection;
  const selectable = useMemo(
    () => new Set([
      ...(sel?.cards ?? []),
      ...(game.prompt?.pay?.sources ?? []),
      // Once you've chosen as many as you can, the rest stop glowing (click a chosen one to swap it).
      ...[...(board?.cards.keys() ?? [])].filter((id) => !game.ask || game.ask.max <= 1 || boardPicked.length < game.ask.max || boardPicked.includes(id)),
    ]),
    [sel, game.prompt?.pay, board, game.ask, boardPicked],
  );
  const chosen = useMemo(
    () => new Set([...(sel?.chosen ?? []), ...boardPicked].filter((x): x is number => typeof x === "number")),
    [sel, boardPicked],
  );
  // Spells and abilities on the stack you can target (Negate…), picked in the stack window.
  const stackTargets = useMemo(
    () => (sel?.stack.length || sel?.chosenStack?.length ? { selectable: new Set(sel.stack), chosen: new Set(sel.chosenStack ?? []), onPick: game.clickStack } : undefined),
    [sel, game.clickStack],
  );
  const targetPlayers = useMemo(() => new Set([...(sel?.players ?? []), ...(board?.players.keys() ?? [])]), [sel, board]);
  // Choosing cards from a pile (a graveyard, a library…): the pick window, until you hide it for this prompt.
  const piles = useMemo(() => (game.prompt && !game.prompt.pay && !game.ask ? pickPiles(view) : []), [view, game.prompt, game.ask]);
  // …or a question whose options are cards in piles (a tutor, "return a card from your graveyard").
  const askCards = useMemo(() => askPickCards(game.ask, view.viewer), [game.ask, view.viewer]);
  const askPiles = useMemo(() => (askCards ? pilesFor(view, askCards) : []), [view, askCards]);
  // …or any other question but yes/no (and the ones clicked on the table): its own window.
  const windowAsk = !!game.ask && !askCards && !board && askInWindow(game.ask);
  const pickKey = (askCards || windowAsk) && game.ask ? `ask:${game.ask.id}` : piles.length ? `${game.prompt?.message}|${piles.map((p) => p.key).join(",")}` : "";
  const [pickHidden, setPickHidden] = useState("");
  const alsoTable = useMemo(() => {
    if (!sel || !piles.length) return false;
    const inPiles = new Set(piles.flatMap((p) => p.choosable.map((c) => c.id)));
    return sel.players.length > 0 || sel.stack.length > 0 || sel.cards.some((id) => !inPiles.has(id));
  }, [sel, piles]);
  const playable = useMemo(() => new Set(game.prompt && isPriorityPrompt(game.prompt) && !game.ask ? view.playable ?? [] : []), [view.playable, game.prompt, game.ask]);
  // Choosing on the table (targets, a sacrifice…): a bar over it with what and the buttons.
  const targeting = !!game.prompt && !game.prompt.pay && !game.ask && !!sel
    && sel.cards.length + sel.players.length + sel.stack.length > 0
    && !isPriorityPrompt(game.prompt) && !isAttackPrompt(game.prompt) && !isBlockPrompt(game.prompt);

  // Declaring attackers (Forge's InputAttack): drag your creatures to whom they attack. Forge's prompt
  // attacks whichever defender was clicked last, so a drag clicks the defender, then each creature
  // that isn't attacking it yet (a click on one attacking it would take it back out).
  const attacking = !!game.prompt && !game.ask && isAttackPrompt(game.prompt) && view.active === view.viewer;
  // Your untapped creatures that aren't summoning sick (`sick` already allows for haste), and ones
  // attacking (to move or call back). Forge says why if one can't attack.
  const attackCandidates = useMemo(
    () => new Set(attacking ? view.players[0].battlefield.filter((c) => c.types?.includes("Creature") && (c.attacking || (!c.tapped && !c.sick))).map((c) => c.id) : []),
    [attacking, view.players],
  );
  const declareAttack = (ids: number[], to: AttackTarget) => {
    const mine = view.players[0].battlefield;
    const cards = ids.map((id) => mine.find((c) => c.id === id)).filter((c): c is CardView => !!c);
    const pick = (t: NonNullable<AttackTarget>) => ("card" in t ? game.clickCard(t.card) : game.clickPlayer(t.player));
    if (!to) {
      // Back to your board: take each out, by picking what it attacks and clicking it again.
      for (const c of cards) {
        if (!c.attacking) continue;
        pick(c.attackingCard !== undefined ? { card: c.attackingCard } : { player: c.attacking });
        game.clickCard(c.id);
      }
      return;
    }
    pick(to);
    for (const c of cards) {
      const already = "card" in to ? c.attackingCard === to.card : c.attacking === to.player && c.attackingCard === undefined;
      if (!already) game.clickCard(c.id);
    }
  };

  // Right-click menus. Forge's abilities for the card (enabled when you can use them now), then
  // the things players do by hand at a paper table: tap, counters, move it to another zone…
  const [counterFor, setCounterFor] = useState<CardView[] | null>(null);
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
    // Hand cards get it at the top of the section (putFromHand); elsewhere it goes with the other moves.
    if (card.zone !== "battlefield" && card.zone !== "hand" && isPermanentCard(card)) items.push({ label: "Put onto the battlefield", onSelect: go("toBattlefield") });
    if (card.zone !== "hand") items.push({ label: card.zone === "battlefield" ? "Return to hand" : "Put into hand", onSelect: go("toHand") });
    if (card.zone !== "graveyard") items.push({ label: "Put into graveyard", onSelect: go("toGraveyard") });
    if (card.zone !== "exile") {
      items.push({ label: "Exile", onSelect: go("toExile") });
      const faceDown = (to: string[]) => () => game.manual(card.id, "exileFaceDown", to);
      items.push({
        label: "Exile face down",
        onSelect: () => {},
        submenu: [
          { label: "Only you may look at it (foretell, hideaway)", onSelect: faceDown([me]) },
          ...opponents.map((p) => ({ label: `Only ${p.name} may look at it`, onSelect: faceDown([p.id]) })),
          { label: "Nobody may look at it", onSelect: faceDown([]) },
        ],
      });
    }
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
    /** N = 1…5 (as many as there are), then "X…" for the dialog. */
    const counts = (action: "scry" | "surveil" | "mill", run: (n: number) => void): MenuSection["items"] => [
      ...[1, 2, 3, 4, 5].filter((n) => n <= myLibrary).map((n) => ({ label: `${action[0].toUpperCase()}${action.slice(1)} ${n}`, onSelect: () => run(n) })),
      { label: "X…", onSelect: () => setLibDialog(action) },
    ];
    return {
      title: "Library (by hand)",
      items: [
        { label: "Draw a card", disabled: empty, onSelect: () => game.library("draw", 1) },
        { label: "🔍 Search library", disabled: empty, onSelect: () => openPeek(0) },
        { label: "Look at the top cards…", disabled: empty, onSelect: () => setLibDialog("look") },
        { label: "Scry", disabled: empty, onSelect: () => {}, submenu: counts("scry", (n) => startArrange("scry", n)) },
        { label: "Surveil", disabled: empty, onSelect: () => {}, submenu: counts("surveil", (n) => startArrange("surveil", n)) },
        { label: "Mill", disabled: empty, onSelect: () => {}, submenu: counts("mill", (n) => game.library("mill", n)) },
        {
          label: "More",
          onSelect: () => {},
          submenu: [
            {
              label: "👁 Reveal the top card to",
              disabled: empty,
              onSelect: () => {},
              submenu: [
                { label: "Everyone", onSelect: () => game.library("revealTop", 1, opponents.map((p) => p.id)) },
                ...(opponents.length > 1 ? opponents.map((p) => ({ label: p.name, onSelect: () => game.library("revealTop", 1, [p.id]) })) : []),
              ],
            },
            { label: "Exile the top card", disabled: empty, onSelect: () => game.library("exile", 1) },
            { label: "Draw, mill or exile several…", disabled: empty, onSelect: () => setLibDialog("draw") },
            {
              label: "Let an opponent search it",
              onSelect: () => {},
              submenu: opponents.map((p) => ({ label: p.name, onSelect: () => game.letSearch(p.id) })),
            },
          ],
        },
        { label: "🔀 Shuffle", onSelect: () => game.library("shuffle") },
      ],
    };
  };

  // Another player let you search their library: open it (the log says you searched it), keep it
  // current as their library changes, and closing it ends the search (the server shuffles it).
  const searchOf = view.searching?.[0] ?? null;
  const searchPlayer = searchOf ? view.players.find((p) => p.id === searchOf) : undefined;
  const searchKey = `${searchOf}|${searchPlayer?.libraryCount}|${view.log.length}`;
  const searchShown = useRef<string | null>(null);
  useEffect(() => {
    if (!searchOf) {
      searchShown.current = null;
      return;
    }
    game.listSearch(searchOf, searchShown.current !== searchOf);
    searchShown.current = searchOf;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  // Scry / surveil by hand: fetch the top N (only you see them), then the dialog sends the split.
  const [arrange, setArrange] = useState<{ kind: ArrangeKind; n: number; cards?: CardView[] } | null>(null);
  const startArrange = (kind: ArrangeKind, n: number) => {
    game.clearLibraryList();
    setArrange({ kind, n });
    game.listLibrary(n, false);
  };
  useEffect(() => {
    const list = game.libraryList;
    if (arrange && !arrange.cards && list && list.top === arrange.n) setArrange({ ...arrange, cards: list.cards.slice(0, arrange.n) });
  }, [game.libraryList, arrange]);
  // Refused (free play is off, say): the cards aren't coming, so stop waiting for them.
  useEffect(() => {
    if (arrange && !arrange.cards) setArrange(null);
    if (peek && game.libraryList?.top !== peek.top) setPeek(null);
  }, [game.notice]); // eslint-disable-line react-hooks/exhaustive-deps


  /** Until end of turn ▸ for a permanent: groups of effects, creature ones only on creatures. */
  const eotItem = (card: CardView): MenuSection["items"][number] => {
    const go = (key: string) => () => game.manual(card.id, `eot:${key}`);
    const creature = card.types?.includes("Creature");
    const groups = EOT_GROUPS.filter((gr) => creature || !gr.creature).map((gr) => ({
      label: gr.label,
      onSelect: () => {},
      submenu: gr.items.map(([key, label]) => ({ label, onSelect: go(key) })),
    }));
    const steal = card.controller !== me ? [{ label: "Gain control (untap it, haste)", onSelect: go("control") }] : [];
    return { label: "⏳ Until end of turn", onSelect: () => {}, submenu: [...groups, ...steal] };
  };

  /** Combat by hand: put your creature in attacking once attackers are declared, or take any creature out. */
  const combatItems = (card: CardView, mine: boolean): MenuSection["items"] => {
    const items: MenuSection["items"] = [];
    if (card.attacking || card.blocking) items.push({ label: "Remove from combat", onSelect: () => game.manual(card.id, "removeFromCombat") });
    else if (mine && card.types?.includes("Creature") && view.active === me && AFTER_ATTACKERS.has(view.step)) {
      const attack = (p: { id: string; name: string }) => () => game.manual(card.id, "attack", [p.id]);
      items.push(opponents.length === 1
        ? { label: `⚔ Put into combat attacking ${opponents[0].name}`, onSelect: attack(opponents[0]) }
        : { label: "⚔ Put into combat attacking", onSelect: () => {}, submenu: opponents.map((p) => ({ label: p.name, onSelect: attack(p) })) });
    }
    return items;
  };

  /** May you be let cast it by hand: your card in exile or graveyard, or a face-down exiled card you may look at. */
  const castable = (card: CardView) =>
    ((card.zone === "exile" || card.zone === "graveyard") && card.owner === me)
    || (card.zone === "exile" && !!card.faceDown && !!card.visibleTo?.includes(me));
  /** Let me cast it ▸: for cards an effect lets you cast that Forge doesn't know about. */
  const castItem = (card: CardView): MenuSection["items"][number] => ({
    label: "▶ Let me cast it",
    onSelect: () => {},
    submenu: [
      { label: "Paying its mana cost", onSelect: () => game.manual(card.id, "cast:pay") },
      { label: "Without paying its mana cost", onSelect: () => game.manual(card.id, "cast:free") },
      { label: "For another cost… (e.g. a foretell cost)", onSelect: () => setCostFor(card) },
    ],
  });
  const [costFor, setCostFor] = useState<CardView | null>(null);

  /** A submenu row (its own click does nothing; it opens the submenu). */
  const sub = (label: string, submenu: MenuSection["items"]): MenuSection["items"][number] => ({ label, onSelect: () => {}, submenu });

  const manualSection = (card: CardView): MenuSection => {
    if (view.freePlay === false) return { items: [] };
    const mine = (card.zone === "battlefield" ? card.controller : card.owner) === me;
    const go = (action: Parameters<typeof game.manual>[1]) => () => game.manual(card.id, action);
    const items: MenuSection["items"] = [];
    if (card.zone === "battlefield") {
      // The common things up front; the rest under More ▸ and Move to ▸ so the menu stays short.
      if (mine) items.push({ label: card.tapped ? "Untap" : "Tap", onSelect: go(card.tapped ? "untap" : "tap") });
      const kinds = ["+1/+1", ...(card.counters?.["-1/-1"] ? ["-1/-1"] : []), ...(card.types?.includes("Planeswalker") ? ["Loyalty"] : [])];
      for (const k of Object.keys(card.counters ?? {})) if (!kinds.includes(k)) kinds.push(k);
      for (const k of kinds) items.push(counterRow(card, k));
      items.push(sub("Add a counter", [
        ...QUICK_COUNTERS.filter((k) => !kinds.includes(k)).map((k) => ({ label: k, onSelect: () => game.counter(card.id, k, 1) })),
        { label: "Other / several…", onSelect: () => setCounterFor([card]) },
      ]));
      items.push(eotItem(card));
      items.push(...combatItems(card, mine));
      const more: MenuSection["items"] = [];
      if (mine) more.push({ label: card.faceDown ? "Turn face up" : "Turn face down", onSelect: go(card.faceDown ? "faceUp" : "faceDown") });
      if (mine && card.transformable) more.push({ label: "Transform", onSelect: go("transform") });
      if (!mine && card.types?.includes("Creature")) more.push({ label: "Goad (attacks each combat, not you, until your next turn)", onSelect: go("goad") });
      if (mine) {
        more.push({ label: "Phase out", onSelect: go("phaseOut") });
        if (card.untapLock) more.push({ label: "🔓 Untaps normally", onSelect: go("untapNormally") });
        if (card.untapLock !== "next" && card.untapLock !== "never") more.push({ label: "🔒 Doesn't untap next turn", onSelect: go("skipUntap") });
        if (card.untapLock !== "never") more.push({ label: "🔒 Never untaps by itself", onSelect: go("neverUntap") });
        more.push({ label: "Create a token copy", onSelect: go("tokenCopy") });
      }
      if (more.length) items.push(sub("More", more));
      if (mine) items.push(sub("Move to", moves(card)));
    } else if (mine) {
      if (card.zone === "hand" && isPermanentCard(card)) items.push({ label: "⤵ Put onto the battlefield (don't cast)", onSelect: go("toBattlefield") });
      if (card.zone === "hand") {
        items.push(revealItem(card));
        items.push({ label: "Discard", onSelect: go("discard") });
        items.push(sub("More", [
          { label: "Plot (exile it; cast it free on a later turn as a sorcery)", onSelect: go("plot") },
          { label: "Foretell (exile it face down; only you may look)", onSelect: go("foretell") },
          sub("Suspend with time counters", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ label: `${n} time counter${n === 1 ? "" : "s"}`, onSelect: go(`suspend:${n}`) }))),
        ]));
      }
      if (castable(card)) items.push(castItem(card));
      items.push(sub("Move to", moves(card)));
    } else if (card.zone === "library" && view.searching?.includes(card.owner)) {
      // Searching someone's library they let you search: take cards into their exile.
      items.push({ label: "Exile face down (only you may look at it)", onSelect: () => game.manual(card.id, "exileFaceDown", [me]) });
      items.push({ label: "Exile face up", onSelect: go("toExile") });
    } else if (castable(card)) {
      items.push(castItem(card)); // a face-down card in someone's exile that you may look at
    }
    return { items };
  };

  // Until combat damage, creatures of yours can be put in or taken out of the attack (or the blocks):
  // a rewind to just before they were declared, with the rest declared as before (docs/rewind.md).
  // Several at once when they're all in it, or all out of it.
  const combatSection = (cards: CardView[]): MenuSection => {
    const rw = view.rewind;
    if (!rw?.level || !cards.length || !cards.every((c) => c.zone === "battlefield" && c.controller === me && c.types?.includes("Creature"))) return { items: [] };
    const attacking = view.active === me;
    const kind = attacking ? "attackers" : "blockers";
    if (!rw.options?.some((o) => o.kind === kind)) return { items: [] };
    const inIt = (c: CardView) => (attacking ? !!c.attacking : !!c.blocking);
    const all = cards.every(inIt);
    if (!all && cards.some(inIt)) return { items: [] };
    const who = cards.length === 1 ? cards[0].name : "them";
    const label = attacking ? (all ? `Stop attacking with ${who}` : `Attack with ${who} too`) : all ? `Stop blocking with ${who}` : `Block with ${who} too`;
    return {
      title: "Combat (rewind)",
      items: [{ label: `↶ ${label}`, disabled: !!rw.pending, onSelect: () => game.rewindChange(cards.map((c) => c.id)) }],
    };
  };


  /**
   * The menu for several selected cards: what you'd do to each of them, done to all at once
   * (each card is still its own action on the server, logged by hand like the rest).
   */
  const [manaFor, setManaFor] = useState<{ cards: ManaDialogCard[]; via?: string } | null>(null);
  const multiSection = (cards: CardView[], mana?: ManaOptions): MenuPart => {
    if (view.freePlay === false) {
      const tapping = manaItems(cards, mana);
      return tapping.length ? { sections: [{ title: `${cards.length} cards`, items: tapping }] } : { sections: [], note: mana?.reason ?? "Free play is off in this game, so cards can't be changed by hand." };
    }
    const each = (f: (c: CardView) => void) => () => cards.forEach(f);
    const act = (action: Parameters<typeof game.manual>[1], who: CardView[] = cards, to?: string[]) => () => who.forEach((c) => game.manual(c.id, action, to));
    const owned = (c: CardView) => (c.zone === "battlefield" ? c.controller : c.owner) === me;
    const allMine = cards.every(owned);
    const zones = new Set(cards.map((c) => c.zone));
    const items: MenuSection["items"] = [];
    if (zones.size === 1 && zones.has("battlefield")) {
      if (allMine) {
        const untapped = cards.filter((c) => !c.tapped), tapped = cards.filter((c) => c.tapped);
        if (untapped.length) items.push({ label: `Tap ${untapped.length === cards.length ? "them all" : `the ${untapped.length} untapped`} (by hand, no mana)`, onSelect: act("tap", untapped) });
        if (tapped.length) items.push({ label: `Untap ${tapped.length === cards.length ? "them all" : `the ${tapped.length} tapped`}`, onSelect: act("untap", tapped) });
      }
      items.push(...manaItems(cards, mana));
      // Counters work on any permanent: a row with + and − for each, then any other kind.
      const kinds = ["+1/+1"];
      for (const c of cards) for (const k of Object.keys(c.counters ?? {})) if (!kinds.includes(k)) kinds.push(k);
      for (const k of kinds) {
        items.push({
          label: `${k} counter on each`,
          keepOpen: true,
          onSelect: each((c) => game.counter(c.id, k, 1)),
          steppers: [
            { label: "+", title: `Add a ${k} counter to each`, onSelect: each((c) => game.counter(c.id, k, 1)) },
            { label: "−", title: `Remove a ${k} counter from each that has one`, onSelect: each((c) => (c.counters?.[k] ?? 0) > 0 && game.counter(c.id, k, -1)) },
          ],
        });
      }
      items.push(sub("Add a counter to each", [
        ...QUICK_COUNTERS.filter((k) => !kinds.includes(k)).map((k) => ({ label: k, onSelect: each((c) => game.counter(c.id, k, 1)) })),
        { label: "Other / several…", onSelect: () => setCounterFor(cards) },
      ]));
      const creatures = cards.every((c) => c.types?.includes("Creature"));
      items.push(sub("⏳ Until end of turn, each", [
        ...EOT_GROUPS.filter((gr) => creatures || !gr.creature).map((gr) => sub(gr.label, gr.items.map(([key, label]) => ({ label, onSelect: act(`eot:${key}`) })))),
        ...(cards.every((c) => c.controller !== me) ? [{ label: "Gain control (untap them, haste)", onSelect: act("eot:control") }] : []),
      ]));
      const fighting = cards.filter((c) => c.attacking || c.blocking);
      if (fighting.length) items.push({ label: `Remove ${fighting.length === cards.length ? "them" : `the ${fighting.length}`} from combat`, onSelect: act("removeFromCombat", fighting) });
      else if (allMine && creatures && view.active === me && AFTER_ATTACKERS.has(view.step)) {
        const attack = (p: { id: string }) => act("attack", cards, [p.id]);
        items.push(opponents.length === 1
          ? { label: `⚔ Put them into combat attacking ${opponents[0].name}`, onSelect: attack(opponents[0]) }
          : sub("⚔ Put them into combat attacking", opponents.map((p) => ({ label: p.name, onSelect: attack(p) }))));
      }
      const more: MenuSection["items"] = [];
      if (creatures && cards.every((c) => c.controller !== me)) more.push({ label: "Goad them", onSelect: act("goad") });
      if (allMine) {
        more.push({ label: "Phase them out", onSelect: act("phaseOut") });
        more.push({ label: "Create a token copy of each", onSelect: act("tokenCopy") });
      }
      if (more.length) items.push(sub("More", more));
    } else if (allMine && zones.size === 1 && zones.has("hand")) {
      if (cards.every(isPermanentCard)) items.push({ label: "⤵ Put them onto the battlefield (don't cast)", onSelect: act("toBattlefield") });
      items.push({ label: "Discard them", onSelect: act("discard") });
    } else if (cards.every((c) => c.zone === "library" && view.searching?.includes(c.owner))) {
      items.push({ label: "Exile them face down (only you may look at them)", onSelect: act("exileFaceDown", cards, [me]) });
      items.push({ label: "Exile them face up", onSelect: act("toExile") });
    }
    if (allMine) {
      // Move to ▸ for all of them: each moves unless it's already there.
      const not = (z: string) => cards.filter((c) => c.zone !== z);
      const move: MenuSection["items"] = [];
      if (cards.every((c) => c.zone !== "battlefield" && c.zone !== "hand" && isPermanentCard(c))) move.push({ label: "Put onto the battlefield", onSelect: act("toBattlefield") });
      if (not("hand").length) move.push({ label: "Put into hand", onSelect: act("toHand", not("hand")) });
      if (not("graveyard").length) move.push({ label: "Put into graveyard", onSelect: act("toGraveyard", not("graveyard")) });
      if (not("exile").length) {
        const faceDown = (to: string[]) => act("exileFaceDown", not("exile"), to);
        move.push({ label: "Exile", onSelect: act("toExile", not("exile")) });
        move.push(sub("Exile face down", [
          { label: "Only you may look at them", onSelect: faceDown([me]) },
          ...opponents.map((p) => ({ label: `Only ${p.name} may look at them`, onSelect: faceDown([p.id]) })),
          { label: "Nobody may look at them", onSelect: faceDown([]) },
        ]));
      }
      move.push({ label: "On top of library", onSelect: act("toLibraryTop") });
      move.push({ label: "On the bottom of library", onSelect: act("toLibraryBottom") });
      items.push(sub("Move them to", move));
    }
    const fight = combatSection(cards);
    return {
      sections: [{ title: `${cards.length} cards`, items }, ...(fight.items.length ? [fight] : [])],
      note: items.length || fight.items.length ? undefined : "There's nothing to do to all of these at once. Select cards that are all yours, or all on the battlefield.",
    };
  };

  /**
   * 💧 Tap for mana… (pick each card's color, with arrows to shift between colors), and for another
   * card's "Tap an untapped artifact you control: Add {U}" (Urza), tapping them all for it at once.
   */
  const manaItems = (cards: CardView[], mana?: ManaOptions): MenuSection["items"] => {
    if (!mana?.options.length) return [];
    const nameOf = (id: number) => cards.find((c) => c.id === id)?.name ?? "A card";
    const rows: ManaDialogCard[] = mana.options.map((o) => ({ id: o.id, name: nameOf(o.id), picks: o.picks }));
    const items: MenuSection["items"] = [{
      label: `💧 Tap for mana… (${rows.length === cards.length ? "all" : `${rows.length} of them`})`,
      onSelect: () => setManaFor({ cards: rows }),
    }];
    for (const via of [...new Set(rows.flatMap((r) => r.picks.flatMap((p) => (p.via ? [p.via] : []))))]) {
      const usable = rows.filter((r) => r.picks.some((p) => p.via === via));
      const picks = usable.map((r) => r.picks.filter((p) => p.via === via));
      const who = usable.length === cards.length ? "each" : `${usable.length} of them`;
      const owed = painText({ damage: picks.reduce((n, ps) => n + (ps[0].damage ?? 0), 0), life: picks.reduce((n, ps) => n + (ps[0].life ?? 0), 0) });
      // One color each: tap them right away. A choice of colors: the window, set to this ability.
      items.push(picks.every((ps) => ps.length === 1)
        ? {
            label: `💧 Tap ${who} for ${via}: ${symbols(picks[0][0].mana)} each${owed ? ` (♥ ${owed})` : ""}`,
            onSelect: () => game.tapForMana(usable.map((r, i) => ({ card: r.id, source: picks[i][0].source, ability: picks[i][0].ability, choice: picks[i][0].choice }))),
          }
        : { label: `💧 Tap ${who} for ${via}…`, onSelect: () => setManaFor({ cards: usable, via }) });
    }
    return items;
  };

  const menuFor = (t: MenuTarget): MenuPart | Promise<MenuPart> => {
    if (t.kind === "cards") {
      // Your untapped permanents: ask the server how each can be tapped for mana.
      const untapped = t.cards.filter((c) => c.zone === "battlefield" && c.controller === me && !c.tapped);
      return untapped.length ? game.manaOptions(untapped.map((c) => c.id)).then((m) => multiSection(t.cards, m)) : multiSection(t.cards);
    }
    const passing: MenuPart["sections"] = [
      {
        title: "Priority",
        items: [
          { label: game.prompt?.ok.label && game.prompt.ok.label !== "OK" ? game.prompt.ok.label : "Pass priority (OK)", disabled: !game.prompt?.ok.enabled, onSelect: ok },
          { label: "Pass until end of turn", onSelect: () => setAutoPass("END_OF_TURN") },
          { label: "Pass until before my turn", onSelect: () => setAutoPass("BEFORE_MY_TURN") },
          { label: "Pass until my turn", onSelect: () => setAutoPass("UNTIL_MY_TURN") },
          { label: "Pass until my turn, ignoring the stack", onSelect: () => setAutoPass("UNTIL_MY_TURN_ALL") },
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
    // A face-down card you can't look at: still yours to move by hand (on the battlefield, or exiled face down).
    if (card.hidden) {
      return {
        sections: card.zone === "battlefield" ? [combatSection([card]), manualSection(card)] : card.zone === "exile" && card.owner === me ? [manualSection(card)] : [],
      };
    }
    return game.actions(card.id).then(({ actions, reason, triggers }) => ({
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
        { title: "Use later", items: laterItems(actions, card.id, card.name ?? "") },
        { title: "Triggered abilities", items: abilityItems(triggers ?? [], card.name ?? "") },
        combatSection([card]),
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
  // Passing your turn with a land still to play: ask first (OK past your last main phase, Forge's
  // End Turn, or an auto-pass).
  const landCheck = useLandCheck({
    stops: st.stops, me: view.viewer, active: view.active, step: view.step, turn: view.turn,
    stackNonEmpty: view.stack.length > 0, landDrop: !!view.landDrop,
  });
  const priorityPrompt = !!game.prompt && !game.ask && isPriorityPrompt(game.prompt);
  // Forge offers End Turn at every priority stop, but on someone else's turn it would only pass
  // you through their turn, so it isn't shown then (auto-pass does that job).
  const hideEndTurn = priorityPrompt && game.prompt!.cancel.label === "End Turn" && view.active !== view.viewer;
  const railPrompt = hideEndTurn ? { ...game.prompt!, cancel: { ...game.prompt!.cancel, label: "", enabled: false } } : game.prompt;
  const ok = () => {
    if (game.busy()) return; // the server is still on the last press
    // Only OK at "you have priority" passes; OK while casting (Auto-pay, skipping convoke, done
    // choosing targets) is part of the cast, so keep watching for it to land.
    if (priorityPrompt) {
      if (!landCheck("pass")) return;
      castFrom.current = null;
      castDone.current = false;
    }
    game.ok();
  };
  const cancel = () => {
    if (game.busy()) return;
    if (hideEndTurn) return;
    if (priorityPrompt && game.prompt?.cancel.label === "End Turn" && !landCheck("skip")) return;
    if (game.prompt?.pay?.autoPaid) return void game.cancel(); // Undo auto-pay: still casting
    castFrom.current = null;
    castDone.current = false;
    game.cancel();
  };
  const setAutoPass = (mode: AutoPassMode) => {
    if (game.autoPass !== mode && !landCheck("skip")) return; // turning one off needs no question
    game.setAutoPass(mode);
  };

  // Your hotkeys (Settings): auto-pass skips, hold priority, cast your commander.
  useHotkeys({
    autoEndOfTurn: () => setAutoPass("END_OF_TURN"),
    autoBeforeMyTurn: () => setAutoPass("BEFORE_MY_TURN"),
    autoUntilMyTurn: () => setAutoPass("UNTIL_MY_TURN"),
    autoUntilMyTurnAll: () => setAutoPass("UNTIL_MY_TURN_ALL"),
    autoActionOrEnd: () => setAutoPass("ACTION_OR_END_STEP"),
    holdPriority: () => st.setHoldPriority(!st.holdPriority),
    castCommander: () => (commander ? click(commander.id) : false),
  });

  const manaChoice = manaChoiceFor(game.ask, game.prompt);
  const seatOf = (id: string) => view.players.find((p) => p.id === id);
  const nameOf = (id: string) => (id === view.viewer ? "you" : seatOf(id)?.name ?? id);
  const colorOf = (id: string) => seatOf(id)?.color ?? "#888";

  return (
    <AbilityProvider value={abilityControls}>
    <LaterProvider value={laterControls}>
    <TopLayer>
    {manaChoice && (
      <ManaChoice
        choice={manaChoice}
        anchorId={manaChoice.cardId ?? (lastClick.current.id >= 0 ? lastClick.current.id : undefined)}
        onPick={(answer) =>
          manaChoice.via === "ask" ? game.answer(manaChoice.askId!, answer) : answer[0] === 0 ? game.ok() : game.cancel()
        }
        onCancel={manaChoice.cancellable ? () => game.answer(manaChoice.askId!, []) : undefined}
      />
    )}
    {game.shown[0] && (
      <ShownWindow
        key={game.shown[0].n}
        title={game.shown[0].title}
        note={game.shown[0].note}
        cards={game.shown[0].cards}
        more={game.shown.length - 1}
        onClose={game.dismissShown}
      />
    )}
    {game.prompt?.pay && !game.ask && <PayPrompt prompt={game.prompt} pool={view.players[0].mana} game={{ ok, cancel, payFree: game.payFree, payPool: game.payPool, sent: game.sent }} />}
    </TopLayer>
    {pickKey && pickHidden !== pickKey && askCards && game.ask && (
      <AskPick key={pickKey} ask={game.ask} cards={askCards} piles={askPiles} onAnswer={(i) => game.answer(game.ask!.id, i)} onHide={() => setPickHidden(pickKey)} />
    )}
    {pickKey && pickHidden !== pickKey && windowAsk && game.ask && (
      <DecisionWindow
        key={pickKey}
        ask={game.ask}
        onAnswer={(choice, text) => game.answer(game.ask!.id, choice, text)}
        onHide={() => setPickHidden(pickKey)}
        viewer={view.viewer}
        nameOf={nameOf}
        colorOf={colorOf}
      />
    )}
    {pickKey && pickHidden !== pickKey && !askCards && !windowAsk && piles.length > 0 && game.prompt && (
      <PickDialog
        key={pickKey}
        message={game.prompt.message}
        piles={piles}
        chosen={chosen}
        ok={game.prompt.ok}
        cancel={game.prompt.cancel}
        alsoTable={alsoTable}
        onPick={game.clickCard}
        onOk={ok}
        onCancel={cancel}
        sent={game.sent}
        onHide={() => setPickHidden(pickKey)}
      />
    )}
    {libDialog && (
      <LibraryDialog
        size={myLibrary}
        initial={libDialog}
        onClose={() => setLibDialog(null)}
        onApply={(action, n) => (action === "look" ? openPeek(n) : action === "scry" || action === "surveil" ? startArrange(action, n) : game.library(action, n))}
      />
    )}
    {arrange && !arrange.cards && (
      <div className="game-wait"><Waiting text="Getting the top cards of your library…" slow="Still getting the cards… the game server is slow right now." className="" /></div>
    )}
    {arrange?.cards && (
      <ScryDialog
        kind={arrange.kind}
        cards={arrange.cards}
        onClose={() => (setArrange(null), game.clearLibraryList())}
        onApply={(top, away) => game.arrange(arrange.kind, top, away)}
      />
    )}
    {costFor && (
      <CostDialog
        name={costFor.name ?? "it"}
        onClose={() => setCostFor(null)}
        onApply={(cost) => game.manual(costFor.id, `cast:cost:${cost}`)}
      />
    )}
    {manaFor && (
      <ManaDialog
        cards={manaFor.cards}
        via={manaFor.via}
        onClose={() => setManaFor(null)}
        onApply={game.tapForMana}
      />
    )}
    {counterFor && (
      <CounterDialog
        name={counterFor.length === 1 ? counterFor[0].name ?? "it" : `${counterFor.length} cards`}
        onClose={() => setCounterFor(null)}
        onApply={(type, delta) => counterFor.forEach((c) => game.counter(c.id, type, delta))}
      />
    )}
    <TableBoard
      view={view}
      layout={layout}
      stops={st}
      priority={!!game.prompt?.ok.enabled || !!game.ask}
      pickStep={stepPick ? {
        title: `When to use ${stepPick.card}?`,
        allowed: (step, whose) => canPickStep(step, whose, stepPick.sorcery),
        onPick: (phase, whose) => {
          stepPick.done({ when: "STEP", phase, whose });
          setStepPick(null);
        },
        onCancel: () => setStepPick(null),
      } : undefined}
      rail={(preview) => <LiveRail priority={priorityPrompt} knownCombos={knownCombos} myZones={myZones} game={{ ...game, prompt: railPrompt, ok, cancel, setAutoPass, clickCard: click }} nameOf={nameOf} colorOf={colorOf} preview={preview} boardAsk={board && game.ask ? { onOk: boardPicked.length >= game.ask.min && boardPicked.length <= game.ask.max ? answerBoard : null } : undefined} pickAsk={!!askCards || windowAsk} onShowPick={pickKey && pickHidden === pickKey ? () => setPickHidden("") : undefined} />}
      hand={{
        onPlay: click,
        onClick: click,
        onPut: view.freePlay === false ? undefined : (id) => game.manual(id, "toBattlefield"),
      }}
      onCardClick={click}
      onPayPool={game.prompt?.pay && !game.ask ? game.payPool : undefined}
      payPool={game.prompt?.pay?.pool}
      onPlayerClick={clickPlayer}
      banner={
        board && game.ask ? (
          <TargetBar
            sent={game.sent}
            message={game.ask.title ? `${game.ask.title}\n${game.ask.message}` : game.ask.message}
            status={game.ask.max > 1 && boardPicked.length < game.ask.max ? `Click on the table · ${game.ask.min > boardPicked.length ? `${game.ask.min - boardPicked.length} more to go` : `up to ${game.ask.max - boardPicked.length} more`}` : "Click on the table"}
            count={{ picked: boardPicked.length, min: game.ask.min, max: game.ask.max }}
            ok={{
              label: boardPicked.length === 0 && game.ask.min === 0 ? "Choose none" : "Confirm",
              enabled: boardPicked.length >= game.ask.min && boardPicked.length <= game.ask.max,
              onClick: answerBoard,
            }}
          />
        ) : targeting && game.prompt ? (
          <TargetBar sent={game.sent} message={game.prompt.message} ok={{ ...game.prompt.ok, onClick: ok }} cancel={{ ...game.prompt.cancel, onClick: cancel }} />
        ) : null
      }
      onCastCommander={click}
      playable={playable}
      selectable={selectable}
      chosen={chosen}
      stackTargets={stackTargets}
      targetPlayers={targetPlayers}
      attack={attacking ? { candidates: attackCandidates, declare: declareAttack } : undefined}
      menuFor={menuFor}
      detailsFor={game.details}
      gameMenu={gameMenu}
      peek={searchOf && game.searchList?.owner === searchOf
        ? { title: `${searchPlayer?.name ?? "Their"}'s library (they let you search it; right-click a card to exile it)`, cards: game.searchList.cards, onClose: () => game.endSearch(searchOf) }
        : peek ? { title: peek.top > 0 ? `Top ${peek.top === 1 ? "card" : `${peek.top} cards`} of your library` : "Your library (only you see this)", cards: peekCards, loading: game.libraryList?.top !== peek.top, expect: peek.top > 0 ? Math.min(peek.top, myLibrary) : myLibrary, onClose: closePeek } : null}
      stackItemMenu={(s) => [
        {
          items: s.yieldKey
            ? [{
                label: "Settings",
                onSelect: () => {},
                panel: <AbilityPanel ability={{ key: s.yieldKey, text: s.text ?? "", mayAsk: s.optional, mine: s.mine }} card={s.card?.name ?? s.name} />,
              }]
            : [],
        },
        { items: [{ label: `${view.autoYieldsOff ? "✓ " : ""}Disable auto-yields`, onSelect: () => game.setYieldsOff(!view.autoYieldsOff) }] },
      ]}
    />
    </LaterProvider>
    </AbilityProvider>
  );
}

/** Forge's "you have priority" prompt (InputPassPriority): OK, and End Turn or Undo. */
/** Declaring blockers (Forge's InputBlock): clicked on the board, like attackers. */
function isBlockPrompt(p: { message: string }) {
  return p.message.startsWith("Select creatures to block") || p.message.startsWith("Select another attacker to declare blockers");
}

function isPriorityPrompt(p: { ok: { label: string }; cancel: { label: string } }) {
  return p.ok.label === "OK" && (p.cancel.label === "End Turn" || p.cancel.label.startsWith("Undo"));
}

/** Scryfall's data for a card the engine doesn't have, for the game server's stand-in (forge-web-server StandIns). */
function standIn(c: scry.ScryCard): StandIn {
  const face = (f: { name: string; mana_cost?: string; type_line?: string; oracle_text?: string; power?: string; toughness?: string; loyalty?: string; defense?: string }) => ({
    name: f.name,
    manaCost: f.mana_cost ?? "",
    typeLine: f.type_line ?? "",
    oracleText: f.oracle_text ?? "",
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    defense: f.defense,
  });
  const twoFaced = (c.layout === "transform" || c.layout === "modal_dfc") && c.card_faces?.length === 2;
  if (twoFaced) return { ...face(c.card_faces![0]), layout: c.layout, faces: c.card_faces!.map(face) };
  const front = c.card_faces?.[0];
  // Split, adventure, flip and similar cards: the front face.
  return front ? { ...face({ ...front, type_line: front.type_line ?? c.type_line.split(" // ")[0] }), layout: c.layout } : { ...face(c), layout: c.layout };
}
