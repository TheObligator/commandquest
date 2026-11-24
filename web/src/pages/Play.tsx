import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { parseCode } from "../../convex/model/tables";
import { errorMessage } from "../app/errors";
import { navigate } from "../app/router";
import { BusyLabel, Spinner } from "../components/Spinner";
import { toast } from "../dom";
import { gameSocketUrl } from "../game/useLiveGame";

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
  const label = { connecting: "connecting…", open: "online", closed: "offline, retrying…" }[status];

  return (
    <>
      <div className="page-head">
        <h1>Play</h1>
        <p className="muted">Game server: <span className="status" data-state={status}>{status !== "open" && <Spinner />} {label}</span></p>
      </div>
      <p className="card table-preview-link">
        <strong>Set up your stops: </strong>try the game table's phase sidebar on a simulated game.{" "}
        <a href="#/table" className="link">Open the table preview →</a>
      </p>
      <div className="modes">
        <Mode
          title="Quick game"
          tag="Against AI"
          text="You and up to three Forge AI opponents, Commander rules. Pick your deck at the table."
          href={isAuthenticated && status === "open" ? "#/game" : undefined}
          why={!isAuthenticated ? "Sign in first" : status !== "open" ? "The game server is offline" : undefined}
        />
        <CreateTable signedIn={isAuthenticated} />
        <JoinTableBox signedIn={isAuthenticated} />
      </div>
    </>
  );
}

/** Your table, if you're at one: shown instead of "Create a table". */
function CreateTable({ signedIn }: { signedIn: boolean }) {
  const mine = useQuery(api.tables.mine, signedIn ? {} : "skip");
  const create = useMutation(api.tables.create);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (mine && !confirm(`You're at "${mine.name}". Leave it and open a new table?`)) return;
    setBusy(true);
    try {
      navigate(`/tables/${await create({})}`);
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };
  return (
    <div className="mode card">
      <span className="tag">Multiplayer</span>
      <h3>{mine ? mine.name : "Create a table"}</h3>
      <p>
        {mine
          ? mine.status === "playing" ? "Your table's game is on." : "You're seated at this table."
          : "Open a table, invite friends with a link, and play Commander together. Forge AI can fill the empty seats."}
      </p>
      {mine ? (
        <div className="mode-actions">
          <a className="btn" href={mine.status === "playing" ? `#/game?table=${mine._id}` : `#/tables/${mine._id}`}>
            {mine.status === "playing" ? "Back to the game" : "Back to the table"}
          </a>
          <button className="btn ghost" onClick={go} disabled={busy}><BusyLabel busy={busy} working="Opening…">New table</BusyLabel></button>
        </div>
      ) : (
        <button className="btn" onClick={go} disabled={!signedIn || busy} title={signedIn ? undefined : "Sign in first"}>
          {signedIn ? <BusyLabel busy={busy} working="Opening…">Create a table</BusyLabel> : "Sign in first"}
        </button>
      )}
    </div>
  );
}

function JoinTableBox({ signedIn }: { signedIn: boolean }) {
  const [text, setText] = useState("");
  const code = parseCode(text);
  return (
    <form
      className="mode card"
      onSubmit={(e) => {
        e.preventDefault();
        if (code) navigate(`/join/${code}`);
      }}
    >
      <span className="tag">Multiplayer</span>
      <h3>Join a table</h3>
      <p>Paste the invite link (or code) the table's host sent you.</p>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Invite link or code" aria-label="Invite link or code" disabled={!signedIn} />
      <button className="btn" disabled={!signedIn || !code} title={signedIn ? undefined : "Sign in first"}>
        {signedIn ? "Join" : "Sign in first"}
      </button>
    </form>
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
