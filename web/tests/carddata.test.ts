import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCardData, decode, encode, formatsOf, imagesFrom, lookupNames, SHARDS, shardOf, trimCard } from "../src/carddata.ts";
import type { ScryCard } from "../src/scryfall.ts";

const ID = "a471b306-4941-4e46-a0cb-d92895c16f8a";
const images = (side: string, id: string) => {
  const u = (size: string, ext = "jpg") => `https://cards.scryfall.io/${size}/${side}/${id[0]}/${id[1]}/${id}.${ext}?1783907750`;
  return { small: u("small"), normal: u("normal"), large: u("large"), png: u("png", "png"), art_crop: u("art_crop"), border_crop: u("border_crop"), thumb: u("thumb", "webp"), jpeg: u("normal") };
};

function card(over: Partial<ScryCard> = {}): ScryCard {
  return {
    id: ID,
    oracle_id: "0b1c",
    name: "Sol Ring",
    layout: "normal",
    mana_cost: "{1}",
    cmc: 1,
    type_line: "Artifact",
    oracle_text: "{T}: Add {C}{C}.",
    color_identity: [],
    colors: [],
    keywords: [],
    game_changer: true,
    set: "c21",
    set_name: "Commander 2021",
    collector_number: "263",
    rarity: "uncommon",
    artist: "Mike Bierek",
    released_at: "2021-04-23",
    scryfall_uri: `https://scryfall.com/card/c21/263/sol-ring?utm_source=api`,
    legalities: { commander: "legal", vintage: "restricted", legacy: "banned", standard: "not_legal" },
    image_uris: images("front", ID) as ScryCard["image_uris"],
    all_parts: [{ id: ID, component: "combo_piece", name: "Sol Ring" }],
    ...over,
  } as ScryCard;
}

const dfc = () =>
  card({
    id: "6b7baaa7-67f2-4902-a4c1-761d58cce1d4",
    name: "Delver of Secrets // Insectile Aberration",
    layout: "transform",
    image_uris: undefined,
    card_faces: [
      { name: "Delver of Secrets", mana_cost: "{U}", type_line: "Creature — Human Wizard", image_uris: images("front", "6b7baaa7-67f2-4902-a4c1-761d58cce1d4") as ScryCard["image_uris"] },
      { name: "Insectile Aberration", type_line: "Creature — Human Insect", image_uris: images("back", "6b7baaa7-67f2-4902-a4c1-761d58cce1d4") as ScryCard["image_uris"] },
    ],
  });

test("a stored card comes back as exactly the trimmed card", () => {
  for (const c of [card(), dfc()]) {
    const t = trimCard(c);
    const formats = formatsOf([t]);
    const stored = encode(t, formats);
    assert.equal(stored.image_uris, undefined, "images shortened to a path");
    assert.equal(stored.scryfall_uri, undefined, "link shortened");
    assert.deepEqual(decode(JSON.parse(JSON.stringify(stored)), formats), t);
  }
});

test("trimming keeps only the image sizes we show", () => {
  assert.deepEqual(Object.keys(trimCard(card()).image_uris!).sort(), ["art_crop", "border_crop", "large", "normal", "png", "small"]);
  assert.deepEqual(Object.keys(trimCard(dfc()).card_faces![1].image_uris!).sort(), ["art_crop", "border_crop", "large", "normal", "png", "small"]);
});

test("images and links that don't follow the usual pattern are kept whole", () => {
  const odd = trimCard(card({ image_uris: { ...images("front", ID), small: "https://example.com/x.jpg" } as ScryCard["image_uris"], scryfall_uri: "https://scryfall.com/card/c21/263" }));
  const formats = formatsOf([odd]);
  const stored = encode(odd, formats);
  assert.ok(stored.image_uris);
  assert.equal(stored.scryfall_uri, "https://scryfall.com/card/c21/263");
  assert.deepEqual(decode(stored, formats), odd);
});

test("an image path gives every size", () => {
  const u = imagesFrom(`front/a/4/${ID}.jpg?1783907750`);
  assert.equal(u.png, `https://cards.scryfall.io/png/front/a/4/${ID}.png?1783907750`);
  assert.equal(u.art_crop, `https://cards.scryfall.io/art_crop/front/a/4/${ID}.jpg?1783907750`);
});

test("shards: three hex digits, the same for any capitalization", () => {
  assert.match(shardOf("Sol Ring"), /^[0-9a-f]{3}$/);
  assert.equal(shardOf("Sol Ring"), shardOf("sol ring"));
  const used = new Set(Array.from({ length: 20_000 }, (_, i) => shardOf(`Card ${i}`)));
  assert.ok(used.size > SHARDS * 0.95, `names spread over the shards (${used.size})`);
});

test("a card is in the shard of its full name and its front face's", () => {
  const { manifest, shards } = buildCardData([card(), dfc(), card({ id: "t", name: "Soldier", layout: "token", type_line: "Token Creature — Soldier" })], "tag");
  assert.equal(manifest.tag, "tag");
  assert.equal(shards.size, SHARDS, "every shard, empty or not");
  assert.deepEqual(lookupNames(dfc()), ["delver of secrets // insectile aberration", "delver of secrets"]);
  for (const n of ["Delver of Secrets // Insectile Aberration", "Delver of Secrets", "Sol Ring"]) {
    assert.ok(shards.get(shardOf(n))!.some((c) => lookupNames(c).includes(n.toLowerCase())), n);
  }
  assert.ok(![...shards.values()].flat().some((c) => c.name === "Soldier"), "no tokens");
  const sol = shards.get(shardOf("Sol Ring"))!.find((c) => c.name === "Sol Ring")!;
  assert.deepEqual(decode(sol, manifest.formats).legalities, card().legalities);
});
