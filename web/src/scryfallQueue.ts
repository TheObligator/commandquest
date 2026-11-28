// The schedule every Scryfall API request waits its turn in (src/scryfall.ts), shared by every tab
// of the site on this device.
//
// Scryfall counts requests per IP address, so the limits are shared by every open tab: the lobby, a
// deck in the editor and a game each running their own queue at the full rate went over it together.
// The schedule (when the next request may start, and any pause) lives in localStorage, and tabs take
// turns updating it under a Web Lock, so one tab's 429 pauses them all.
//
// A blocked request often doesn't even show up as a 429: without CORS headers on the reply, the
// browser reports a network error. Both count as a strike: everything pauses, longer with each
// strike in a row (30 s, 1 min, 2 min, then 4 min), until a request gets through.
//
// No DOM: the storage, lock and clock are passed in, so `node --test` can run it as several "tabs".

export const QUEUE_KEY = "cq.scryfall.queue";

export interface QueueState {
  /** No request starts before this (ms since the epoch). */
  any: number;
  /** No request to a slow endpoint (2 per second) starts before this. */
  slow: number;
  /** Everything waits until this, after a strike. */
  paused: number;
  /** Strikes in a row: 429s or failed requests since the last one that worked. */
  strikes: number;
}

export interface QueueEnv {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Shared between tabs (localStorage). Missing or throwing: this tab keeps its own schedule. */
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** Runs `fn` while no other tab is in its own `lock` (navigator.locks). Missing: no lock. */
  lock?: <T>(fn: () => T) => Promise<T>;
}

export const GAPS = {
  /** Between any two requests (10 per second, with a little room). */
  fast: 110,
  /** Between requests to the slow endpoints (2 per second, with a little room). */
  slow: 520,
  /** The first strike's pause; each one after doubles it, up to `maxBackoff`. */
  backoff: 30_000,
  maxBackoff: 240_000,
  /** A pause this long over is old news: the strikes before it no longer count. */
  forget: 10 * 60_000,
};

export interface Queue {
  /** Waits for this tab's turn (behind every tab's requests and any pause), then runs `fn`. */
  run<T>(slow: boolean, fn: () => Promise<T>): Promise<T>;
  /** A 429 or a request that couldn't get through: pause everything. Returns the pause in ms. */
  strike(): Promise<number>;
  /** A request got through: the next strike starts from the shortest pause again. */
  ok(): void;
  /** How long until requests may go again, in ms; 0 when they may. */
  pauseLeft(): number;
}

export function createQueue(env: QueueEnv, gaps = GAPS): Queue {
  let local: QueueState = { any: 0, slow: 0, paused: 0, strikes: 0 };

  const read = (): QueueState => {
    try {
      const raw = env.storage?.getItem(QUEUE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<QueueState>;
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        // The latest of each time: this tab's own may be ahead if its last write didn't stick.
        local = {
          any: Math.max(local.any, num(s.any)),
          slow: Math.max(local.slow, num(s.slow)),
          paused: Math.max(local.paused, num(s.paused)),
          strikes: num(s.strikes),
        };
      }
    } catch {
      // Blocked or corrupt: this tab's own schedule.
    }
    return local;
  };
  const write = (s: QueueState) => {
    local = s;
    try {
      env.storage?.setItem(QUEUE_KEY, JSON.stringify(s));
    } catch {
      // Over quota or blocked: other tabs won't see it, this one still follows it.
    }
  };
  const locked = <T>(fn: () => T): Promise<T> => {
    if (!env.lock) return Promise.resolve(fn());
    return env.lock(fn).catch(() => fn()); // the lock failing is no reason to drop the request
  };

  const reserve = (slow: boolean) =>
    locked(() => {
      const s = { ...read() };
      const at = Math.max(env.now(), s.any, s.paused, slow ? s.slow : 0);
      s.any = at + gaps.fast;
      if (slow) s.slow = at + gaps.slow;
      write(s);
      return at;
    });

  return {
    async run(slow, fn) {
      for (;;) {
        const at = await reserve(slow);
        const wait = at - env.now();
        if (wait > 0) await env.sleep(wait);
        // A strike while this one waited: back in line, behind the pause.
        if (env.now() >= read().paused) return fn();
      }
    },
    strike: () =>
      locked(() => {
        const s = { ...read() };
        const now = env.now();
        if (now - s.paused > gaps.forget) s.strikes = 0;
        // Several requests failing together are one strike, not one each.
        if (s.paused > now) return s.paused - now;
        s.strikes++;
        const pause = Math.min(gaps.backoff * 2 ** (s.strikes - 1), gaps.maxBackoff);
        s.paused = now + pause;
        write(s);
        return pause;
      }),
    ok() {
      if (!read().strikes) return;
      void locked(() => write({ ...read(), strikes: 0 }));
    },
    pauseLeft: () => Math.max(0, read().paused - env.now()),
  };
}
