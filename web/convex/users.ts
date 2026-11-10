import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

/** The signed-in user (name and avatar from their sign-in provider), or null. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const u = await ctx.db.get(userId);
    return u && { _id: u._id, name: u.name ?? u.email ?? "Player", image: u.image };
  },
});
