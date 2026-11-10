import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";

type SocketState = "connecting" | "open" | "closed";

/** Connection to the game server on the Mac. Games will run over this socket. */
function useGameServerStatus(): SocketState {
  const [state, setState] = useState<SocketState>("connecting");
  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
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
  const decks = useQuery(api.decks.list, isAuthenticated ? {} : "skip");
  const label = { connecting: "connecting…", open: "online", closed: "offline, retrying…" }[status];

  return (
    <>
      <div className="page-head">
        <h1>Play</h1>
        <p className="muted">Game server: <span className="status" data-state={status}>{label}</span></p>
      </div>
      <div className="card play-deck">
        <label>
          Your deck
          <select disabled={!decks?.length}>
            {!isAuthenticated ? (
              <option>Sign in to pick a deck</option>
            ) : !decks?.length ? (
              <option>No decks yet: build one first</option>
            ) : (
              decks.map((d) => <option key={d._id} value={d._id}>{d.name} ({d.commanders.join(" & ") || d.format})</option>)
            )}
          </select>
        </label>
        <a href="#/decks" className="link">Manage decks →</a>
      </div>
      <p className="card table-preview-link">
        <strong>Set up your stops: </strong>try the game table's phase sidebar on a simulated game.{" "}
        <a href="#/table" className="link">Open the table preview →</a>
      </p>
      <div className="modes">
        <Mode title="Quick game" tag="Against AI" text="You and three AI opponents, Commander rules." />
        <Mode title="Create a table" tag="Multiplayer" text="Open a table and invite friends with a link." />
        <Mode title="Join a table" tag="Multiplayer" text="Enter a table code from a friend." />
      </div>
    </>
  );
}

function Mode({ title, text, tag }: { title: string; text: string; tag: string }) {
  return (
    <div className="mode card">
      <span className="tag">{tag}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="btn" disabled title="The game client is under construction">Coming soon</button>
    </div>
  );
}
