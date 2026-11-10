import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { DeckError, MAX_DECKS_PER_USER, summarize, validateDeck, type DeckInput } from "./model/deckRules";
import { deckCard } from "./schema";

// Every function is scoped to the signed-in user: nobody can read or change another user's decks.

async function requireUser(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  return userId;
}

function checked(input: DeckInput) {
  try {
    return validateDeck(input);
  } catch (e) {
    if (e instanceof DeckError) throw new ConvexError(e.message);
    throw e;
  }
}

const deckArgs = { name: v.string(), format: v.optional(v.string()), cards: v.array(deckCard) };

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const decks = await ctx.db
      .query("decks")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_DECKS_PER_USER);
    return decks.map((d) => ({ _id: d._id, name: d.name, format: d.format, updatedAt: d.updatedAt, ...summarize(d.cards) }));
  },
});

/** One of your decks, or null (not found, someone else's, or signed out). */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const deckId = ctx.db.normalizeId("decks", id);
    const deck = userId && deckId ? await ctx.db.get(deckId) : null;
    return deck && deck.userId === userId ? deck : null;
  },
});

export const create = mutation({
  args: deckArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const deck = checked(args);
    const count = (await ctx.db.query("decks").withIndex("by_user_updated", (q) => q.eq("userId", userId)).take(MAX_DECKS_PER_USER)).length;
    if (count >= MAX_DECKS_PER_USER) throw new ConvexError(`You can save up to ${MAX_DECKS_PER_USER} decks.`);
    return await ctx.db.insert("decks", { userId, ...deck, updatedAt: Date.now() });
  },
});

export const update = mutation({
  args: { id: v.id("decks"), ...deckArgs },
  handler: async (ctx, { id, ...args }) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.userId !== userId) throw new ConvexError("Deck not found.");
    await ctx.db.patch(id, { ...checked(args), updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("decks") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.userId !== userId) throw new ConvexError("Deck not found.");
    await ctx.db.delete(id);
  },
});
