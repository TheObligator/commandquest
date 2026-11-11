import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { clearPending, newPending, normalizeCode, pending as savedPending, type Pending } from "../app/handoff";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The link we sent (app/handoff.ts): opened on another device, it hands its code back here.
  const [waiting, setWaiting] = useState<Pending | null>(() => savedPending());
  const [typed, setTyped] = useState("");
  const sentTo = waiting?.email ?? null;
  const handedOver = useQuery(api.signinHandoff.ready, waiting && !isAuthenticated ? { pair: waiting.pair } : "skip");
  const claim = useMutation(api.signinHandoff.claim);

  /** Signs in with the email's code (from the link, or typed). */
  async function signInWithCode(code: string) {
    if (!waiting) return;
    setError("");
    setBusy(true);
    try {
      const r = await signIn("resend", { code, email: waiting.email });
      if (!r.signingIn) {
        setError("That code didn't work. Check it, or ask for a new email.");
        return;
      }
      clearPending();
    } catch (err) {
      setError("That code didn't work. Check it, or ask for a new email.");
      console.warn(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!handedOver || !waiting) return;
    void (async () => {
      const code = await claim({ pair: waiting.pair });
      if (code) await signInWithCode(code);
    })();
  }, [handedOver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isAuthenticated) navigate(next.startsWith("/") ? next : "/decks", true);
  }, [isAuthenticated, next]);

  async function emailLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    rememberNext(next);
    try {
      const p = newPending(email);
      await signIn("resend", { email: p.email, redirectTo: `/?pair=${p.pair}&email=${encodeURIComponent(p.email)}` });
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
            <p className="muted">Open the link on any device, like your phone, and this page signs in. Or enter the code from the email:</p>
            <form className="auth-form" onSubmit={(e) => (e.preventDefault(), void signInWithCode(normalizeCode(typed)))}>
              <label>
                Code
                <input
                  className="signin-code"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="ABCD-EFGH"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={12}
                />
              </label>
              <button className="btn wide" type="submit" disabled={busy || normalizeCode(typed).length !== 8}>{busy ? "Signing in…" : "Sign in"}</button>
            </form>
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
