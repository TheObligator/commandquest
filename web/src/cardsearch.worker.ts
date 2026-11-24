// Runs the card-name search (cardsearch.ts) off the main thread. Talks only to localsearch.ts.
import { CARD_NAMES_VERSION, CardSearch, cardAt, plainFits, type CardNamesData, type IdentityRules, type NameResults } from "./cardsearch";
import { fitsIdentity } from "./formats/conquest";
import { offIdentity } from "./formats/rulebreakers";

export type ToWorker = { id: number; text: string; identity?: IdentityRules };
export type FromWorker = { ready: boolean } | { id: number; results: NameResults };

const send = (m: FromWorker) => self.postMessage(m);

async function load() {
  const res = await fetch("/card-names.json");
  if (!res.ok) throw new Error(`card-names.json: ${res.status}`);
  const data = (await res.json()) as CardNamesData; // not JSON when there's no file (Vite's dev server answers with index.html)
  if (data.version !== CARD_NAMES_VERSION) throw new Error("card-names.json is from another version of the site");
  return { data, search: new CardSearch(data.names) };
}

// The cards the last deck's commanders allow: worked out once, then every key press reuses it.
let allowedKey: string | undefined;
let allowed: Uint8Array | undefined;

function allowedBy(data: CardNamesData, identity?: IdentityRules): Uint8Array | undefined {
  if (!identity) return undefined;
  const key = JSON.stringify(identity);
  if (key !== allowedKey) {
    const fits = identity.conquest ? fitsIdentity : plainFits;
    allowed = Uint8Array.from(data.names, (name, i) => (offIdentity([{ name, card: cardAt(data, i) }], identity.commanders, fits, identity.extraColor).length ? 0 : 1));
    allowedKey = key;
  }
  return allowed;
}

const loaded = load();
loaded.then(
  () => send({ ready: true }),
  () => send({ ready: false }),
);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const { data, search } = await loaded;
  const { id, text, identity } = e.data;
  send({ id, results: search.search(text, 8, allowedBy(data, identity)) });
};
