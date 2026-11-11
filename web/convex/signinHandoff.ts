import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Signing in with an email link opened on a different device (src/pages/SignIn.tsx). The device
// that asks for the link puts a random `pair` id in it and waits. The link's page on the other
// device can hand its one-time code back here, and the asking device signs itself in with it.
// Knowing `pair` means having the email (or being the asking device), so it guards the code.

const PAIR = /^[A-Za-z0-9]{32}$/;
const MAX_AGE_MS = 60 * 60 * 1000;

function checkPair(pair: string) {
  if (!PAIR.test(pair)) throw new ConvexError("Bad sign-in link.");
}

/** The other device approved: keep its code for the asking device. */
export const approve = mutation({
  args: { pair: v.string(), code: v.string() },
  handler: async (ctx, { pair, code }) => {
    checkPair(pair);
    if (code.length < 6 || code.length > 128) throw new ConvexError("Bad sign-in link.");
    const now = Date.now();
    for (const old of await ctx.db.query("signinHandoffs").withIndex("by_created", (q) => q.lt("createdAt", now - MAX_AGE_MS)).take(50)) {
      await ctx.db.delete(old._id);
    }
    const existing = await ctx.db.query("signinHandoffs").withIndex("by_pair", (q) => q.eq("pair", pair)).unique();
    if (existing) await ctx.db.patch(existing._id, { code, createdAt: now });
    else await ctx.db.insert("signinHandoffs", { pair, code, createdAt: now });
  },
});

/** The asking device waits on this: the code once another device approved, else null. */
export const waiting = query({
  args: { pair: v.string() },
  handler: async (ctx, { pair }) => {
    if (!PAIR.test(pair)) return null;
    const row = await ctx.db.query("signinHandoffs").withIndex("by_pair", (q) => q.eq("pair", pair)).unique();
    return row && row.createdAt > Date.now() - MAX_AGE_MS ? row.code : null;
  },
});

/** The asking device used the code (or gave up): forget it. */
export const done = mutation({
  args: { pair: v.string() },
  handler: async (ctx, { pair }) => {
    checkPair(pair);
    const row = await ctx.db.query("signinHandoffs").withIndex("by_pair", (q) => q.eq("pair", pair)).unique();
    if (row) await ctx.db.delete(row._id);
  },
});
