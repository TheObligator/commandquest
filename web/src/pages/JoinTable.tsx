// An invite link (#/join/<code>): sits you at the table, then shows it (docs/tables.md).
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "../app/errors";
import { navigate } from "../app/router";
import { Loading } from "../components/Spinner";

export function JoinTable({ code }: { code: string }) {
  const join = useMutation(api.tables.join);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    join({ code }).then(
      (id) => navigate(`/tables/${id}`, true),
      (e) => setError(errorMessage(e)),
    );
  }, [code, join]);

  if (!error) return <Loading text="Joining the table…" />;
  return (
    <div className="card live-start">
      <h2>Couldn't join the table</h2>
      <p>{error}</p>
      <p>
        <a className="btn" href="#/play">Back to Play</a>
      </p>
    </div>
  );
}
