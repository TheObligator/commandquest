import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { HOTKEY_ACTIONS, validKey } from "../src/game/hotkeys";
import { mutation, query } from "./_generated/server";

// Per-user settings. For now the game hotkeys (src/game/hotkeys.ts): only keys that differ from
// the defaults are stored.

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    return { hotkeys: row?.hotkeys ?? {} };
  },
});

export const saveHotkeys = mutation({
  args: { hotkeys: v.record(v.string(), v.string()) },
  handler: async (ctx, { hotkeys }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to save your hotkeys.");
    for (const [action, key] of Object.entries(hotkeys)) {
      if (!HOTKEY_ACTIONS.some((a) => a.id === action)) throw new ConvexError(`Unknown action "${action}".`);
      if (!validKey(key)) throw new ConvexError(`"${key}" can't be used as a hotkey.`);
    }
    const row = await ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (row) await ctx.db.patch(row._id, { hotkeys });
    else await ctx.db.insert("settings", { userId, hotkeys });
  },
});
