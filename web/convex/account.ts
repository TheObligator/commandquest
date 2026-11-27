// Deleting your own account (Settings → Delete account, docs: the Privacy page in src/pages/Legal.tsx).
//
// Everything is deleted in one mutation, so it either all goes or nothing does. A player has at most a
// few hundred decks and packages and 10 replays, well inside a mutation's limits.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { confirmsDeletion } from "./model/account";
import { unlink } from "./replays";
import { leaveCurrent } from "./tables";

/** What deleting your account would take with it, for the confirm dialog. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const count = async (table: "decks" | "packages") =>
      (await ctx.db.query(table).withIndex("by_user_updated", (q) => q.eq("userId", userId)).collect()).length;
    const replays = await ctx.db.query("replayLinks").withIndex("by_user_saved", (q) => q.eq("userId", userId)).collect();
    return { decks: await count("decks"), packages: await count("packages"), replays: replays.length };
  },
});

/**
 * Deletes the signed-in user and everything that's theirs: decks (with their combos), folders,
 * packages, settings, stop presets, their hold on replays (a replay goes once nobody keeps it), their
 * seat at a table (as if they left: the host passes on, an empty table goes), and their sign-in
 * accounts and sessions. The client signs out afterwards.
 */
export const deleteAccount = mutation({
  args: { confirm: v.string() },
  handler: async (ctx, { confirm }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first.");
    if (!confirmsDeletion(confirm)) throw new ConvexError("Type delete to confirm.");

    for (const deck of await ctx.db.query("decks").withIndex("by_user_updated", (q) => q.eq("userId", userId)).collect()) {
      for (const c of await ctx.db.query("deckCombos").withIndex("by_deck", (q) => q.eq("deckId", deck._id)).collect()) {
        await ctx.db.delete(c._id);
      }
      await ctx.db.delete(deck._id);
    }
    for (const p of await ctx.db.query("packages").withIndex("by_user_updated", (q) => q.eq("userId", userId)).collect()) {
      await ctx.db.delete(p._id);
    }
    for (const table of ["deckFolders", "stopPresets", "settings"] as const) {
      for (const row of await ctx.db.query(table).withIndex("by_user", (q) => q.eq("userId", userId)).collect()) {
        await ctx.db.delete(row._id);
      }
    }
    for (const link of await ctx.db.query("replayLinks").withIndex("by_user_saved", (q) => q.eq("userId", userId)).collect()) {
      await unlink(ctx, link._id, link.replayId);
    }
    await leaveCurrent(ctx, userId);

    // Convex Auth's rows. Its rate limits are keyed by email and expire on their own; PKCE verifiers
    // aren't linked to a user.
    for (const account of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", userId)).collect()) {
      for (const code of await ctx.db.query("authVerificationCodes").withIndex("accountId", (q) => q.eq("accountId", account._id)).collect()) {
        await ctx.db.delete(code._id);
      }
      await ctx.db.delete(account._id);
    }
    for (const session of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect()) {
      for (const token of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", session._id)).collect()) {
        await ctx.db.delete(token._id);
      }
      await ctx.db.delete(session._id);
    }
    await ctx.db.delete(userId);
  },
});
