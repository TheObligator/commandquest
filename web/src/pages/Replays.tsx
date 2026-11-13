// Your replays (docs/replays.md): your last 5 games, kept automatically, and up to 5 you saved,
// which stay until you delete them.
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "../app/errors";
import { Loading } from "../components/Spinner";
import { toast } from "../dom";
import { MAX_RECENT, MAX_SAVED } from "../../convex/model/replays";
import { ago } from "./DeckList";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.replays.mine>>>["recent"][number];

export function Replays() {
  const mine = useQuery(api.replays.mine);
  const save = useMutation(api.replays.save);
  const remove = useMutation(api.replays.remove);

  const run = async (f: () => Promise<unknown>, done?: string) => {
    try {
      await f();
      if (done) toast(done);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const full = (mine?.saved.length ?? 0) >= MAX_SAVED;

  const row = (r: Row) => (
    <li key={r._id} className="replay-row card">
      <div className="replay-info">
        <h3>{r.title}</h3>
        <p className="muted small">
          {ago(r.playedAt)} · {r.turns} turns{r.winner ? ` · ${r.winner} won` : ""}
          {r.truncated ? " · cut short" : ""}
        </p>
        <p className="small">
          {r.players.map((p, i) => (
            <span key={i} className="replay-player">
              {p.name}
              {p.commander && <span className="muted"> ({p.commander})</span>}
            </span>
          ))}
        </p>
      </div>
      <div className="actions">
        <a className="btn small" href={`#/replay?id=${r._id}`}>Watch</a>
        {!r.saved && (
          <button
            className="btn small ghost"
            disabled={full}
            title={full ? `You have ${MAX_SAVED} saved games: delete one to save this one.` : "Keep it: it won't be replaced by newer games"}
            onClick={() => run(() => save({ id: r._id }), "Saved.")}
          >
            Save
          </button>
        )}
        <button
          className="btn small ghost"
          onClick={() => confirm(`Delete the replay of ${r.title}?`) && run(() => remove({ id: r._id }))}
        >
          Delete
        </button>
      </div>
    </li>
  );

  return (
    <>
      <div className="page-head row">
        <h1>Replays</h1>
      </div>
      {mine === undefined ? (
        <Loading />
      ) : (
        <>
          <section className="replay-section">
            <h2>
              Saved <span className="muted small">{mine.saved.length} of {MAX_SAVED}</span>
            </h2>
            {mine.saved.length === 0 ? (
              <p className="muted">Save a game below to keep it for good. Saved games are never replaced; to save a sixth, delete one.</p>
            ) : (
              <ul className="replay-list">{mine.saved.map(row)}</ul>
            )}
          </section>
          <section className="replay-section">
            <h2>
              Recent games <span className="muted small">your last {MAX_RECENT}</span>
            </h2>
            {mine.recent.length === 0 ? (
              <p className="muted">Finished games show up here. A new one replaces the oldest unless you save it.</p>
            ) : (
              <ul className="replay-list">{mine.recent.map(row)}</ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
