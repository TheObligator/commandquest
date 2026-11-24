// A multiplayer table's lobby (#/tables/<id>, docs/tables.md): who's seated, the host's invite
// link and settings, your deck and "ready". When the host starts, everyone goes to the game
// (#/game?table=<id>), which joins it on the game server.
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "../app/errors";
import { navigate } from "../app/router";
import { Loading, Waiting } from "../components/Spinner";
import { toast } from "../dom";
import { REWIND_LEVELS } from "../game/RewindPanel";
import { useTablePresence } from "../game/useTablePresence";
import { useGameChecks } from "../useGameDecks";

/** The invite link for a code, on this site. */
export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}#/join/${code}`;
}

export function TableLobby({ id }: { id: string }) {
  const { isAuthenticated } = useConvexAuth();
  const table = useQuery(api.tables.get, isAuthenticated ? { id } : "skip");
  const tableId = table?._id;
  useTablePresence(tableId);

  // The host pressed Start while you were here: off to the game.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!table) return;
    if (lastStatus.current === "open" && table.status === "playing") navigate(`/game?table=${table._id}`);
    lastStatus.current = table.status;
  }, [table]);

  if (table === undefined) return <Loading text="Loading the table…" />;
  if (table === null) {
    return (
      <div className="card live-start">
        <h2>You're not at this table</h2>
        <p className="muted">It may have closed, or you left it or were removed. To sit down, ask its host for an invite link.</p>
        <p>
          <a className="btn" href="#/play">Back to Play</a>
        </p>
      </div>
    );
  }
  return <Lobby table={table} />;
}

type TableView = NonNullable<FunctionReturnType<typeof api.tables.get>>;

function Lobby({ table }: { table: TableView }) {
  const id = table._id as Id<"tables">;
  const call = (p: Promise<unknown>) => p.catch((e) => toast(errorMessage(e), "error"));
  const leave = useMutation(api.tables.leave);
  const kick = useMutation(api.tables.kick);
  const makeHost = useMutation(api.tables.makeHost);
  const newInvite = useMutation(api.tables.newInvite);
  const update = useMutation(api.tables.update);
  const setDeck = useMutation(api.tables.setDeck);
  const setReady = useMutation(api.tables.setReady);
  const start = useMutation(api.tables.start);
  const backToLobby = useMutation(api.tables.backToLobby);

  const decks = useQuery(api.decks.forPlay);
  const checks = useGameChecks(decks);
  const myDeck = decks?.find((d) => d._id === table.me.deckId);
  const myCheck = table.me.deckId ? checks?.get(table.me.deckId) : undefined;
  const problems = myCheck?.problems ?? [];
  const needsFreePlay = myCheck?.needsFreePlay ?? [];
  const deckBlocked = problems.length > 0 || (needsFreePlay.length > 0 && !table.freePlay);
  // Decks that can't start a game aren't offered (the Decks page marks them and says why). Your
  // current deck stays in the list if it stopped being playable, so you can see what's picked.
  const playable = useMemo(() => (checks ? decks?.filter((d) => !checks.get(d._id)?.problems.length) : undefined), [decks, checks]);
  const unplayable = decks && playable ? decks.length - playable.length : 0;
  const [showLink, setShowLink] = useState(false);
  const playing = table.status === "playing";
  const editable = table.isHost && !playing;

  // Your first visit: pick your most recent playable deck for you.
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || playing || table.me.deckId || !playable?.length) return;
    picked.current = true;
    void call(setDeck({ id, deckId: playable[0]._id as Id<"decks"> }));
  }, [playable, table.me.deckId, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    if (!table.code) return;
    try {
      await navigator.clipboard.writeText(inviteLink(table.code));
      toast("Invite link copied");
    } catch {
      toast("Couldn't copy: select the link and copy it yourself", "error");
    }
  };

  const doLeave = async () => {
    const others = table.players.length - 1;
    const msg = table.isHost && others > 0 ? "Leave this table? Someone else at it becomes the host." : "Leave this table?";
    if (!confirm(msg)) return;
    try {
      await leave({ id });
      navigate("/play");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="table-lobby">
      <div className="page-head row">
        <div>
          <h1>{table.name}</h1>
          <p className="muted">
            {playing ? "Game in progress" : `${table.players.length} of ${table.seats} seats taken`}
            {" · "}
            {table.isHost ? "You're the host" : `Host: ${table.players.find((s) => s.host)?.name ?? "?"}`}
          </p>
        </div>
        <button className="btn ghost" onClick={doLeave}>Leave table</button>
      </div>

      {playing && (
        <div className="card lobby-playing">
          <strong>The game has started.</strong>
          <span className="sb-spacer" />
          <a className="btn" href={`#/game?table=${id}`}>Go to the game</a>
          {table.isHost && (
            <button className="btn ghost" title="If the game never got going, or the game server went away" onClick={() => confirm("End the game for everyone and go back to the lobby?") && call(backToLobby({ id }))}>
              Back to the lobby
            </button>
          )}
        </div>
      )}

      {table.isHost && table.code && (
        <section className="card lobby-invite">
          <h2>Invite players</h2>
          <p className="muted small">Anyone with this link can sit down while there's a free seat, so it's hidden in case your screen is shared. Copy works while it's hidden. Make a new link to retire this one.</p>
          <div className="lobby-invite-row">
            {showLink ? (
              <input readOnly value={inviteLink(table.code)} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            ) : (
              <input readOnly value="••••••••••••••••" className="lobby-invite-hidden" aria-label="Invite link (hidden)" />
            )}
            <button className="btn ghost" onClick={() => setShowLink(!showLink)} aria-pressed={showLink} title={showLink ? "Hide the link" : "Show the link"}>
              {showLink ? "Hide" : "Show"}
            </button>
            <button className="btn" onClick={copy}>Copy</button>
            <button className="btn ghost" onClick={() => call(newInvite({ id }))}>New link</button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Seats</h2>
        <ul className="lobby-seats">
          {table.players.map((s) => (
            <li key={s.userId} className={s.me ? "me" : undefined}>
              <span className="lobby-seat-name">
                {s.host && <span title="Host" aria-label="Host">👑 </span>}
                {s.name}
                {s.me && <span className="muted"> (you)</span>}
              </span>
              <span className="lobby-seat-deck muted small">
                {s.deckName ? `${s.deckName}${s.commanders.length ? ` · ${s.commanders.join(" & ")}` : ""}` : "No deck yet"}
              </span>
              <span className={`lobby-ready${s.ready || s.host ? " on" : ""}`}>
                {s.host ? (s.deckName ? "Host" : "Picking a deck") : s.ready ? "Ready" : "Not ready"}
              </span>
              {editable && !s.me && (
                <span className="lobby-seat-actions">
                  <button className="btn small ghost" onClick={() => confirm(`Make ${s.name} the host?`) && call(makeHost({ id, userId: s.userId }))}>Make host</button>
                  <button className="btn small ghost danger" onClick={() => confirm(`Remove ${s.name} from the table? They can't come back with the invite link.`) && call(kick({ id, userId: s.userId }))}>Remove</button>
                </span>
              )}
            </li>
          ))}
          {Array.from({ length: Math.max(0, table.seats - table.players.length) }, (_, i) => (
            <li key={`empty${i}`} className="empty-seat">
              <span className="lobby-seat-name muted">{table.fillWithAI ? "Forge AI" : "Open seat"}</span>
              <span className="lobby-seat-deck muted small">{table.fillWithAI ? "Plays a random Commander precon unless someone takes the seat" : "Waiting for someone to join"}</span>
            </li>
          ))}
        </ul>
      </section>

      {!playing && (
        <section className="card lobby-me">
          <h2>Your deck</h2>
          {decks === undefined || (decks.length > 0 && !playable) ? (
            <p><Waiting text="Checking your decks…" slow="Still checking your decks… Scryfall is slow right now." /></p>
          ) : !decks.length ? (
            <p>You have no decks yet. <a className="link" href="#/decks">Build or import one</a>, then come back.</p>
          ) : (
            <label className="live-deck">
              <select
                value={table.me.deckId ?? ""}
                onChange={(e) => call(setDeck({ id, deckId: (e.target.value || null) as Id<"decks"> | null }))}
              >
                <option value="">{playable?.length ? "Pick a deck…" : "None of your decks can be played yet"}</option>
                {decks
                  .filter((d) => d._id === table.me.deckId || playable?.includes(d))
                  .map((d) => {
                    const c = checks?.get(d._id);
                    const bad = !!c?.problems.length;
                    return (
                      <option key={d._id} value={d._id}>
                        {`${d.name}${d.commanders.length ? ` (${d.commanders.join(" & ")})` : ""}${bad ? " · can't be played yet" : c?.needsFreePlay.length ? " · needs free play" : ""}`}
                      </option>
                    );
                  })}
              </select>
              {unplayable > 0 && (
                <span className="muted small">
                  {unplayable} {unplayable === 1 ? "deck can't" : "decks can't"} be played yet: they're marked on <a className="link" href="#/decks">your Decks page</a>.
                </span>
              )}
            </label>
          )}
          {myDeck && problems.length > 0 && (
            <div className="form-error">
              This deck can't start a game yet. <a className="link" href={`#/decks/${myDeck._id}`}>Edit the deck</a>
              <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {myDeck && needsFreePlay.length > 0 && (
            <p className={table.freePlay ? "free-play-note small" : "form-error"}>
              ✋ {needsFreePlay.join(", ")} {needsFreePlay.length === 1 ? "isn't" : "aren't"} in the rules engine yet, so this deck needs
              free play{table.freePlay ? "." : ". Ask the host to turn it on."}
            </p>
          )}
          <div className="lobby-go">
            {table.isHost ? (
              <>
                <button className="btn" disabled={!!table.cantStart || deckBlocked} onClick={() => call(start({ id }))}>
                  Start game
                </button>
                {(table.cantStart || deckBlocked) && <span className="muted small">{table.cantStart ?? "Your deck can't be played at this table."}</span>}
                {!table.cantStart && table.ai > 0 && <span className="muted small">Forge AI plays {table.ai === 1 ? "the empty seat" : `the ${table.ai} empty seats`}.</span>}
              </>
            ) : (
              <>
                <button
                  className={`btn${table.me.ready ? " ghost" : ""}`}
                  disabled={!table.me.deckId || (deckBlocked && !table.me.ready)}
                  onClick={() => call(setReady({ id, ready: !table.me.ready }))}
                >
                  {table.me.ready ? "Not ready" : "Ready"}
                </button>
                <span className="muted small">{table.me.ready ? "Waiting for the host to start the game." : "Say you're ready once you've picked your deck."}</span>
              </>
            )}
          </div>
        </section>
      )}

      <Settings table={table} editable={editable} update={(patch) => call(update({ id, ...patch }))} />
    </div>
  );
}

function Settings({ table, editable, update }: { table: TableView; editable: boolean; update: (patch: { name?: string; seats?: number; fillWithAI?: boolean; freePlay?: boolean; rewind?: number }) => void }) {
  const [name, setName] = useState(table.name);
  useEffect(() => setName(table.name), [table.name]);
  const rewind = REWIND_LEVELS[table.rewind];
  return (
    <section className="card lobby-settings">
      <h2>Game settings</h2>
      {!editable && <p className="muted small">{table.isHost ? "Settings can't change while the game is on." : "The host decides these."}</p>}
      <label>
        Table name{" "}
        <input
          value={name}
          maxLength={40}
          disabled={!editable}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== table.name && update({ name })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
      <label>
        Seats{" "}
        <select value={table.seats} disabled={!editable} onChange={(e) => update({ seats: Number(e.target.value) })}>
          {[2, 3, 4].map((n) => (
            <option key={n} value={n} disabled={n < table.players.length}>{n}</option>
          ))}
        </select>
      </label>
      <label className="live-option">
        <input type="checkbox" checked={table.fillWithAI} disabled={!editable} onChange={(e) => update({ fillWithAI: e.target.checked })} />
        <span>
          Fill empty seats with Forge AI
          <span className="muted small"> Off: the game is just the people at the table.</span>
        </span>
      </label>
      <label className="live-option">
        <input type="checkbox" checked={table.freePlay} disabled={!editable} onChange={(e) => update({ freePlay: e.target.checked })} />
        <span>
          Free play
          <span className="muted small"> Fix things by hand like at a paper table: tap, move and copy cards, add counters. The log shows everything done by hand.</span>
        </span>
      </label>
      <label className="live-option">
        <span>
          Rewind{" "}
          <select value={table.rewind} disabled={!editable} onChange={(e) => update({ rewind: Number(e.target.value) })}>
            {REWIND_LEVELS.map((l) => (
              <option key={l.level} value={l.level}>{l.label}</option>
            ))}
          </select>
          <span className="muted small"> {rewind?.hint} Everyone else in the game has to agree to a rewind.</span>
        </span>
      </label>
    </section>
  );
}
