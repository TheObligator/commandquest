import assert from "node:assert/strict";
import { test } from "node:test";
import { DeckError } from "../convex/model/deckRules.ts";
import { cleanDescription, cleanHref, MAX_DESCRIPTION_TEXT, parseDescription } from "../convex/model/richText.ts";

const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });

test("keeps what the editor makes", () => {
  const input = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
      p(text("Win with "), { type: "card", attrs: { id: "Craterhoof Behemoth", label: "Craterhoof Behemoth", mentionSuggestionChar: "[[" } }, text("."), { type: "hardBreak" }, text("Bold", [{ type: "bold" }])),
      { type: "bulletList", content: [{ type: "listItem", content: [p(text("one"))] }] },
      { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [p(text("two"))] }] },
      p(text("site", [{ type: "link", attrs: { href: "https://example.com/x", target: "_blank", rel: "noopener", class: null } }])),
    ],
  };
  const out = JSON.parse(cleanDescription(JSON.stringify(input))!);
  assert.deepEqual(out.content[1].content[1], { type: "card", attrs: { id: "Craterhoof Behemoth" } });
  assert.deepEqual(out.content[3].attrs, { start: 3 });
  assert.deepEqual(out.content[4].content[0].marks, [{ type: "link", attrs: { href: "https://example.com/x" } }]);
  assert.equal(out.content.length, 5);
});

test("drops unsafe links, unknown nodes and marks", () => {
  const out = JSON.parse(cleanDescription(doc(
    p(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "textStyle", attrs: { color: "red" } }])),
    { type: "codeBlock", content: [text("rm -rf")] },
    { type: "image", attrs: { src: "https://evil.example/x.png" } },
    p({ type: "iframe" }, text("y", [{ type: "italic" }, { type: "italic" }])),
  ))!);
  assert.deepEqual(out, { type: "doc", content: [p(text("x")), p(text("y", [{ type: "italic" }]))] });
});

test("links: http(s) only, a bare domain gets https", () => {
  assert.equal(cleanHref("example.com/deck"), "https://example.com/deck");
  assert.equal(cleanHref("http://moxfield.com"), "http://moxfield.com/");
  assert.equal(cleanHref("data:text/html,hi"), undefined);
  assert.equal(cleanHref("JavaScript:alert(1)"), undefined);
  assert.equal(cleanHref("localhost"), undefined);
});

test("nothing written is no description", () => {
  assert.equal(cleanDescription(undefined), undefined);
  assert.equal(cleanDescription(doc(p(), p(text("   ")))), undefined);
  assert.equal(cleanDescription(doc()), undefined);
});

test("empty paragraphs at the end are trimmed; list items start with a paragraph", () => {
  const out = parseDescription(doc(p(text("a")), p(), { type: "bulletList", content: [{ type: "listItem", content: [{ type: "bulletList", content: [{ type: "listItem", content: [p(text("b"))] }] }] }] }, p(), p()));
  assert.equal(out!.content.length, 3);
  assert.deepEqual((out!.content[2] as { content: { content: unknown[] }[] }).content[0].content[0], { type: "paragraph" });
});

test("too long, too deep, or not a document is refused", () => {
  assert.throws(() => cleanDescription(doc(p(text("x".repeat(MAX_DESCRIPTION_TEXT + 1))))), DeckError);
  assert.doesNotThrow(() => cleanDescription(doc(p(text("x".repeat(MAX_DESCRIPTION_TEXT))))));
  let list: unknown = p(text("deep"));
  for (let i = 0; i < 12; i++) list = { type: "bulletList", content: [{ type: "listItem", content: [list] }] };
  assert.throws(() => cleanDescription(doc(list)), DeckError);
  assert.throws(() => cleanDescription("{"), DeckError);
  assert.throws(() => cleanDescription(JSON.stringify({ type: "paragraph" })), DeckError);
});

test("control and bidi-override characters are removed", () => {
  const out = JSON.parse(cleanDescription(doc(p(text("a‮b\u0000c\nd"))))!);
  assert.equal(out.content[0].content[0].text, "abc d");
});
