// Redeeming an email sign-in code (from the link, or typed). Convex Auth's own signIn() sends it
// over the WebSocket, and if the socket reconnects while that's in flight (a network blip, a
// background tab's socket timing out) the client reports "Connection lost while action was in
// flight" though the server already signed in. The code works once, so it's spent and this
// browser never gets the session. A plain HTTPS request can't be dropped that way.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { authStorageKeys } from "./authStorage";
import { setItemMakingRoom } from "./storageRoom";

/**
 * Signs this browser in with an email code: true once the session is saved. The caller then
 * reloads (`reloadInto`), since ConvexAuthProvider reads the saved session on load. Other tabs
 * pick it up straight away (it listens for storage changes).
 */
export async function redeemEmailCode(code: string, email: string): Promise<boolean> {
  const url: string = import.meta.env.VITE_CONVEX_URL;
  let result: { tokens?: { token: string; refreshToken: string } | null } | null;
  try {
    result = await new ConvexHttpClient(url).action(api.auth.signIn, { provider: "resend", params: { code, email } });
  } catch (err) {
    console.warn(err); // "Could not verify code": wrong, expired or already used
    return false;
  }
  const tokens = result?.tokens;
  if (!tokens) return false;
  const keys = authStorageKeys(url);
  setItemMakingRoom(localStorage, keys.jwt, tokens.token);
  setItemMakingRoom(localStorage, keys.refreshToken, tokens.refreshToken);
  return true;
}

/** Loads the app afresh at `path` (a router path like /decks), signed in with the saved session. */
export function reloadInto(path: string) {
  // Not location.replace: from /#/signin only the hash would change, which doesn't reload.
  history.replaceState(null, "", "/#" + path);
  location.reload();
}
