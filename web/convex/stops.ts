import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { DEFAULT_PRESET, STEPS } from "../src/game/phases";
import { mutation, query } from "./_generated/server";

// Default priority stops per user (docs/stops.md). Step ids are Forge's PhaseType names; the
// list and its rules live in src/game/phases.ts, shared with the client.

function cleanSteps(ids: string[]): string[] {
  for (const id of ids) {
    const step = STEPS.find((s) => s.id === id);
    if (!step) throw new ConvexError(`Unknown step "${id}".`);
    if (!step.priority) throw new ConvexError(`Nobody gets priority during ${step.label}, so it can't have a stop.`);
  }
  return STEPS.map((s) => s.id).filter((id) => ids.includes(id)); // turn order, no duplicates
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const row = userId && (await ctx.db.query("stopPresets").withIndex("by_user", (q) => q.eq("userId", userId)).unique());
    return row ? { self: row.self, opponents: row.opponents, ...(row.seats ? { seats: row.seats } : {}) } : DEFAULT_PRESET;
  },
});

export const save = mutation({
  args: { self: v.array(v.string()), opponents: v.array(v.string()), seats: v.optional(v.array(v.array(v.string()))) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to save your stops.");
    if (args.seats && args.seats.length > 7) throw new ConvexError("Too many seats.");
    const preset = {
      self: cleanSteps(args.self),
      opponents: cleanSteps(args.opponents),
      ...(args.seats ? { seats: args.seats.map(cleanSteps) } : {}),
    };
    const row = await ctx.db.query("stopPresets").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (row) await ctx.db.patch(row._id, preset);
    else await ctx.db.insert("stopPresets", { userId, ...preset });
    return preset;
  },
});

export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return DEFAULT_PRESET;
    const row = await ctx.db.query("stopPresets").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (row) await ctx.db.delete(row._id);
    return DEFAULT_PRESET;
  },
});
