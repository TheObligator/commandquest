// Usernames: the name other players see in games (instead of your email address). Pure (no Convex
// imports), so the Convex mutation, the Settings page and `node --test` all share it.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** The game server caps player names at this many characters (forge-web-server). */
const GAME_NAME_MAX = 40;

const ALLOWED = /^[A-Za-z0-9_ -]+$/;

export type UsernameCheck = { ok: true; username: string; key: string } | { ok: false; error: string };

/**
 * Validates a username. Leading and trailing spaces are dropped and runs of spaces become one.
 * `key` is the lower-cased form used to keep usernames unique regardless of case.
 */
export function checkUsername(input: string): UsernameCheck {
  const username = input.trim().replace(/ {2,}/g, " ");
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return { ok: false, error: `Usernames are ${USERNAME_MIN}–${USERNAME_MAX} characters.` };
  }
  if (!ALLOWED.test(username)) {
    return { ok: false, error: "Use only letters, numbers, spaces, hyphens and underscores." };
  }
  if (/^ai /i.test(username)) {
    return { ok: false, error: "Usernames can't start with “AI ” (that's how computer players are named)." };
  }
  return { ok: true, username, key: usernameKey(username) };
}

/** The case-insensitive form a username is unique by. */
export function usernameKey(username: string): string {
  return username.toLowerCase();
}

/**
 * The name shown for a user in games and the header: their username, else the name from their
 * sign-in provider, else "Player". Never the email address. Provider names are clipped to what
 * the game server accepts.
 */
export function displayName(user: { username?: string; name?: string }): string {
  if (user.username) return user.username;
  const name = user.name?.trim().slice(0, GAME_NAME_MAX).trim();
  if (!name || /^ai /i.test(name)) return "Player";
  return name;
}
