import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { checkBracket, colorCards, DeckError, MAX_DECKS_PER_USER, summarize, validateDeck, type DeckInput } from "./model/deckRules";
import { CARD_LIST } from "../src/deckFormats";
import { DEFAULT_GROUPING, isGroupBy } from "../src/deckGroups";
import { withSaved } from "../src/game/abilities";
import { deckCard } from "./schema";

// Every function is scoped to the signed-in user: nobody can read or change another user's decks.

async function requireUser(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  return userId;
}

/** Runs a check, passing a DeckError's message on to the player. */
function rules<T>(check: () => T): T {
  try {
    return check();
  } catch (e) {
    if (e instanceof DeckError) throw new ConvexError(e.message);
    throw e;
  }
}

const checked = (input: DeckInput) => rules(() => validateDeck(input));

const deckArgs = {
  name: v.string(),
  format: v.optional(v.string()),
  cards: v.array(deckCard),
  extraColor: v.optional(v.string()),
  bracket: v.optional(v.number()),
  bracketTags: v.optional(v.array(v.string())),
};

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
    return decks.map((d) => ({ _id: d._id, name: d.name, format: d.format, bracket: d.bracket, folderId: d.folderId, updatedAt: d.updatedAt, extraColor: d.extraColor, colorCards: colorCards(d.cards), ...summarize(d.cards, d.format === CARD_LIST) }));
  },
});

/** How many of your most recent decks the Play page checks and offers. */
const PLAY_DECKS = 100;

/** Your most recent decks with their cards, for the Play page to check which can start a game. */
export const forPlay = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const decks = await ctx.db
      .query("decks")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(PLAY_DECKS);
    return decks.filter((d) => d.format !== CARD_LIST).map((d) => ({ _id: d._id, name: d.name, format: d.format, cards: d.cards, extraColor: d.extraColor, commanders: summarize(d.cards).commanders }));
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

/** Throws unless `folderId` is one of the user's folders. */
async function checkFolder(ctx: QueryCtx, userId: Id<"users">, folderId: Id<"deckFolders">) {
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.userId !== userId) throw new ConvexError("Folder not found.");
}

export const create = mutation({
  args: { ...deckArgs, folderId: v.optional(v.id("deckFolders")) },
  handler: async (ctx, { folderId, ...args }) => {
    const userId = await requireUser(ctx);
    const deck = checked(args);
    if (folderId) await checkFolder(ctx, userId, folderId);
    const count = (await ctx.db.query("decks").withIndex("by_user_updated", (q) => q.eq("userId", userId)).take(MAX_DECKS_PER_USER)).length;
    if (count >= MAX_DECKS_PER_USER) throw new ConvexError(`You can save up to ${MAX_DECKS_PER_USER} decks.`);
    return await ctx.db.insert("decks", { userId, ...deck, ...(folderId ? { folderId } : {}), updatedAt: Date.now() });
  },
});

/** Files a deck in one of your folders, or takes it out of its folder (`folderId: null`). */
export const move = mutation({
  args: { id: v.id("decks"), folderId: v.union(v.id("deckFolders"), v.null()) },
  handler: async (ctx, { id, folderId }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(id);
    if (!deck || deck.userId !== userId) throw new ConvexError("Deck not found.");
    if (folderId) await checkFolder(ctx, userId, folderId);
    // Not an edit to the deck, so `updatedAt` (the deck list's order) stays put.
    await ctx.db.patch(id, { folderId: folderId ?? undefined });
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

/** Sets a Commander deck's bracket from the deck list (`null` clears it). */
export const setBracket = mutation({
  args: { id: v.id("decks"), bracket: v.union(v.number(), v.null()) },
  handler: async (ctx, { id, bracket }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(id);
    if (!deck || deck.userId !== userId) throw new ConvexError("Deck not found.");
    if (deck.format !== "commander") throw new ConvexError("Only Commander decks have a bracket.");
    // `updatedAt` stays put, so the deck doesn't jump in a list sorted by it.
    await ctx.db.patch(id, { bracket: rules(() => checkBracket(bracket)) });
  },
});

/** Remembers how you group this deck in the editor. */
export const setGroupBy = mutation({
  args: { id: v.id("decks"), groupBy: v.string() },
  handler: async (ctx, { id, groupBy }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(id);
    if (!deck || deck.userId !== userId) throw new ConvexError("Deck not found.");
    if (!isGroupBy(groupBy)) throw new ConvexError("Unknown grouping.");
    // Not an edit to the deck, so `updatedAt` (the deck list's order) stays put.
    await ctx.db.patch(id, { groupBy: groupBy === DEFAULT_GROUPING ? undefined : groupBy });
  },
});

const SCRYFALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TOKEN_PICKS = 200;

/** Token art from an imported deck: these picks replace any for the same kinds of token. */
export const addTokenArt = mutation({
  args: { id: v.id("decks"), picks: v.array(v.object({ identity: v.string(), scryfallId: v.string() })) },
  handler: async (ctx, { id, picks }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(id);
    if (!deck || deck.userId !== userId) throw new ConvexError("Deck not found.");
    for (const p of picks) checkPick(p.identity, p.scryfallId);
    const ids = new Set(picks.map((p) => p.identity));
    const next = [...(deck.tokenArt ?? []).filter((t) => !ids.has(t.identity)), ...picks];
    if (next.length > MAX_TOKEN_PICKS) throw new ConvexError("Too many token picks for one deck.");
    await ctx.db.patch(id, { tokenArt: next });
  },
});

function checkPick(identity: string, scryfallId: string | null) {
  if (identity.length > 120 || !identity.includes("|")) throw new ConvexError("Not a token.");
  if (scryfallId !== null && !SCRYFALL_ID.test(scryfallId)) throw new ConvexError("Not a Scryfall card id.");
}

/** Pick the printing for one kind of token in a deck (`scryfallId: null` goes back to the default). */
export const setTokenArt = mutation({
  args: { id: v.id("decks"), identity: v.string(), scryfallId: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, identity, scryfallId }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(id);
    if (!deck || deck.userId !== userId) throw new ConvexError("Deck not found.");
    checkPick(identity, scryfallId);
    const picks = (deck.tokenArt ?? []).filter((t) => t.identity !== identity);
    if (scryfallId !== null) picks.push({ identity, scryfallId });
    if (picks.length > MAX_TOKEN_PICKS) throw new ConvexError("Too many token picks for one deck.");
    await ctx.db.patch(id, { tokenArt: picks });
  },
});

const MAX_SAVED_ABILITIES = 200;

/** Save an ability's setting with a deck, for every copy of it (nothing set takes it out). */
export const setAbility = mutation({
  args: {
    id: v.id("decks"),
    card: v.string(),
    text: v.string(),
    autoYield: v.boolean(),
    decision: v.union(v.literal("ASK"), v.literal("ACCEPT"), v.literal("DECLINE")),
  },
  handler: async (ctx, { id, card, text, autoYield, decision }) => {
    const userId = await requireUser(ctx);
    const deck = await ctx.db.get(id);
    if (!deck || deck.userId !== userId) throw new ConvexError("Deck not found.");
    if (!text.trim() || text.length > 1000 || card.length > 200) throw new ConvexError("Not an ability.");
    const next = withSaved(deck.abilities ?? [], card, text, { autoYield, decision });
    if (next.length > MAX_SAVED_ABILITIES) throw new ConvexError(`You can save up to ${MAX_SAVED_ABILITIES} abilities with a deck.`);
    // Not an edit to the deck, so `updatedAt` (the deck list's order) stays put.
    await ctx.db.patch(id, { abilities: next.length ? next : undefined });
  },
});
