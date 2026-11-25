import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_GROUPING, isGroupBy } from "../src/deckGroups";
import { DeckError } from "./model/deckRules";
import { MAX_PACKAGES_PER_USER, validatePackage, withCard, type PackageInput } from "./model/packageRules";
import { deckCard } from "./schema";

// Packages: sets of cards to add to decks. Like decks, every function is scoped to the signed-in user.

async function requireUser(ctx: MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  return userId;
}

async function mine(ctx: MutationCtx, id: Id<"packages">) {
  const userId = await requireUser(ctx);
  const pkg = await ctx.db.get(id);
  if (!pkg || pkg.userId !== userId) throw new ConvexError("Package not found.");
  return pkg;
}

function checked(input: PackageInput) {
  try {
    return validatePackage(input);
  } catch (e) {
    if (e instanceof DeckError) throw new ConvexError(e.message);
    throw e;
  }
}

const packageArgs = { name: v.string(), note: v.optional(v.string()), cards: v.array(deckCard) };

/** Your packages with their cards (the deck editor checks which of them fit), last changed first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const packages = await ctx.db
      .query("packages")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_PACKAGES_PER_USER);
    return packages.map((p) => ({ _id: p._id, name: p.name, note: p.note, cards: p.cards, updatedAt: p.updatedAt }));
  },
});

/** One of your packages, or null (not found, someone else's, or signed out). */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const packageId = ctx.db.normalizeId("packages", id);
    const pkg = userId && packageId ? await ctx.db.get(packageId) : null;
    return pkg && pkg.userId === userId ? pkg : null;
  },
});

export const create = mutation({
  args: packageArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const pkg = checked(args);
    const count = (await ctx.db.query("packages").withIndex("by_user_updated", (q) => q.eq("userId", userId)).take(MAX_PACKAGES_PER_USER)).length;
    if (count >= MAX_PACKAGES_PER_USER) throw new ConvexError(`You can have up to ${MAX_PACKAGES_PER_USER} packages.`);
    return await ctx.db.insert("packages", { userId, ...pkg, updatedAt: Date.now() });
  },
});

export const update = mutation({
  args: { id: v.id("packages"), ...packageArgs },
  handler: async (ctx, { id, ...args }) => {
    await mine(ctx, id);
    await ctx.db.patch(id, { ...checked(args), updatedAt: Date.now() });
  },
});

/** Adds a card from a deck to a package. */
export const addCard = mutation({
  args: { id: v.id("packages"), card: deckCard },
  handler: async (ctx, { id, card }) => {
    const pkg = await mine(ctx, id);
    const { cards } = checked({ name: pkg.name, note: pkg.note, cards: withCard(pkg.cards, card) });
    await ctx.db.patch(id, { cards, updatedAt: Date.now() });
  },
});

/** Remembers how you group this package in the editor. */
export const setGroupBy = mutation({
  args: { id: v.id("packages"), groupBy: v.string() },
  handler: async (ctx, { id, groupBy }) => {
    await mine(ctx, id);
    if (!isGroupBy(groupBy)) throw new ConvexError("Unknown grouping.");
    await ctx.db.patch(id, { groupBy: groupBy === DEFAULT_GROUPING ? undefined : groupBy });
  },
});

export const remove = mutation({
  args: { id: v.id("packages") },
  handler: async (ctx, { id }) => {
    await mine(ctx, id);
    await ctx.db.delete(id);
  },
});
