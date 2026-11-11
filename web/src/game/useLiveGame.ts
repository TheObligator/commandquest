// A live game on the game server (docs/game-protocol.md): connect, sign in with the Convex token,
// start a game, then mirror the server's view and send this player's actions.
import { useAuthToken } from "@convex-dev/auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoPassMode, StepId } from "./phases";
import type { CardView, GameView } from "./view";

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
}

export interface AskOption {
  label: string;
  cardId?: number;
  playerId?: string;
  card?: CardView;
}

/** A question that blocks the game until answered. */
export interface LiveAsk {
  id: number;
  /** choose: pick min..max options; text: type an answer; info: a list to look at, then OK. */
  kind: "choose" | "text" | "info";
  title?: string;
  message: string;
  options?: AskOption[];
  selected?: number[];
  min: number;
  max: number;
  card?: CardView;
  initial?: string;
  numeric?: boolean;
}

/** One thing a card can do (Forge's wording), from the game server's `actions` answer. */
export interface CardAction {
  ability: number;
  label: string;
  enabled: boolean;
}
export interface CardActions {
  actions: CardAction[];
  /** Why nothing can be done with it right now, when that's the case. */
  reason?: string;
}

/** Forge's own text for a card (rules text plus what's changed in this game), from `details`. */
export interface CardDetails {
  text?: string;
  sick?: boolean;
  owner?: string;
  commanderCasts?: number;
}

/** Manual overrides from a card's menu (the server checks they're your cards). */
export type ManualAction =
  | "tap" | "untap" | "faceDown" | "faceUp" | "skipUntap" | "neverUntap" | "untapNormally" | "tokenCopy"
  | "toBattlefield" | "toHand" | "toGraveyard" | "toExile" | "toCommand" | "toLibraryTop" | "toLibraryBottom" | "reveal";

/** Manual actions on your own library (free play): the top `n` cards, or reveal the top card. */
export type LibraryAction = "draw" | "mill" | "exile" | "revealTop" | "shuffle";

/** Your library's cards as the server last listed them for you (`top` 0: all of it), top first. */
export interface LibraryList {
  top: number;
  cards: CardView[];
}

export type LiveStatus = "connecting" | "signing-in" | "ready" | "starting" | "playing" | "over" | "offline";

export interface DeckPayload {
  name: string;
  /** `set` / `collectorNumber`: the printing you picked (Scryfall codes), so Forge uses it too. */
  cards: { name: string; quantity: number; board: string; set?: string; collectorNumber?: string }[];
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
  const [notice, setNotice] = useState<{ message: string; n: number } | null>(null);
  const actionWaiters = useRef(new Map<number, ((a: CardActions) => void)[]>());
  const detailWaiters = useRef(new Map<number, ((d: CardDetails) => void)[]>());
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

  const send = useCallback((m: object) => {
    const s = ws.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(m));
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;
    let retryMs = 1000;
    const connect = () => {
      setStatus("connecting");
      const s = new WebSocket(gameSocketUrl());
      ws.current = s;
      s.onopen = () => {
        retryMs = 1000;
        setStatus("signing-in");
        if (tokenRef.current) s.send(JSON.stringify({ t: "hello", token: tokenRef.current }));
      };
      s.onmessage = (e) => {
        const m = JSON.parse(e.data as string);
        switch (m.t) {
          case "hello":
            setStatus("ready");
            break;
          case "state":
            setView(m.view as GameView);
            setStatus(m.view.gameOver ? "over" : "playing");
            break;
          case "prompt":
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
            break;
          case "replaced":
            setError("You started a game somewhere else, so this one ended.");
            setStatus("over");
            break;
          case "libraryCards":
            setLibraryList({ top: m.top ?? 0, cards: m.cards ?? [] });
            break;
          case "notice":
            setNotice((n) => ({ message: m.message, n: (n?.n ?? 0) + 1 }));
            break;
          case "actions": {
            const waiters = actionWaiters.current.get(m.id) ?? [];
            actionWaiters.current.delete(m.id);
            for (const w of waiters) w({ actions: m.actions ?? [], reason: m.reason });
            break;
          }
          case "details": {
            const waiters = detailWaiters.current.get(m.id) ?? [];
            detailWaiters.current.delete(m.id);
            for (const w of waiters) w({ text: m.text, sick: m.sick, owner: m.owner, commanderCasts: m.commanderCasts });
            break;
          }
          case "error":
            setError(m.message);
            if (statusRef.current === "starting") setStatus("ready");
            break;
        }
      };
      s.onclose = () => {
        if (closed) return;
        // A game lives on the socket: if it drops, the server ends that game.
        setStatus((st) => (st === "playing" ? "over" : "offline"));
        setPrompt(null);
        setAsk(null);
        retry = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, []);

  // The token can arrive after the socket opens (or refresh): sign in when both are there.
  useEffect(() => {
    if (token && status === "signing-in") send({ t: "hello", token });
  }, [token, status, send]);

  return {
    status,
    view,
    prompt,
    ask,
    error,
    notice,
    autoPass,
    libraryList,
    signedIn: !!token,
    clearError: () => setError(null),
    /** `freePlay`: allow manual overrides (tap, move, counters…) and paying mana costs with nothing. */
    start(deck: DeckPayload, name: string, opponents = 3, freePlay = true) {
      setError(null);
      setView(null);
      setPrompt(null);
      setAsk(null);
      setAutoPassState(null);
      setStatus("starting");
      send({ t: "start", deck, name, opponents, freePlay });
    },
    ok: () => send({ t: "ok" }),
    cancel: () => send({ t: "cancel" }),
    /** Free play: draw, mill or exile the top `n` cards of your library, reveal its top card to `to`, or shuffle it. */
    library: (action: LibraryAction, n = 1, to?: string[]) => send({ t: "library", action, n, to: to?.map(Number) }),
    /** Free play: list your library for you (`top` 0: search all of it). `log`: tell the table (when you open it). */
    listLibrary: (top: number, log: boolean) => send({ t: "libraryCards", top, log }),
    clearLibraryList: () => setLibraryList(null),
    /** Free play: pay the mana cost you're paying now with nothing. */
    payFree: () => send({ t: "payFree" }),
    clickCard: (id: number) => send({ t: "card", id }),
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
    /** Auto-yield to an ability on the stack (by its `yieldKey`), and for an optional trigger, always yes / no / ask. */
    setYield(key: string, change: { autoYield?: boolean; decision?: "ASK" | "ACCEPT" | "DECLINE" }) {
      send({ t: "yield", key, ...change });
    },
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
    concede: () => send({ t: "concede" }),
    answer(id: number, choice: number[] | null, text?: string) {
      setAsk(null);
      send({ t: "answer", id, choice: choice ?? [], text });
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
