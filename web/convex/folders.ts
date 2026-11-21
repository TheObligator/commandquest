import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { MAX_DECKS_PER_USER } from "./model/deckRules";
import { cleanFolderName, FolderError, MAX_FOLDERS_PER_USER } from "./model/folderRules";

// Deck folders. Like decks, every function is scoped to the signed-in user.

async function requireUser(ctx: MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  return userId;
}

async function foldersOf(ctx: MutationCtx, userId: Id<"users">) {
  return await ctx.db.query("deckFolders").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_FOLDERS_PER_USER + 1);
}

function named(name: string, taken: string[]) {
  try {
    return cleanFolderName(name, taken);
  } catch (e) {
    if (e instanceof FolderError) throw new ConvexError(e.message);
    throw e;
  }
}

/** Your folders, sorted by name. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const folders = await ctx.db.query("deckFolders").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_FOLDERS_PER_USER);
    return folders.map((f) => ({ _id: f._id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    const existing = await foldersOf(ctx, userId);
    if (existing.length >= MAX_FOLDERS_PER_USER) throw new ConvexError(`You can have up to ${MAX_FOLDERS_PER_USER} folders.`);
    return await ctx.db.insert("deckFolders", { userId, name: named(name, existing.map((f) => f.name)), createdAt: Date.now() });
  },
});

export const rename = mutation({
  args: { id: v.id("deckFolders"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const userId = await requireUser(ctx);
    const folder = await ctx.db.get(id);
    if (!folder || folder.userId !== userId) throw new ConvexError("Folder not found.");
    const others = (await foldersOf(ctx, userId)).filter((f) => f._id !== id).map((f) => f.name);
    await ctx.db.patch(id, { name: named(name, others) });
  },
});

/** Deletes the folder. Its decks aren't deleted: they go back to having no folder. */
export const remove = mutation({
  args: { id: v.id("deckFolders") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const folder = await ctx.db.get(id);
    if (!folder || folder.userId !== userId) throw new ConvexError("Folder not found.");
    const decks = await ctx.db.query("decks").withIndex("by_user_updated", (q) => q.eq("userId", userId)).take(MAX_DECKS_PER_USER);
    for (const d of decks) if (d.folderId === id) await ctx.db.patch(d._id, { folderId: undefined });
    await ctx.db.delete(id);
  },
});
