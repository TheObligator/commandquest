import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { checkUsername, displayName } from "../src/username";
import { mutation, query } from "./_generated/server";

/**
 * The signed-in user, or null. `name` is what other players see: the username, else the sign-in
 * provider's name, else "Player". Never the email address.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const u = await ctx.db.get(userId);
    return (
      u && {
        _id: u._id,
        name: displayName(u),
        username: u.username ?? null,
        hasUsername: !!u.username,
        image: u.image,
      }
    );
  },
});

/** Sets or changes the signed-in user's username (rules in src/username.ts). */
export const setUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to choose a username.");
    const check = checkUsername(args.username);
    if (!check.ok) throw new ConvexError(check.error);
    const taken = await ctx.db
      .query("users")
      .withIndex("by_username_key", (q) => q.eq("usernameKey", check.key))
      .first();
    if (taken && taken._id !== userId) throw new ConvexError("That username is taken.");
    await ctx.db.patch(userId, { username: check.username, usernameKey: check.key });
    return check.username;
  },
});
