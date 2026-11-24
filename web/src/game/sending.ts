// What you've pressed that the game server hasn't answered yet. A prompt's button does nothing more
// until the server has dealt with the first press (pressing OK twice could pass twice), shows that
// it's waiting if that takes a moment, and works again if no answer ever comes.

/** After this long a pressed button shows that it's waiting; most answers come sooner. */
export const SHOW_MS = 300;
/** After this long it says that the game server is slow. */
export const STILL_MS = 5000;
/** After this long without an answer you can press it again. */
export const GIVE_UP_MS = 10_000;

export interface Sent {
  /** Which button: "ok", "cancel", "payFree"… */
  what: string;
  /** It's been a good while. */
  slow: boolean;
}

/** Messages that answer a press. State updates come at any time, so for a prompt's buttons they don't count. */
const ANSWERS = new Set(["prompt", "waiting", "ask", "over", "notice", "error", "hello", "replaced"]);

export interface Clock {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}
const browser: Clock = { set: (fn, ms) => setTimeout(fn, ms) as unknown as number, clear: (id) => clearTimeout(id) };

export class Sending {
  private what: string | null = null;
  private byState = false;
  private timers: number[] = [];
  private shown: Sent | null = null;
  private readonly onShow: (s: Sent | null) => void;
  private readonly onGiveUp: (what: string) => void;
  private readonly clock: Clock;

  /** `onShow`: what to show as waiting (null: nothing). `onGiveUp`: no answer came. */
  constructor(onShow: (s: Sent | null) => void, onGiveUp: (what: string) => void, clock: Clock = browser) {
    this.onShow = onShow;
    this.onGiveUp = onGiveUp;
    this.clock = clock;
  }

  /** Is the server still dealing with a press? */
  get busy(): boolean {
    return this.what !== null;
  }

  /** You pressed this. `byState`: a state update answers it too (a question's answer, a rewind). */
  begin(what: string, byState = false) {
    this.clear();
    this.what = what;
    this.byState = byState;
    this.timers = [
      this.clock.set(() => this.show({ what, slow: false }), SHOW_MS),
      this.clock.set(() => this.show({ what, slow: true }), STILL_MS),
      this.clock.set(() => {
        this.clear();
        this.onGiveUp(what);
      }, GIVE_UP_MS),
    ];
  }

  /** A message of this type came from the server. */
  heard(type: string) {
    if (this.what === null) return;
    if (ANSWERS.has(type) || (this.byState && (type === "state" || type === "shown"))) this.clear();
  }

  /** Nothing to wait for any more (answered, or the connection went). */
  clear() {
    this.timers.forEach((t) => this.clock.clear(t));
    this.timers = [];
    this.what = null;
    this.show(null);
  }

  private show(s: Sent | null) {
    if (this.shown === null && s === null) return;
    this.shown = s;
    this.onShow(s);
  }
}
