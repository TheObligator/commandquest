import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { clearPending, newPending, pending as savedPending, type Pending } from "../app/handoff";
import { useEffect, useState } from "react";
import { errorMessage } from "../app/errors";
import { navigate, useRoute } from "../app/router";

const NEXT_KEY = "cq.signin.next";

/** Where to go after sign-in completes (it may finish on a fresh page load, after a magic link). */
export function takeNextPath(): string | null {
  try {
    const next = localStorage.getItem(NEXT_KEY);
    localStorage.removeItem(NEXT_KEY);
    return next && next.startsWith("/") ? next : null;
  } catch {
    return null;
  }
}

function rememberNext(next: string) {
  try {
    localStorage.setItem(NEXT_KEY, next);
  } catch {
    // Storage blocked: you just land on the home page after signing in.
  }
}

export function SignIn() {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const { query } = useRoute();
  const next = query.get("next") ?? "/decks";
  const [email, setEmail] = useState("");
  // A link asked for here, maybe opened on another device (app/handoff.ts): wait for its code.
  const [waiting, setWaiting] = useState<Pending | null>(() => savedPending());
  const sentTo = waiting?.email ?? null;
  const handedCode = useQuery(api.signinHandoff.waiting, waiting && !isAuthenticated ? { pair: waiting.pair } : "skip");
  const handoffDone = useMutation(api.signinHandoff.done);
  useEffect(() => {
    if (!handedCode || !waiting) return;
    const pair = waiting.pair;
    void (async () => {
      try {
        const r = await (signIn as (provider: string | undefined, params: { code: string }) => Promise<{ signingIn: boolean }>)(undefined, { code: handedCode });
        if (!r.signingIn) setError("That sign-in link has expired or was already used. Ask for a new one.");
      } catch (err) {
        setError("That sign-in link has expired or was already used. Ask for a new one.");
        console.warn(errorMessage(err));
      }
      clearPending();
      setWaiting(null);
      void handoffDone({ pair });
    })();
  }, [handedCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated) navigate(next.startsWith("/") ? next : "/decks", true);
  }, [isAuthenticated, next]);

  async function emailLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    rememberNext(next);
    try {
      const p = newPending(email.trim());
      await signIn("resend", { email: email.trim(), redirectTo: `/?pair=${p.pair}` });
      setWaiting(p);
    } catch (err) {
      clearPending();
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: "google" | "discord") {
    rememberNext(next);
    try {
      await signIn(provider); // redirects to the provider and back
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Sign in</h1>
        <p className="muted">New here? Signing in creates your account. You'll stay signed in on this device.</p>
        {sentTo ? (
          <div className="sent">
            <p><strong>Check your email.</strong> We sent a sign-in link to {sentTo}.</p>
            <p className="muted">
              Open it here, or on any other device, like your phone: choose "Sign in on the device that asked" there and this
              page signs in by itself. Keep this page open.
            </p>
            <button className="btn ghost small" onClick={() => (clearPending(), setWaiting(null))}>Use a different email</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={emailLink}>
            <label>
              Email
              <input type="email" name="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn wide" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
        )}
        <div className="or"><span>or</span></div>
        <div className="oauth">
          <button className="btn ghost wide" onClick={() => void oauth("google")}>Continue with Google</button>
          <button className="btn ghost wide" onClick={() => void oauth("discord")}>Continue with Discord</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
