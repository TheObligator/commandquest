// The page a sign-in email's link opens (app/handoff.ts). In the browser that asked, it signs in.
// Anywhere else it hands the code to that browser, which signs itself in. Signing in here instead
// takes a click: email providers' link scanners open links and run the page, and one that signed
// itself in would use up the code before the person clicks.
import { useConvex, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { reloadInto, redeemEmailCode } from "../app/emailSignIn";
import { clearPending, type OpenedLink } from "../app/handoff";
import { navigate } from "../app/router";
import { Loading } from "../components/Spinner";

/** How long to wait for the asking page before saying it doesn't seem to be open. */
const WAIT_MS = 15_000;
/** Codes last an hour; stop checking then. */
const GIVE_UP_MS = 60 * 60 * 1000;

type State = "working" | "waiting" | "notOpen" | "elsewhere" | "failed";

export function SignInLink({ link, onDone }: { link: OpenedLink; onDone: () => void }) {
  const convex = useConvex();
  const approve = useMutation(api.signinHandoff.approve);
  const claim = useMutation(api.signinHandoff.claim);
  const [state, setState] = useState<State>("working");
  const started = useRef(false);
  /** Set once this device chose to sign in itself: stop waiting for the asking page. */
  const cancelled = useRef(false);

  /** This device signs in after all: takes the code back from the asking page. */
  async function takeHere() {
    cancelled.current = true;
    setState("working");
    try {
      const code = await claim({ pair: link.pair });
      if (code === null) return setState("elsewhere");
      await signInHere(code);
    } catch (err) {
      console.warn(err);
      setState("failed");
    }
  }

  const signInHere = async (code: string) => {
    if (!(await redeemEmailCode(code, link.email))) throw new Error("code not accepted");
    clearPending();
    reloadInto("/decks"); // App then goes on to wherever sign-in started
  };

  useEffect(() => {
    if (started.current) return; // Strict mode runs effects twice; the code works once.
    started.current = true;
    void (async () => {
      try {
        if (link.here) return await signInHere(link.code);
        await approve({ pair: link.pair, code: link.code });
        setState("waiting");
        // Wait for the asking page to take it. Never sign in here on our own (see top).
        const start = Date.now();
        while (!cancelled.current && Date.now() - start < GIVE_UP_MS) {
          await new Promise((r) => setTimeout(r, Date.now() - start < WAIT_MS ? 1000 : 3000));
          if (cancelled.current) return;
          if (!(await convex.query(api.signinHandoff.ready, { pair: link.pair }))) return setState("elsewhere");
          if (Date.now() - start >= WAIT_MS) setState((s) => (s === "waiting" ? "notOpen" : s));
        }
      } catch (err) {
        console.warn(err);
        setState("failed");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Sign in</h1>
        {state === "working" && <Loading text="Signing you in…" />}
        {(state === "waiting" || state === "notOpen") && (
          <>
            {state === "waiting" ? (
              <Loading text="Signing in on the device where you asked for the link…" />
            ) : (
              <p>The page where you asked for this link doesn't seem to be open. Reopen it to sign in there, or sign in here.</p>
            )}
            <button className="btn small" onClick={() => void takeHere()}>Sign in on this device</button>
          </>
        )}
        {state === "elsewhere" && (
          <>
            <p><strong>You're signed in</strong> on the device where you asked for the link. You can close this page.</p>
            <button className="btn ghost small" onClick={onDone}>Go to CommandQuest</button>
          </>
        )}
        {state === "failed" && (
          <>
            <p className="form-error" role="alert">This link has expired or was already used.</p>
            <button className="btn small" onClick={() => (onDone(), navigate("/signin", true))}>Get a new link</button>
          </>
        )}
      </div>
    </div>
  );
}
