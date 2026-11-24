// The editor's way to the local card-name search: starts the worker (cardsearch.worker.ts) the first
// time a search box is shown, and asks it. Until its names are loaded, and if they can't be, callers
// ask Scryfall instead.
import type { IdentityRules, NameResults } from "./cardsearch";
import type { FromWorker, ToWorker } from "./cardsearch.worker";

let worker: Worker | undefined;
let ready = false;
let failed = false;
let nextId = 1;
const waiting = new Map<number, { done: (r: NameResults) => void; fail: (e: Error) => void }>();

function giveUp() {
  failed = true;
  ready = false;
  worker?.terminate();
  worker = undefined;
  for (const w of waiting.values()) w.fail(new Error("Card-name search isn't available."));
  waiting.clear();
}

/** Load the names now, so they're there by the time someone types. */
export function startLocalSearch() {
  if (worker || failed) return;
  try {
    worker = new Worker(new URL("./cardsearch.worker.ts", import.meta.url), { type: "module" });
  } catch {
    failed = true;
    return;
  }
  worker.onerror = giveUp;
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if ("ready" in m) {
      if (m.ready) ready = true;
      else giveUp();
      return;
    }
    waiting.get(m.id)?.done(m.results);
    waiting.delete(m.id);
  };
}

/** Names for what's typed, from the local list; undefined when it isn't loaded (ask Scryfall). */
export function localNames(text: string, identity?: IdentityRules): Promise<NameResults> | undefined {
  if (!ready || !worker) return undefined;
  const id = nextId++;
  const message: ToWorker = { id, text, identity };
  worker.postMessage(message);
  return new Promise((done, fail) => waiting.set(id, { done, fail }));
}
