import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { cantSave, recentToDrop } from "./model/replays";

// Replays of finished games (docs/replays.md). The game server uploads one through the HTTP
// route in http.ts; each human player then keeps it: their last 5 games automatically, plus up to
// 5 they saved. A replay file is deleted once nobody keeps it.

const replayPlayer = v.object({ name: v.string(), human: v.boolean(), commander: v.optional(v.string()) });

/** Called by http.ts with a checked upload: store it for each player who keeps it. */
export const add = internalMutation({
  args: {
    storageId: v.id("_storage"),
    size: v.number(),
    title: v.string(),
    playedAt: v.number(),
    turns: v.number(),
    frames: v.number(),
    players: v.array(replayPlayer),
    winner: v.optional(v.string()),
    truncated: v.optional(v.boolean()),
    users: v.array(v.string()),
  },
  handler: async (ctx, { users, ...replay }) => {
    const keepers: Id<"users">[] = [];
    for (const u of users) {
      const id = ctx.db.normalizeId("users", u);
      if (id && (await ctx.db.get(id)) && !keepers.includes(id)) keepers.push(id);
    }
    if (keepers.length === 0) {
      await ctx.storage.delete(replay.storageId);
      return null;
    }
    const replayId = await ctx.db.insert("replays", replay);
    for (const userId of keepers) {
      await ctx.db.insert("replayLinks", { userId, replayId, saved: false, playedAt: replay.playedAt });
      await trimRecent(ctx, userId);
    }
    return replayId;
  },
});

/** Drops a player's oldest unsaved replays beyond the newest five. */
async function trimRecent(ctx: MutationCtx, userId: Id<"users">) {
  const recent = await ctx.db
    .query("replayLinks")
    .withIndex("by_user_saved", (q) => q.eq("userId", userId).eq("saved", false))
    .collect();
  for (const link of recentToDrop(recent)) await unlink(ctx, link._id, link.replayId);
}

/** Removes one player's hold on a replay, and the replay once nobody holds it. */
async function unlink(ctx: MutationCtx, linkId: Id<"replayLinks">, replayId: Id<"replays">) {
  await ctx.db.delete(linkId);
  const other = await ctx.db.query("replayLinks").withIndex("by_replay", (q) => q.eq("replayId", replayId)).first();
  if (other) return;
  const replay = await ctx.db.get(replayId);
  if (replay) {
    await ctx.storage.delete(replay.storageId);
    await ctx.db.delete(replayId);
  }
}

async function myLink(ctx: MutationCtx, id: string) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  const replayId = ctx.db.normalizeId("replays", id);
  const link = replayId
    ? await ctx.db.query("replayLinks").withIndex("by_user_replay", (q) => q.eq("userId", userId).eq("replayId", replayId)).unique()
    : null;
  if (!link) throw new ConvexError("That replay isn't yours (or was deleted).");
  return { userId, link };
}

/** Your replays: the recent ones (kept automatically) and the ones you saved, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { recent: [], saved: [] };
    const links = await ctx.db.query("replayLinks").withIndex("by_user_saved", (q) => q.eq("userId", userId)).collect();
    const rows = [];
    for (const l of links.sort((a, b) => b.playedAt - a.playedAt)) {
      const r = await ctx.db.get(l.replayId);
      if (!r) continue;
      const { storageId: _file, ...info } = r;
      rows.push({ ...info, saved: l.saved });
    }
    return { recent: rows.filter((r) => !r.saved), saved: rows.filter((r) => r.saved) };
  },
});

/** One of your replays with a link to its file, or null. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const replayId = ctx.db.normalizeId("replays", id);
    if (!userId || !replayId) return null;
    const link = await ctx.db.query("replayLinks").withIndex("by_user_replay", (q) => q.eq("userId", userId).eq("replayId", replayId)).unique();
    const r = link ? await ctx.db.get(replayId) : null;
    if (!r) return null;
    const { storageId, ...info } = r;
    return { ...info, saved: link!.saved, url: await ctx.storage.getUrl(storageId) };
  },
});

/** Keep a recent replay for good (at most 5 saved). */
export const save = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { userId, link } = await myLink(ctx, id);
    if (link.saved) return;
    const saved = await ctx.db.query("replayLinks").withIndex("by_user_saved", (q) => q.eq("userId", userId).eq("saved", true)).take(10);
    const why = cantSave(saved.length);
    if (why) throw new ConvexError(why);
    await ctx.db.patch(link._id, { saved: true });
  },
});

/** Delete one of your replays (recent or saved). The file goes once nobody else keeps it. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { link } = await myLink(ctx, id);
    await unlink(ctx, link._id, link.replayId);
  },
});
