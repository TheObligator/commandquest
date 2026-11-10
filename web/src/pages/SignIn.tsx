import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
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
  const [sentTo, setSentTo] = useState<string | null>(null);
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
      await signIn("resend", { email: email.trim() });
      setSentTo(email.trim());
    } catch (err) {
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
            <p><strong>Check your email.</strong> We sent a sign-in link to {sentTo}. Open it on this device to finish signing in.</p>
            <button className="btn ghost small" onClick={() => setSentTo(null)}>Use a different email</button>
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
