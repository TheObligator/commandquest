import { Component, type ReactNode } from "react";
import { isNewBuild } from "../version";

/** When a page last reloaded itself to recover. index.html's script uses the same key. */
const RELOAD_KEY = "cq-auto-reload";
const RELOAD_GAP_MS = 30_000;

/** Reloads, unless the page just did that (so a problem reloading can't fix doesn't loop). */
function reloadOnce() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY)) < RELOAD_GAP_MS) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return; // No storage, so no way to tell: leave it to the Refresh button.
  }
  location.reload();
}

/**
 * Shown instead of a blank page when rendering throws. The usual cause is a tab running an older
 * build than the backend it talks to, so if the site has been redeployed it reloads by itself.
 */
export class CrashScreen extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  async componentDidCatch() {
    if (!import.meta.env.PROD) return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok && isNewBuild(__BUILD_ID__, await res.text())) reloadOnce();
    } catch {
      // Offline or mid-deploy: the Refresh button is there.
    }
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="empty" role="alert">
        <p>Something went wrong on this page.</p>
        <button className="btn" onClick={() => location.reload()}>Refresh</button>{" "}
        <button className="btn ghost" onClick={() => { location.hash = "#/"; location.reload(); }}>Home page</button>
      </div>
    );
  }
}
