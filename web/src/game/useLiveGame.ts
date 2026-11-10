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

export type LiveStatus = "connecting" | "signing-in" | "ready" | "starting" | "playing" | "over" | "offline";

export interface DeckPayload {
  name: string;
  cards: { name: string; quantity: number; board: string }[];
}

export function useLiveGame() {
  const token = useAuthToken();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [view, setView] = useState<GameView | null>(null);
  const [prompt, setPrompt] = useState<LivePrompt | null>(null);
  const [ask, setAsk] = useState<LiveAsk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoPass, setAutoPassState] = useState<AutoPassMode | null>(null);
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
            setPrompt({ message: m.message, ok: m.ok, cancel: m.cancel });
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
    autoPass,
    signedIn: !!token,
    clearError: () => setError(null),
    start(deck: DeckPayload, name: string, opponents = 3) {
      setError(null);
      setView(null);
      setPrompt(null);
      setAsk(null);
      setAutoPassState(null);
      setStatus("starting");
      send({ t: "start", deck, name, opponents });
    },
    ok: () => send({ t: "ok" }),
    cancel: () => send({ t: "cancel" }),
    clickCard: (id: number) => send({ t: "card", id }),
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
