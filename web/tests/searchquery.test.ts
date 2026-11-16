// Deck search helpers: saved search additions (src/searchquery.ts) and EDHREC commander pages (src/edhrec.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { commanderSlug, parsePage } from "../src/edhrec.ts";
import { displayTerms, forEdhrecCards, hasOrder, joinQuery, locallyReadable, stripDisplay } from "../src/searchquery.ts";

test("display keywords split from the filters", () => {
  assert.equal(stripDisplay("game:paper order:cmc dir:desc"), "game:paper");
  assert.equal(displayTerms("game:paper order:cmc dir:desc"), "order:cmc dir:desc");
  assert.equal(stripDisplay('o:"draw a card" unique:prints'), 'o:"draw a card"');
  assert.equal(hasOrder("t:elf order:name"), true);
  assert.equal(hasOrder("t:elf prefer:newest"), false);
});

test("joinQuery wraps each multi-term part and drops empty ones", () => {
  assert.equal(joinQuery("t:dragon or t:angel", "", "game:paper"), "(t:dragon or t:angel) game:paper");
  assert.equal(joinQuery("sol ring"), "sol ring");
  assert.equal(joinQuery("bolt", "id<=r"), "bolt id<=r");
});

test("EDHREC's cards all pass paper/Commander pool filters, so those are skipped locally", () => {
  assert.equal(forEdhrecCards("game:paper -is:digital f:commander order:cmc"), "");
  assert.equal(forEdhrecCards("t:elf game:paper"), "t:elf");
});

test("only queries the local matcher reads exactly are run locally", () => {
  assert.equal(locallyReadable("t:creature pow>=4 o:draw"), true);
  assert.equal(locallyReadable('!"Sol Ring"'), true);
  assert.equal(locallyReadable("lightning bolt"), true);
  assert.equal(locallyReadable("is:legendary -is:creature id<=wu"), true);
  assert.equal(locallyReadable("t:elf order:name"), true);
  assert.equal(locallyReadable("set:dmu"), false);
  assert.equal(locallyReadable("is:fetchland"), false);
  assert.equal(locallyReadable("(t:land or f:modern)"), false);
});

test("EDHREC page names", () => {
  assert.equal(commanderSlug(["Whtz, the Bibliophile"]), "whtz-the-bibliophile");
  assert.equal(commanderSlug(["Atraxa, Praetors' Voice"]), "atraxa-praetors-voice");
  assert.equal(commanderSlug(["Tymna the Weaver", "Kraum, Ludevic's Opus"]), "kraum-ludevics-opus-tymna-the-weaver");
  assert.equal(commanderSlug(["Ratadrabik of Urborg"]), "ratadrabik-of-urborg");
  assert.equal(commanderSlug(["Lim-Dûl the Necromancer"]), "lim-dul-the-necromancer");
});

test("an EDHREC page becomes cards by share of decks, each once", () => {
  const view = (name: string, num_decks: number, potential_decks: number) => ({ name, id: `${name}-id`, num_decks, potential_decks });
  const page = {
    container: {
      json_dict: {
        cardlists: [
          { cardviews: [view("Sol Ring", 900, 1000), view("Rhystic Study", 400, 1000)] },
          { cardviews: [view("Counterspell", 600, 1000), view("Sol Ring", 900, 1000), { name: "No data", id: "x" }] },
        ],
      },
    },
  };
  assert.deepEqual(parsePage(page).map((c) => [c.name, c.inclusion]), [["Sol Ring", 0.9], ["Counterspell", 0.6], ["Rhystic Study", 0.4]]);
  assert.deepEqual(parsePage({}), []);
});
