// An email sign-in link opened on a different device than the one that asked for it: sign in on
// the device that asked (it's waiting, and signs itself in), or on this one.
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "../app/errors";
import { navigate } from "../app/router";

export function SignInHere({ link, onDone }: { link: { pair: string; code: string }; onDone: () => void }) {
  const approve = useMutation(api.signinHandoff.approve);
  const { signIn } = useAuthActions();
  const [state, setState] = useState<"ask" | "busy" | "sent">("ask");
  const [error, setError] = useState("");

  const there = async () => {
    setState("busy");
    setError("");
    try {
      await approve(link);
      setState("sent");
    } catch (err) {
      setError(errorMessage(err));
      setState("ask");
    }
  };
  const here = async () => {
    setState("busy");
    setError("");
    try {
      // Convex Auth's sign-in with a link's code (what it does by itself on a link's page).
      const r = await (signIn as (provider: string | undefined, params: { code: string }) => Promise<{ signingIn: boolean }>)(undefined, { code: link.code });
      if (!r.signingIn) throw new Error("code not accepted");
      onDone();
      navigate("/decks", true);
    } catch (err) {
      setError("This link has expired or was already used. Ask for a new one.");
      setState("ask");
      console.warn(errorMessage(err));
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Sign in</h1>
        {state === "sent" ? (
          <>
            <p><strong>Approved.</strong> The device you asked from is signing in now. You can close this page.</p>
            <button className="btn ghost small" onClick={onDone}>Go to CommandQuest</button>
          </>
        ) : (
          <>
            <p className="muted">This link was asked for on another device or browser. Where do you want to be signed in?</p>
            <div className="oauth">
              <button className="btn wide" disabled={state === "busy"} onClick={() => void there()}>Sign in on the device that asked</button>
              <button className="btn ghost wide" disabled={state === "busy"} onClick={() => void here()}>Sign in on this device instead</button>
            </div>
            <p className="muted small">The link works once: choose one.</p>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
