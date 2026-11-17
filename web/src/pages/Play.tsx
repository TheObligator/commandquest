import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { gameSocketUrl } from "../game/useLiveGame";
import { useGameProblems } from "../useGameDecks";

type SocketState = "connecting" | "open" | "closed";

/** Connection to the game server on the Mac. Games will run over this socket. */
function useGameServerStatus(): SocketState {
  const [state, setState] = useState<SocketState>("connecting");
  useEffect(() => {
    const url = gameSocketUrl();
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    let retryMs = 500;
    let closed = false;
    const connect = () => {
      setState("connecting");
      socket = new WebSocket(url);
      socket.onopen = () => {
        retryMs = 500;
        setState("open");
      };
      socket.onclose = () => {
        if (closed) return;
        setState("closed");
        retry = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 10_000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
  return state;
}

export function Play() {
  const status = useGameServerStatus();
  const { isAuthenticated } = useConvexAuth();
  const decks = useQuery(api.decks.forPlay, isAuthenticated ? {} : "skip");
  const label = { connecting: "connecting…", open: "online", closed: "offline, retrying…" }[status];
  const [deckId, setDeckId] = useState("");
  // Only decks that can start a game are offered; the rest are listed with what's wrong.
  const problems = useGameProblems(decks);
  const checking = !!decks?.length && !problems;
  const ready = problems ? (decks ?? []).filter((d) => !problems.get(d._id)?.length) : [];
  const notReady = problems ? (decks ?? []).filter((d) => problems.get(d._id)?.length) : [];
  const chosen = ready.some((d) => d._id === deckId) ? deckId : ready[0]?._id ?? "";

  return (
    <>
      <div className="page-head">
        <h1>Play</h1>
        <p className="muted">Game server: <span className="status" data-state={status}>{label}</span></p>
      </div>
      <div className="card play-deck">
        <label>
          Your deck
          <select disabled={!ready.length} value={chosen} onChange={(e) => setDeckId(e.target.value)}>
            {!isAuthenticated ? (
              <option>Sign in to pick a deck</option>
            ) : decks === undefined ? (
              <option>Loading your decks…</option>
            ) : !decks.length ? (
              <option>No decks yet: build one first</option>
            ) : checking ? (
              <option>Checking your decks…</option>
            ) : !ready.length ? (
              <option>None of your decks is ready to play yet</option>
            ) : (
              ready.map((d) => <option key={d._id} value={d._id}>{d.name} ({d.commanders.join(" & ")})</option>)
            )}
          </select>
        </label>
        <a href="#/decks" className="link">Manage decks →</a>
        {notReady.length > 0 && (
          <details className="not-ready">
            <summary className="muted small">
              {notReady.length} {notReady.length === 1 ? "deck isn't" : "decks aren't"} ready for a Commander game
            </summary>
            <ul>
              {notReady.map((d) => (
                <li key={d._id}>
                  <a className="link" href={`#/decks/${d._id}`}>{d.name}</a>
                  <ul className="muted small">
                    {problems!.get(d._id)!.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <p className="card table-preview-link">
        <strong>Set up your stops: </strong>try the game table's phase sidebar on a simulated game.{" "}
        <a href="#/table" className="link">Open the table preview →</a>
      </p>
      <div className="modes">
        <Mode
          title="Quick game"
          tag="Against AI"
          text="You and up to three Forge AI opponents, Commander rules."
          href={chosen && status === "open" ? `#/game?deck=${encodeURIComponent(chosen)}` : undefined}
          why={!isAuthenticated ? "Sign in first" : checking ? "Checking your decks…" : !chosen ? (decks?.length ? "No deck is ready to play" : "Build a deck first") : status !== "open" ? "The game server is offline" : undefined}
        />
        <Mode title="Create a table" tag="Multiplayer" text="Open a table and invite friends with a link." />
        <Mode title="Join a table" tag="Multiplayer" text="Enter a table code from a friend." />
      </div>
    </>
  );
}

function Mode({ title, text, tag, href, why }: { title: string; text: string; tag: string; href?: string; why?: string }) {
  return (
    <div className="mode card">
      <span className="tag">{tag}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {href ? (
        <a className="btn" href={href}>Play</a>
      ) : (
        <button className="btn" disabled title={why ?? "Coming soon"}>{why ?? "Coming soon"}</button>
      )}
    </div>
  );
}
