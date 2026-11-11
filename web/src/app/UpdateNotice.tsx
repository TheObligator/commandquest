import { useEffect, useState } from "react";
import { isNewBuild } from "../version";

/** How often an open tab checks for a new deploy, besides whenever it comes back into view. */
const POLL_MS = 60_000;

/**
 * Notices when the site has been redeployed since this tab loaded. Staging reloads itself straight
 * away so testers always run the latest build; production asks first, so nobody loses what they
 * were doing. Off in dev, where Vite reloads the page itself.
 */
export function UpdateNotice() {
  const [updated, setUpdated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD || updated) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (stopped || !res.ok || !isNewBuild(__BUILD_ID__, await res.text())) return;
      } catch {
        return; // Offline or mid-deploy: try again next time.
      }
      if (import.meta.env.MODE === "staging") location.reload();
      else setUpdated(true);
    };
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [updated]);

  if (!updated || dismissed) return null;
  return (
    <div className="update-notice" role="status">
      <span>CommandQuest has been updated. Refresh to get the latest version.</span>
      <button className="btn small" onClick={() => location.reload()}>Refresh</button>
      <button className="btn ghost small" onClick={() => setDismissed(true)} aria-label="Dismiss">Later</button>
    </div>
  );
}
