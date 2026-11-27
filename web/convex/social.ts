// Likes, favorites, views and comments on shared decks (rules in convex/model/sharing.ts).
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { cleanComment, COMMENT_GAP_MS, CommentError, MAX_COMMENT_DEPTH, MAX_COMMENTS_PER_DECK, VIEW_KEEP_MS, VIEWER_RE, viewDay } from "./model/sharing";
import { purgeChanges } from "./changelog";
import { sharedDeck } from "./sharing";

/** A shared deck someone else owns, for liking, favoriting or commenting on. */
async function othersDeck(ctx: MutationCtx, key: string) {
  const found = await sharedDeck(ctx, key);
  if (!found) throw new ConvexError("This deck isn't shared any more.");
  if (!found.userId) throw new ConvexError("Sign in first.");
  return { deck: found.deck, userId: found.userId, owner: found.owner };
}

/** Likes a shared deck, or takes the like back. Returns whether it's liked now. */
export const toggleLike = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const { deck, userId, owner } = await othersDeck(ctx, key);
    if (owner) throw new ConvexError("You can't like your own deck.");
    const row = await ctx.db.query("deckLikes").withIndex("by_deck_user", (q) => q.eq("deckId", deck._id).eq("userId", userId)).unique();
    if (row) await ctx.db.delete(row._id);
    else await ctx.db.insert("deckLikes", { deckId: deck._id, userId });
    await ctx.db.patch(deck._id, { likes: Math.max(0, (deck.likes ?? 0) + (row ? -1 : 1)) });
    return !row;
  },
});

/** Adds a shared deck to your favorites, or takes it out. Returns whether it's a favorite now. */
export const toggleFavorite = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const { deck, userId } = await othersDeck(ctx, key);
    const row = await ctx.db.query("deckFavorites").withIndex("by_deck_user", (q) => q.eq("deckId", deck._id).eq("userId", userId)).unique();
    if (row) await ctx.db.delete(row._id);
    else await ctx.db.insert("deckFavorites", { deckId: deck._id, userId, at: Date.now() });
    return !row;
  },
});

/**
 * Counts a view of a shared deck: once a day per viewer (the signed-in player, else the browser's
 * own random id). The owner's own views don't count.
 */
export const recordView = mutation({
  args: { key: v.string(), browser: v.optional(v.string()) },
  handler: async (ctx, { key, browser }) => {
    const found = await sharedDeck(ctx, key);
    if (!found || found.owner) return;
    const viewer = found.userId ?? (browser && VIEWER_RE.test(browser) ? `b:${browser}` : null);
    if (!viewer) return;
    const now = Date.now();
    const day = viewDay(now);
    const seen = await ctx.db.query("deckViews").withIndex("by_deck_viewer_day", (q) => q.eq("deckId", found.deck._id).eq("viewer", viewer).eq("day", day)).first();
    if (seen) return;
    await ctx.db.insert("deckViews", { deckId: found.deck._id, viewer, day, at: now });
    await ctx.db.patch(found.deck._id, { views: (found.deck.views ?? 0) + 1 });
  },
});

/** Forgets views older than two days (each viewer only needs to be remembered for the day). */
export const forgetViews = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("deckViews").withIndex("by_at", (q) => q.lt("at", Date.now() - VIEW_KEEP_MS)).take(2000);
    for (const r of old) await ctx.db.delete(r._id);
    if (old.length === 2000) await ctx.scheduler.runAfter(0, internal.social.forgetViews, {});
  },
});

// ---- Comments ----

/** A deck's comments, oldest first, with their authors' usernames. Empty while comments are off (except for the owner, who sees they're off). */
export const comments = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const found = await sharedDeck(ctx, key);
    if (!found || found.deck.commentsOff) return [];
    const rows = await ctx.db.query("deckComments").withIndex("by_deck_created", (q) => q.eq("deckId", found.deck._id)).take(MAX_COMMENTS_PER_DECK);
    const names = new Map<string, string | undefined>();
    for (const r of rows) {
      if (r.userId && !names.has(r.userId)) names.set(r.userId, (await ctx.db.get(r.userId))?.username);
    }
    return rows.map((r) => ({
      _id: r._id as string,
      parentId: r.parentId as string | undefined,
      body: r.deleted ? "" : r.body,
      deleted: !!r.deleted,
      author: r.userId ? names.get(r.userId) ?? "Player" : undefined,
      byDeckOwner: !!r.userId && r.userId === found.deck.userId,
      mine: !!found.userId && r.userId === found.userId,
      /** The viewer may delete it: theirs, or on their deck. */
      canDelete: !r.deleted && !!found.userId && (r.userId === found.userId || found.owner),
      createdAt: r.createdAt,
      editedAt: r.editedAt,
    }));
  },
});

function cleaned(body: string) {
  try {
    return cleanComment(body);
  } catch (e) {
    if (e instanceof CommentError) throw new ConvexError(e.message);
    throw e;
  }
}

async function depthOf(ctx: MutationCtx, c: Doc<"deckComments">): Promise<number> {
  let depth = 0;
  let at: Doc<"deckComments"> | null = c;
  while (at?.parentId && depth < MAX_COMMENT_DEPTH + 1) {
    at = await ctx.db.get(at.parentId);
    depth++;
  }
  return depth;
}

/** Comments on a shared deck, or replies to one of its comments (`parentId`). Needs a username. */
export const addComment = mutation({
  args: { key: v.string(), body: v.string(), parentId: v.optional(v.id("deckComments")) },
  handler: async (ctx, { key, body, parentId }) => {
    const { deck, userId } = await othersDeck(ctx, key);
    if (deck.commentsOff) throw new ConvexError("Comments are off for this deck.");
    const me = await ctx.db.get(userId);
    if (!me?.username) throw new ConvexError("Pick a username in Settings to comment.");
    const text = cleaned(body);
    const last = await ctx.db.query("deckComments").withIndex("by_user_created", (q) => q.eq("userId", userId)).order("desc").first();
    const now = Date.now();
    if (last && now - last.createdAt < COMMENT_GAP_MS) throw new ConvexError("Slow down a little: wait a moment before commenting again.");
    if ((deck.comments ?? 0) >= MAX_COMMENTS_PER_DECK) throw new ConvexError("This deck has as many comments as it can take.");
    let parent: Id<"deckComments"> | undefined;
    if (parentId) {
      const p = await ctx.db.get(parentId);
      if (!p || p.deckId !== deck._id) throw new ConvexError("That comment is gone.");
      // Past the deepest level, a reply goes beside the comment it answers instead of under it.
      parent = (await depthOf(ctx, p)) >= MAX_COMMENT_DEPTH - 1 && p.parentId ? p.parentId : parentId;
    }
    const id = await ctx.db.insert("deckComments", { deckId: deck._id, userId, body: text, createdAt: now, ...(parent ? { parentId: parent } : {}) });
    await ctx.db.patch(deck._id, { comments: (deck.comments ?? 0) + 1 });
    return id;
  },
});

/** Edits your own comment. */
export const editComment = mutation({
  args: { id: v.id("deckComments"), body: v.string() },
  handler: async (ctx, { id, body }) => {
    const userId = await getAuthUserId(ctx);
    const c = await ctx.db.get(id);
    if (!userId || !c || c.deleted || c.userId !== userId) throw new ConvexError("That comment is gone.");
    await ctx.db.patch(id, { body: cleaned(body), editedAt: Date.now() });
  },
});

/**
 * Deletes a comment: your own, or any on your deck. One with replies stays as "deleted" so the
 * conversation under it still makes sense; once the last reply goes, so does it.
 */
export const deleteComment = mutation({
  args: { id: v.id("deckComments") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const c = await ctx.db.get(id);
    if (!userId || !c || c.deleted) throw new ConvexError("That comment is gone.");
    const deck = await ctx.db.get(c.deckId);
    if (c.userId !== userId && deck?.userId !== userId) throw new ConvexError("You can only delete your own comments.");
    await removeComment(ctx, c);
  },
});

/** Takes a comment out (or leaves it as "deleted" while it has replies), then any deleted parent left without replies. */
async function removeComment(ctx: MutationCtx, c: Doc<"deckComments">) {
  const replies = await ctx.db.query("deckComments").withIndex("by_parent", (q) => q.eq("parentId", c._id)).first();
  if (replies) {
    await ctx.db.patch(c._id, { deleted: true, body: "", userId: undefined, editedAt: undefined });
  } else {
    await ctx.db.delete(c._id);
    const parent = c.parentId ? await ctx.db.get(c.parentId) : null;
    if (parent?.deleted) await removeComment(ctx, parent);
  }
  const deck = await ctx.db.get(c.deckId);
  if (deck && !c.deleted) await ctx.db.patch(deck._id, { comments: Math.max(0, (deck.comments ?? 0) - 1) });
}

// ---- Cleaning up ----

/**
 * Everything hanging off a deleted deck: its card index, likes, favorites, views, comments and
 * changelog. Scheduled by the deck's deletion, so a big deck doesn't hold up the delete.
 */
export const purgeDeck = internalMutation({
  args: { deckId: v.id("decks") },
  handler: async (ctx, { deckId }) => {
    for (const t of ["deckLikes", "deckFavorites"] as const) {
      for (const r of await ctx.db.query(t).withIndex("by_deck_user", (q) => q.eq("deckId", deckId)).collect()) await ctx.db.delete(r._id);
    }
    for (const t of ["deckCardIndex", "deckViews"] as const) {
      for (const r of await ctx.db.query(t).withIndex("by_deck", (q) => q.eq("deckId", deckId)).collect()) await ctx.db.delete(r._id);
    }
    for (const r of await ctx.db.query("deckComments").withIndex("by_deck_created", (q) => q.eq("deckId", deckId)).collect()) await ctx.db.delete(r._id);
    await purgeChanges(ctx, deckId);
  },
});

/**
 * A deleted account's likes (taken back), favorites and comments (deleted, or left as "deleted"
 * where others replied). Their views are forgotten within two days anyway (forgetViews).
 */
export async function purgeUserSocial(ctx: MutationCtx, userId: Id<"users">) {
  for (const like of await ctx.db.query("deckLikes").withIndex("by_user", (q) => q.eq("userId", userId)).collect()) {
    const deck = await ctx.db.get(like.deckId);
    if (deck) await ctx.db.patch(deck._id, { likes: Math.max(0, (deck.likes ?? 0) - 1) });
    await ctx.db.delete(like._id);
  }
  for (const f of await ctx.db.query("deckFavorites").withIndex("by_user_at", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(f._id);
  for (const c of await ctx.db.query("deckComments").withIndex("by_user_created", (q) => q.eq("userId", userId)).collect()) {
    const fresh = await ctx.db.get(c._id);
    if (fresh && !fresh.deleted) await removeComment(ctx, fresh);
  }
  // Their views (deckViews) are forgotten within two days anyway (forgetViews).
}
