// Whether this tab is in the middle of something a reload would interrupt (a live game). Staging's
// automatic reload on a new deploy (UpdateNotice) waits until it isn't.

let busy = false;
const listeners = new Set<() => void>();

export function setGameInProgress(value: boolean) {
  if (busy === value) return;
  busy = value;
  for (const l of [...listeners]) l();
}

export function gameInProgress(): boolean {
  return busy;
}

/** Calls `fn` whenever the busy flag changes; returns the unsubscribe. */
export function onBusyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
