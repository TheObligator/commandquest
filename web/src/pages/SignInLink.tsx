// The page a sign-in email's link opens (app/handoff.ts). In the browser that asked, it signs in.
// Anywhere else it hands the code to that browser, which signs itself in; if nobody takes it
// (that page was closed), it signs in here instead.
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { clearPending, type OpenedLink } from "../app/handoff";
import { navigate } from "../app/router";
import { Loading } from "../components/Spinner";

/** How long the asking page gets to take the code before this device signs in itself. */
const WAIT_MS = 15_000;

type State = "working" | "elsewhere" | "here" | "failed";

export function SignInLink({ link, onDone }: { link: OpenedLink; onDone: () => void }) {
  const { signIn } = useAuthActions();
  const convex = useConvex();
  const approve = useMutation(api.signinHandoff.approve);
  const claim = useMutation(api.signinHandoff.claim);
  const [state, setState] = useState<State>("working");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // Strict mode runs effects twice; the code works once.
    started.current = true;
    const signInHere = async (code: string) => {
      const r = await signIn("resend", { code, email: link.email });
      if (!r.signingIn) throw new Error("code not accepted");
      clearPending();
      setState("here");
      onDone();
      navigate("/decks", true);
    };
    void (async () => {
      try {
        if (link.here) return await signInHere(link.code);
        await approve({ pair: link.pair, code: link.code });
        // Wait for the asking page to take it; if it doesn't, take it back and sign in here.
        const end = Date.now() + WAIT_MS;
        while (Date.now() < end) {
          await new Promise((r) => setTimeout(r, 1000));
          if (!(await convex.query(api.signinHandoff.ready, { pair: link.pair }))) return setState("elsewhere");
        }
        const code = await claim({ pair: link.pair });
        if (code === null) return setState("elsewhere");
        await signInHere(code);
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
