// A live game on the game server (docs/game-protocol.md): connect, sign in with the Convex token,
// start a game, then mirror the server's view and send this player's actions. The game outlives
// the socket for a few minutes: after a reload or a dropped connection, signing in again resumes it.
import type { CardAbility, Decision } from "./abilities";
import { useAuthToken } from "@convex-dev/auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { setGameInProgress } from "../app/busy";
import { Sending, type Sent } from "./sending";
import type { LaterSpec, SavedLater } from "./later";
import type { AutoPassMode, StepId } from "./phases";
import type { CardView, GameView, RewindLevel } from "./view";

/** Socket URL of the game server: VITE_GAME_SERVER in builds, this origin (Vite's proxy) in dev. */
export function gameSocketUrl(): string {
  const base = new URL(import.meta.env.VITE_GAME_SERVER || location.origin);
  return `${base.protocol === "https:" ? "wss" : "ws"}://${base.host}/ws`;
}

export interface LiveButton {
  label: string;
  enabled: boolean;
}

/** What Forge is waiting for: a prompt answered with OK / Cancel, or by clicking cards or players. */
export interface LivePrompt {
  message: string;
  ok: LiveButton;
  cancel: LiveButton;
  /** Set while you pay mana for a spell or ability: OK is Forge's Auto-pay, Cancel stops the cast. */
  pay?: LivePay;
}

/** What you're paying mana for. `free`: this game allows paying it with nothing (free play). */
export interface LivePay {
  cost: string;
  card: string;
  cardId: number;
  kind: "spell" | "ability" | "effect";
  free: boolean;
  /** Your untapped permanents that can pay, for the table's highlight. */
  sources?: number[];
  /** The kinds of floating mana in your pool that can pay some of it ("W", "C"…). */
  pool?: string[];
}

export interface AskOption {
  label: string;
  /** A color of mana to make ("W", "C"): the question is what mana an ability makes. */
  mana?: string;
  /** distribute: the most this option may get. */
  max?: number;
  cardId?: number;
  playerId?: string;
  card?: CardView;
}

/** Cards revealed to you, in a window you close; the game doesn't wait. `note` says why there are none. */
export interface LiveShown {
  n: number;
  title: string;
  note?: string;
  cards: CardView[];
}

/** A question that blocks the game until answered. */
export interface LiveAsk {
  id: number;
  /**
   * choose: pick min..max options; text: type an answer; info: a list to look at, then OK;
   * order: put options in order (answer: their indexes in order, min..max of them);
   * distribute: divide `amount` among the options (answer: one number per option).
   */
  kind: "choose" | "text" | "info" | "order" | "distribute" | "arrange" | "scry";
  /** scry (a scry or surveil window): where the cards not kept on top go. Answer: top indexes (top first), -1, the others. */
  away?: "bottom" | "graveyard";
  /** arrange (scry…): whether cards may go on top / on the bottom of the library. */
  toTop?: boolean;
  toBottom?: boolean;
  /** order: what the first position means ("Closest to top"…). */
  top?: string;
  /** distribute: the total to divide, and whether each option needs at least 1. */
  amount?: number;
  atLeastOne?: boolean;
  title?: string;
  message: string;
  options?: AskOption[];
  selected?: number[];
  min: number;
  max: number;
  card?: CardView;
  /** A yes/no question (Forge's confirm): asked in the Decision panel, not a window. */
  yesNo?: boolean;
  /** Every option is a color of mana: asked by the card being tapped (ManaChoice). */
  mana?: boolean;
  initial?: string;
  numeric?: boolean;
}

/** One thing a card can do (Forge's wording), from the game server's `actions` answer. */
export interface CardAction {
  ability: number;
  label: string;
  enabled: boolean;
  /** It can be put off to a step (docs/use-later.md); "sorcery": only to your own main phases. */
  later?: "any" | "sorcery";
}
/** One way to tap a card for mana (ManaTaps.java): its own ability, or another card's "tap an untapped …" one (`via`). */
export interface ManaPick {
  source: number;
  ability: number;
  /** Forge's color choice ("U", "G G"), empty when there's none. */
  choice: string;
  /** What it adds, as symbols: "W", "CC". */
  mana: string;
  /** The other card whose ability this is. */
  via?: string;
  /** Damage it deals you (pain lands, City of Brass). */
  damage?: number;
  /** Life you pay or lose (Mana Confluence). */
  life?: number;
}
export interface ManaOptions {
  /** Cards that can be tapped for mana, with their ways; cards left out can't. */
  options: { id: number; picks: ManaPick[] }[];
  reason?: string;
}

export interface CardActions {
  actions: CardAction[];
  /** Why nothing can be done with it right now, when that's the case. */
  reason?: string;
  /** Its triggered abilities, for their settings. */
  triggers?: CardAbility[];
}

/** Forge's own text for a card (rules text plus what's changed in this game), from `details`. */
export interface CardDetails {
  text?: string;
  sick?: boolean;
  owner?: string;
  commanderCasts?: number;
  /** Its triggered abilities, for their markers. */
  triggers?: CardAbility[];
}

/** Manual overrides from a card's menu (the server checks they're your cards). */
export type ManualAction =
  | "tap" | "untap" | "faceDown" | "faceUp" | "skipUntap" | "neverUntap" | "untapNormally" | "tokenCopy"
  | "toBattlefield" | "toHand" | "toGraveyard" | "toExile" | "toCommand" | "toLibraryTop" | "toLibraryBottom" | "reveal"
  /** Combat by hand: put your creature into combat attacking (`to`: the player), or take any creature out. */
  | "attack" | "removeFromCombat"
  /** More by hand: goad (someone else's creature), phase out, transform, and from hand plot or discard. */
  | "goad" | "phaseOut" | "transform" | "plot" | "discard"
  /** Exile face down; only the players in `to` may look at it (you, for foretell or hideaway). */
  | "exileFaceDown"
  /** From hand: foretell (face down, foretold), or suspend with N time counters (`suspend:3`). */
  | "foretell" | `suspend:${number}`
  /** Let yourself cast it from exile or your graveyard: `cast:pay`, `cast:free`, or `cast:cost:2 U`. */
  | `cast:${string}`
  /** Until end of turn, on any permanent: `eot:<key>` (see EOT_GROUPS in pages/LiveGame.tsx) or `eot:pt:+2:+2`. */
  | `eot:${string}`;

/** Manual actions on your own library (free play): the top `n` cards, or reveal the top card. */
export type LibraryAction = "draw" | "mill" | "exile" | "revealTop" | "shuffle";

/** Your library's cards as the server last listed them for you (`top` 0: all of it), top first. */
export interface LibraryList {
  top: number;
  cards: CardView[];
  /** Whose library (yours, or one you're searching). */
  owner?: string;
}

/**
 * `reconnecting`: the connection dropped mid-game; the table stays up while it comes back.
 * `moved`: the game is open in another tab now (`takeBack` brings it here).
 */
export type LiveStatus = "connecting" | "signing-in" | "ready" | "starting" | "playing" | "reconnecting" | "over" | "offline" | "moved";

/** Heartbeat: ping this often, and treat the connection as dead after this long without a word. */
const PING_MS = 10_000;
const SILENT_MS = 25_000;

/** A card the engine doesn't have, from Scryfall: the game server plays it as a stand-in with free play. */
export interface StandIn {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  layout: string;
  faces?: Omit<StandIn, "layout" | "faces">[];
}

export interface TableWaiting {
  joined: number;
  total: number;
  /** Names of the players who haven't come in yet. */
  waitingFor: string[];
  /** How long the game waits for them before starting without them. */
  seconds: number;
}

export interface DeckPayload {
  /** The saved deck's id, so the game can save ability settings with it (also after a reload). */
  id?: string;
  name: string;
  /** Ability settings saved with the deck. */
  abilities?: { text: string; autoYield?: boolean; decision?: "ACCEPT" | "DECLINE" }[];
  /** `set` / `collectorNumber`: the printing you picked (Scryfall codes), so Forge uses it too. */
  /** Abilities saved with the deck to be used later. */
  later?: SavedLater[];
  cards: { name: string; quantity: number; board: string; set?: string; collectorNumber?: string; standIn?: StandIn }[];
  /** The deck's token art: token identity (src/tokens.ts) -> Scryfall id. */
  tokens?: Record<string, string>;
}

export function useLiveGame() {
  const token = useAuthToken();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [view, setView] = useState<GameView | null>(null);
  const [prompt, setPrompt] = useState<LivePrompt | null>(null);
  const [ask, setAsk] = useState<LiveAsk | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Why the last click did nothing (a `notice`), with a counter so the same text shows again. */
  const [libraryList, setLibraryList] = useState<LibraryList | null>(null);
  /** Another player's library you're searching (they let you). */
  const [searchList, setSearchList] = useState<LibraryList | null>(null);
  const searchOwner = useRef<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; n: number } | null>(null);
  /** Revealed cards waiting to be looked at, oldest first. */
  const [shown, setShown] = useState<LiveShown[]>([]);
  const shownCount = useRef(0);
  /** A table's game waiting for its players (docs/tables.md): who's still to come. */
  const [tableWaiting, setTableWaiting] = useState<TableWaiting | null>(null);
  /** The table's game this page asked to join isn't on (any more). */
  const [tableGone, setTableGone] = useState<string | null>(null);
  const actionWaiters = useRef(new Map<number, ((a: CardActions) => void)[]>());
  const detailWaiters = useRef(new Map<number, ((d: CardDetails) => void)[]>());
  const manaWaiters = useRef<((o: ManaOptions) => void)[]>([]);
  const [autoPass, setAutoPassState] = useState<AutoPassMode | null>(null);
  // The server says when an auto-pass has ended (reached its step, or something needed you):
  // light its button only while it's going.
  const wasPassing = useRef(false);
  useEffect(() => {
    const passing = !!view?.autoPassing;
    if (wasPassing.current && !passing) setAutoPassState(null);
    wasPassing.current = passing;
  }, [view?.autoPassing]);
  const ws = useRef<WebSocket | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const statusRef = useRef(status);
  statusRef.current = status;
  /** Opens a fresh socket now (set by the connection effect). */
  const reconnect = useRef<() => void>(() => {});

  // A staging deploy doesn't reload the page under a game (src/app/UpdateNotice.tsx).
  useEffect(() => {
    setGameInProgress(status === "starting" || status === "playing" || status === "reconnecting" || status === "over" || status === "moved");
  }, [status]);
  useEffect(() => () => setGameInProgress(false), []);

  /** False if there's no connection to send it on. */
  const send = useCallback((m: object): boolean => {
    const s = ws.current;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    s.send(JSON.stringify(m));
    return true;
  }, []);

  // Buttons you've pressed that the server hasn't answered yet (src/game/sending.ts): one for the
  // prompt you're answering, one for rewinding.
  const [sent, setSent] = useState<Sent | null>(null);
  const [rewindSent, setRewindSent] = useState<Sent | null>(null);
  const [sending] = useState(() => {
    const noAnswer = (what: string) =>
      setNotice((n) => ({ message: what === "answer" ? "The game server hasn't answered yet." : "The game server hasn't answered. You can try that again.", n: (n?.n ?? 0) + 1 }));
    return { prompt: new Sending(setSent, noAnswer), rewind: new Sending(setRewindSent, noAnswer) };
  });
  /** Sends a button press, unless the server is still dealing with the last one. */
  const press = useCallback((on: Sending, what: string, m: object, byState = false) => {
    if (on.busy) return;
    if (send(m)) on.begin(what, byState);
    else setNotice((n) => ({ message: "Not connected to the game server. Try that again in a moment.", n: (n?.n ?? 0) + 1 }));
  }, [send]);

  useEffect(() => {
    let closed = false;
    /** Another tab has the game: stay disconnected until `takeBack`. */
    let parked = false;
    let retry: number | undefined;
    let retryMs = 1000;
    let heard = Date.now();
    const lost = (s: WebSocket) => {
      s.onopen = s.onmessage = s.onclose = null;
      s.close();
      if (ws.current !== s) return;
      ws.current = null;
      sending.prompt.clear();
      sending.rewind.clear();
      if (closed) return;
      setPrompt(null);
      setAsk(null);
      if (parked) {
        setStatus("moved");
        return;
      }
      // Mid-game, keep the table up: signing in again resumes the game.
      setStatus((st) => (st === "playing" || st === "reconnecting" ? "reconnecting" : "offline"));
      clearTimeout(retry);
      retry = window.setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    };
    const connect = () => {
      clearTimeout(retry);
      const old = ws.current;
      if (old) {
        old.onopen = old.onmessage = old.onclose = null;
        old.close();
      }
      setStatus((st) => (st === "reconnecting" ? st : "connecting"));
      const s = new WebSocket(gameSocketUrl());
      ws.current = s;
      heard = Date.now();
      s.onopen = () => {
        retryMs = 1000;
        heard = Date.now();
        setStatus((st) => (st === "reconnecting" ? st : "signing-in"));
        if (tokenRef.current) s.send(JSON.stringify({ t: "hello", token: tokenRef.current }));
      };
      s.onmessage = (e) => {
        heard = Date.now();
        const m = JSON.parse(e.data as string);
        sending.prompt.heard(m.t);
        sending.rewind.heard(m.t);
        switch (m.t) {
          case "hello":
            // `game`: we're back in a running game; its state, prompt and questions follow.
            setPrompt(null);
            setAsk(null);
            if (m.game) {
              setStatus("playing");
              setAutoPassState(m.autoPass ?? null);
            } else if (statusRef.current === "reconnecting") {
              setError("You were away too long, so the game ended.");
              setStatus("over");
            } else {
              setStatus("ready");
            }
            break;
          case "moved":
            parked = true;
            lost(s);
            break;
          case "tableWaiting":
            setTableWaiting({ joined: m.joined, total: m.total, waitingFor: m.waitingFor ?? [], seconds: m.seconds ?? 60 });
            break;
          case "tableGone":
            setTableGone(m.message ?? "This table's game isn't on any more.");
            setTableWaiting(null);
            if (statusRef.current === "starting") setStatus("ready");
            break;
          case "state":
            setTableWaiting(null);
            setView(m.view as GameView);
            setStatus(m.view.gameOver ? "over" : "playing");
            if (m.view.gameOver) {
              setPrompt(null);
              setAsk(null);
            }
            break;
          case "pong":
            break;
          case "prompt":
            if (statusRef.current === "over") break; // the game has ended: nothing to answer
            setPrompt({ message: m.message, ok: m.ok, cancel: m.cancel, pay: m.pay });
            break;
          case "waiting":
            setPrompt(null);
            break;
          case "ask":
            setAsk(m as LiveAsk);
            break;
          case "over":
            setStatus("over");
            setPrompt(null);
            setAsk(null);
            break;
          case "replaced":
            setError("You started a game somewhere else, so this one ended.");
            setStatus("over");
            break;
          case "libraryCards":
            if (m.owner && m.owner === searchOwner.current) setSearchList({ top: 0, cards: m.cards ?? [], owner: m.owner });
            else setLibraryList({ top: m.top ?? 0, cards: m.cards ?? [], owner: m.owner });
            break;
          case "notice":
            setNotice((n) => ({ message: m.message, n: (n?.n ?? 0) + 1 }));
            break;
          case "shown":
            setShown((q) => [...q, { n: ++shownCount.current, title: m.title ?? "", note: m.note, cards: m.cards ?? [] }].slice(-20));
            break;
          case "actions": {
            const waiters = actionWaiters.current.get(m.id) ?? [];
            actionWaiters.current.delete(m.id);
            for (const w of waiters) w({ actions: m.actions ?? [], reason: m.reason, triggers: m.triggers });
            break;
          }
          case "manaOptions":
            manaWaiters.current.shift()?.({ options: m.options ?? [], reason: m.reason });
            break;
          case "details": {
            const waiters = detailWaiters.current.get(m.id) ?? [];
            detailWaiters.current.delete(m.id);
            for (const w of waiters) w({ text: m.text, sick: m.sick, owner: m.owner, commanderCasts: m.commanderCasts, triggers: m.triggers });
            break;
          }
          case "error":
            setError(m.message);
            setTableWaiting(null);
            if (statusRef.current === "starting") setStatus("ready");
            break;
        }
      };
      s.onclose = () => lost(s);
    };
    // A connection can die without closing (sleep, Wi-Fi drop): ping, and give up on silence.
    // Browsers run a background tab's timers only about once a minute, so a late tick means we
    // weren't pinging, not that the server went quiet: just ping, and judge on a later tick.
    let lastTick = Date.now();
    const heartbeat = window.setInterval(() => {
      const now = Date.now();
      const late = now - lastTick > PING_MS * 2;
      lastTick = now;
      const s = ws.current;
      if (!s || s.readyState !== WebSocket.OPEN) return;
      if (!late && now - heard > SILENT_MS) lost(s);
      else s.send(JSON.stringify({ t: "ping" }));
    }, PING_MS);
    // Back online, or back to the tab: retry now rather than after the backoff.
    const retryNow = () => {
      if (!parked && !ws.current && document.visibilityState === "visible") {
        retryMs = 1000;
        connect();
      }
    };
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", retryNow);
    reconnect.current = () => {
      parked = false;
      retryMs = 1000;
      setStatus("reconnecting"); // keeps the table up until the game comes back
      connect();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      window.removeEventListener("online", retryNow);
      document.removeEventListener("visibilitychange", retryNow);
      if (ws.current) lost(ws.current);
    };
  }, []);

  // The token can arrive after the socket opens (or refresh): sign in when both are there.
  useEffect(() => {
    if (token && (status === "signing-in" || status === "reconnecting")) send({ t: "hello", token });
  }, [token, status, send]);

  return {
    status,
    view,
    prompt,
    ask,
    error,
    notice,
    shown,
    /** The prompt's button the server is taking a while to answer, if any: it spins and the others wait. */
    sent,
    /** The same for the rewind panel. */
    rewindSent,
    /** The server is still dealing with the prompt button you pressed: another press does nothing. */
    busy: () => sending.prompt.busy,
    /** Closes the oldest revealed-cards window. */
    dismissShown: () => setShown((q) => q.slice(1)),
    autoPass,
    libraryList,
    searchList,
    signedIn: !!token,
    tableWaiting,
    tableGone,
    clearError: () => setError(null),
    /** Brings the game back to this tab after it was opened in another one. */
    takeBack: () => reconnect.current(),
    /** `freePlay`: allow manual overrides (tap, move, counters…) and paying mana costs with nothing. */
    start(deck: DeckPayload, name: string, opponents = 3, freePlay = true, rewind: RewindLevel = 0) {
      setError(null);
      setView(null);
      setPrompt(null);
      setAsk(null);
      setAutoPassState(null);
      setShown([]);
      setStatus("starting");
      send({ t: "start", deck, name, opponents, freePlay, rewind });
    },
    /** Join a table's game with your deck (`key`: the table's game key, from tables.get). */
    joinTable(key: string, deck: DeckPayload) {
      setError(null);
      setTableGone(null);
      setView(null);
      setPrompt(null);
      setAsk(null);
      setAutoPassState(null);
      setShown([]);
      setStatus("starting");
      send({ t: "table", key, deck });
    },
    ok: () => press(sending.prompt, "ok", { t: "ok" }),
    cancel: () => press(sending.prompt, "cancel", { t: "cancel" }),
    /** Free play: draw, mill or exile the top `n` cards of your library, reveal its top card to `to`, or shuffle it. */
    library: (action: LibraryAction, n = 1, to?: string[]) => send({ t: "library", action, n, to: to?.map(Number) }),
    /** Scry or surveil by hand: `top` (top first) stays, `away` goes to the bottom / graveyard. */
    arrange: (kind: "scry" | "surveil", top: number[], away: number[]) => send({ t: "library", action: kind, top, away }),
    /** Free play: list your library for you (`top` 0: search all of it). `log`: tell the table (when you open it). */
    listLibrary: (top: number, log: boolean) => send({ t: "libraryCards", top, log }),
    clearLibraryList: () => setLibraryList(null),
    /** Let another player search your library (free play). */
    letSearch: (to: string) => send({ t: "letSearch", to: Number(to) }),
    /** List the library of a player who lets you search it; `log` when you open it. */
    listSearch: (owner: string, log: boolean) => {
      searchOwner.current = owner;
      send({ t: "libraryCards", top: 0, log, owner: Number(owner) });
    },
    /** Finish searching that player's library (it's shuffled). */
    endSearch: (owner: string) => {
      searchOwner.current = null;
      setSearchList(null);
      send({ t: "endSearch", owner: Number(owner) });
    },
    /** Free play: pay the mana cost you're paying now with nothing. */
    payFree: () => press(sending.prompt, "payFree", { t: "payFree" }),
    /** The ways these cards can be tapped for mana now. */
    manaOptions(ids: number[]): Promise<ManaOptions> {
      return new Promise((resolve) => {
        manaWaiters.current.push(resolve);
        send({ t: "manaOptions", ids });
        window.setTimeout(() => {
          const i = manaWaiters.current.indexOf(resolve);
          if (i >= 0) {
            manaWaiters.current.splice(i, 1);
            resolve({ options: [], reason: "The game server didn't answer." });
          }
        }, 5000);
      });
    },
    /** Tap cards for mana, each as picked (its mana goes to your pool). */
    tapForMana: (picks: { card: number; source: number; ability: number; choice: string }[]) => send({ t: "tapForMana", picks }),
    /** While paying: use floating mana of one color ("W"…"C"), or "all" it can. */
    payPool: (color: string) => press(sending.prompt, `payPool:${color}`, { t: "payPool", color }),
    clickCard: (id: number): void => void send({ t: "card", id }),
    /** What this card can do right now (for its right-click menu). */
    actions(id: number): Promise<CardActions> {
      return new Promise((resolve) => {
        const list = actionWaiters.current.get(id) ?? [];
        list.push(resolve);
        actionWaiters.current.set(id, list);
        send({ t: "actions", id });
        window.setTimeout(() => {
          const l = actionWaiters.current.get(id);
          if (l?.includes(resolve)) {
            actionWaiters.current.set(id, l.filter((x) => x !== resolve));
            resolve({ actions: [], reason: "The game server didn't answer." });
          }
        }, 5000);
      });
    },
    /** Auto-yield to an ability (by its key), and for a "you may", always yes / no / ask; for every copy, or this card's only. */
    setYield(key: string, change: { autoYield?: boolean; decision?: Decision; everyCopy?: boolean }) {
      send({ t: "yield", key, ...change });
    },
    /** Record and run combos (docs/combos.md); `times` 0: until stopped. */
    combos: {
      record: () => void send({ t: "combo", action: "record" }),
      keep: (name?: string, ref?: string) => void send({ t: "combo", action: "keep", name, ref }),
      discard: () => void send({ t: "combo", action: "discard" }),
      run: (id: number, times: number) => void send({ t: "combo", action: "run", id, times }),
      stop: () => void send({ t: "combo", action: "stop" }),
      rename: (id: number, name: string) => void send({ t: "combo", action: "rename", id, name }),
      remove: (id: number) => void send({ t: "combo", action: "remove", id }),
    },
    /** Put an ability off to a step (docs/use-later.md). */
    setLater: (id: number, label: string, spec: LaterSpec) => send({ t: "later", action: "set", id, label, ...spec }),
    cancelLater: (id: number) => send({ t: "later", action: "cancel", id }),
    leaveLater: (id: number) => send({ t: "later", action: "leave", id }),
    /** Forge's text for a card, for its details view. */
    details(id: number): Promise<CardDetails> {
      return new Promise((resolve) => {
        const list = detailWaiters.current.get(id) ?? [];
        list.push(resolve);
        detailWaiters.current.set(id, list);
        send({ t: "details", id });
        window.setTimeout(() => {
          const l = detailWaiters.current.get(id);
          if (l?.includes(resolve)) {
            detailWaiters.current.set(id, l.filter((x) => x !== resolve));
            resolve({});
          }
        }, 5000);
      });
    },
    /** Manual override on one of your cards; `to`: player ids to reveal to. */
    manual: (id: number, action: ManualAction, to?: string[]) => send({ t: "manual", id, action, to: to?.map(Number) }),
    /** Manual override: put counters on a permanent (`delta` < 0 takes them off). Logged in the game log. */
    counter: (id: number, type: string, delta: number) => send({ t: "counter", id, type, delta }),
    /** Turn all your auto-yields off (or back on) without forgetting them. */
    setYieldsOff: (off: boolean) => send({ t: "yieldsOff", off }),
    /** Use one of the card's abilities (from `actions`). */
    useAbility: (id: number, a: CardAction) => send({ t: "ability", id, ability: a.ability, label: a.label }),
    clickPlayer: (id: string) => send({ t: "player", id: Number(id) }),
    /** Pick a spell or ability on the stack (by its stack id) as a target: a counterspell's. */
    clickStack: (id: number) => send({ t: "stack", id }),
    concede: () => send({ t: "concede" }),
    /** Ask to rewind to a point of `view.rewind.options` (everyone else in the game has to agree). */
    rewindTo: (point: number, kind: "timeline" | "attackers" | "blockers" = "timeline") => press(sending.rewind, `ask:${kind}:${point}`, { t: "rewind", action: "ask", point, kind }, true),
    /** Put these creatures of yours in or out of this combat's attack (or blocks): a rewind to redeclare, with the rest as declared. */
    rewindChange: (cards: number[]) => press(sending.rewind, "change", { t: "rewind", action: "change", cards }, true),
    /** Answer someone else's rewind request. */
    rewindVote: (yes: boolean) => press(sending.rewind, yes ? "yes" : "no", { t: "rewind", action: yes ? "yes" : "no" }, true),
    /** Take back your own rewind request. */
    rewindCancel: () => press(sending.rewind, "cancel", { t: "rewind", action: "cancel" }, true),
    answer(id: number, choice: number[] | null, text?: string) {
      // Not sent (no connection): keep the question up, to answer again.
      if (!send({ t: "answer", id, choice: choice ?? [], text })) {
        setNotice((n) => ({ message: "Not connected to the game server. Try that again in a moment.", n: (n?.n ?? 0) + 1 }));
        return;
      }
      setAsk(null);
      sending.prompt.begin("answer", true);
    },
    /** Where you stop, per player id: the steps on that player's turn where you want priority. */
    setStops(stops: Record<string, StepId[]>) {
      send({ t: "stops", stops });
    },
    setAutoPass(mode: AutoPassMode) {
      const next = autoPass === mode ? null : mode;
      setAutoPassState(next);
      send({ t: "autopass", mode: next });
    },
  };
}

export type LiveGame = ReturnType<typeof useLiveGame>;
