// A deck's changelog: each entry is one sitting's edits (convex/model/changelog.ts). Recorded by the
// server on every save, so it doesn't depend on the editor saying when you leave.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { DeckCard } from "./model/deckRules";
import { cardDiff, continues, fieldChanges, MAX_CHANGE_ENTRIES, mergeCards, mergeFields, type Tracked } from "./model/changelog";
import { sharedDeck } from "./sharing";

type Version = Tracked & { cards: DeckCard[] };

/**
 * Records an edit to a deck: `before` → `after` (`before` null: the deck was just made). It goes into
 * the deck's latest entry if that was edited within the hour, else starts a new one.
 */
export async function recordChange(ctx: MutationCtx, deckId: Id<"decks">, before: Version | null, after: Version, now: number) {
  if (!before) {
    await ctx.db.insert("deckChanges", { deckId, startedAt: now, at: now, cards: cardDiff([], after.cards), created: true });
    return;
  }
  const cards = cardDiff(before.cards, after.cards);
  const fields = fieldChanges(before, after);
  if (!cards.length && !fields.length) return;
  const last = await ctx.db.query("deckChanges").withIndex("by_deck_at", (q) => q.eq("deckId", deckId)).order("desc").first();
  if (last && continues(last.at, now)) {
    const merged = last.created ? undefined : mergeFields(last.fields ?? [], fields);
    await ctx.db.patch(last._id, { at: now, cards: mergeCards(last.cards, cards), fields: merged?.length ? merged : undefined });
    return;
  }
  await ctx.db.insert("deckChanges", { deckId, startedAt: now, at: now, cards, ...(fields.length ? { fields } : {}) });
  const old = await ctx.db.query("deckChanges").withIndex("by_deck_at", (q) => q.eq("deckId", deckId)).order("desc").collect();
  for (const e of old.slice(MAX_CHANGE_ENTRIES)) await ctx.db.delete(e._id);
}

/** Deletes a deck's changelog (the deck is gone). */
export async function purgeChanges(ctx: MutationCtx, deckId: Id<"decks">) {
  for (const e of await ctx.db.query("deckChanges").withIndex("by_deck_at", (q) => q.eq("deckId", deckId)).collect()) await ctx.db.delete(e._id);
}

const entries = (rows: Doc<"deckChanges">[]) =>
  rows.map((e) => ({ id: e._id, startedAt: e.startedAt, at: e.at, cards: e.cards, fields: e.fields ?? [], created: !!e.created }));

/** A deck's changelog, newest first: by share key (anyone who can see the deck), or one of your decks by id. */
export const forDeck = query({
  args: { key: v.optional(v.string()), id: v.optional(v.string()) },
  handler: async (ctx, { key, id }) => {
    let deckId: Id<"decks"> | null = null;
    if (key) deckId = (await sharedDeck(ctx, key))?.deck._id ?? null;
    else if (id) {
      const userId = await getAuthUserId(ctx);
      const norm = ctx.db.normalizeId("decks", id);
      const deck = norm && userId ? await ctx.db.get(norm) : null;
      deckId = deck && deck.userId === userId ? deck._id : null;
    }
    if (!deckId) return null;
    const rows = await ctx.db.query("deckChanges").withIndex("by_deck_at", (q) => q.eq("deckId", deckId)).order("desc").take(MAX_CHANGE_ENTRIES);
    return entries(rows);
  },
});
