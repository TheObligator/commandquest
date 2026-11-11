import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Signing in with an email link opened on a different device (src/pages/SignIn.tsx). The device
// that asks for the link puts a random `pair` id in it and waits. Opened anywhere else, the link's
// page hands its one-time code back here, and the asking browser claims it and signs itself in.
// Knowing `pair` means having the email (or being the asking device), so it guards the code.

const PAIR = /^[A-Za-z0-9]{32}$/;
const MAX_AGE_MS = 60 * 60 * 1000;

function checkPair(pair: string) {
  if (!PAIR.test(pair)) throw new ConvexError("Bad sign-in link.");
}

/** The link was opened on another device: keep its code for the asking browser. */
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

/** Is a code waiting for this pair? (The asking browser watches this, then claims it.) */
export const ready = query({
  args: { pair: v.string() },
  handler: async (ctx, { pair }) => {
    if (!PAIR.test(pair)) return false;
    const row = await ctx.db.query("signinHandoffs").withIndex("by_pair", (q) => q.eq("pair", pair)).unique();
    return !!row && row.createdAt > Date.now() - MAX_AGE_MS;
  },
});

/**
 * Takes the waiting code, once: the asking browser when it sees it, or the device that opened
 * the link if nobody took it in time (the asking page was closed). Null if it's gone.
 */
export const claim = mutation({
  args: { pair: v.string() },
  handler: async (ctx, { pair }) => {
    checkPair(pair);
    const row = await ctx.db.query("signinHandoffs").withIndex("by_pair", (q) => q.eq("pair", pair)).unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row.createdAt > Date.now() - MAX_AGE_MS ? row.code : null;
  },
});
