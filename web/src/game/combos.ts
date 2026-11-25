// Your combos in a live game (docs/combos.md), as the game server keeps them (forge-web-server Combos).

export interface Combo {
  id: number;
  name: string;
  /** What was recorded, in words. */
  steps: string[];
  /** What one time round changes ("+1 {C}", "−1 life"). */
  gains: string[];
  /** It ends where it started, so it can be repeated. */
  loops: boolean;
}

export interface CombosView {
  /** The steps recorded so far, while recording. */
  recording?: string[];
  /** The run going on; no `times`: until you stop it. */
  running?: { id: number; loop: number; times?: number };
  list: Combo[];
}

export const MAX_LOOPS = 1000;

/** What you type for how often, as a number of loops; null when it isn't one. */
export function parseTimes(s: string): number | null {
  if (!/^\d{1,5}$/.test(s.trim())) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_LOOPS ? n : null;
}

/** "+1 {C}, +1 life" for the list. */
export function gainsText(c: Combo): string {
  return c.gains.length ? c.gains.join(", ") : "changes nothing";
}

/** Repeated steps in a row shown once with a count. */
export function groupSteps(steps: string[]): { text: string; n: number }[] {
  const out: { text: string; n: number }[] = [];
  for (const text of steps) {
    const last = out.at(-1);
    if (last?.text === text) last.n++;
    else out.push({ text, n: 1 });
  }
  return out;
}

/** The combo that just appeared (recorded), so its window opens. */
export function newCombo(before: Combo[], now: Combo[]): Combo | undefined {
  const had = new Set(before.map((c) => c.id));
  return now.find((c) => !had.has(c.id));
}
