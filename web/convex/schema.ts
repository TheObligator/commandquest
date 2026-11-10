import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const board = v.union(v.literal("commander"), v.literal("main"), v.literal("side"), v.literal("maybe"));

export const deckCard = v.object({
  name: v.string(),
  quantity: v.number(),
  board,
  scryfallId: v.optional(v.string()),
  set: v.optional(v.string()),
  collectorNumber: v.optional(v.string()),
});

export default defineSchema({
  // users, sessions, accounts, … from Convex Auth
  ...authTables,

  decks: defineTable({
    userId: v.id("users"),
    name: v.string(),
    format: v.string(),
    cards: v.array(deckCard),
    /** Token printings you picked for this deck, by token identity (web/src/tokens.ts). Defaults aren't stored. */
    tokenArt: v.optional(v.array(v.object({ identity: v.string(), scryfallId: v.string() }))),
    updatedAt: v.number(),
  }).index("by_user_updated", ["userId", "updatedAt"]),

  /** Default priority stops (docs/stops.md). One row per user; absent = the defaults. */
  stopPresets: defineTable({
    userId: v.id("users"),
    self: v.array(v.string()),
    opponents: v.array(v.string()),
    /** Per seat, in turn order after the player (docs/stops.md). Older rows don't have it. */
    seats: v.optional(v.array(v.array(v.string()))),
  }).index("by_user", ["userId"]),
});
