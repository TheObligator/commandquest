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

  /** Convex Auth's users table, plus the username players pick in Settings (src/username.ts). */
  users: defineTable({
    ...authTables.users.validator.fields,
    username: v.optional(v.string()),
    /** Lower-cased username, so usernames are unique regardless of case. */
    usernameKey: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_username_key", ["usernameKey"]),

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

  /**
   * Email sign-in links opened on another device (convex/signinHandoff.ts): the link's one-time
   * code, passed to the device that asked for it. Deleted once used, and after an hour.
   */
  signinHandoffs: defineTable({
    /** Random id the asking device put in the link; only it and the email's reader know it. */
    pair: v.string(),
    code: v.string(),
    createdAt: v.number(),
  })
    .index("by_pair", ["pair"])
    .index("by_created", ["createdAt"]),

  /** A finished game's replay (convex/replays.ts, docs/replays.md): the file and what it's about. */
  replays: defineTable({
    storageId: v.id("_storage"),
    size: v.number(),
    title: v.string(),
    playedAt: v.number(),
    turns: v.number(),
    frames: v.number(),
    players: v.array(v.object({ name: v.string(), human: v.boolean(), commander: v.optional(v.string()) })),
    winner: v.optional(v.string()),
    /** The game ran past the frame limit: the replay stops early. */
    truncated: v.optional(v.boolean()),
  }),

  /** Who keeps which replay: the last 5 automatically (`saved` false), up to 5 more saved. */
  replayLinks: defineTable({
    userId: v.id("users"),
    replayId: v.id("replays"),
    saved: v.boolean(),
    /** The replay's, for ordering. */
    playedAt: v.number(),
  })
    .index("by_user_saved", ["userId", "saved", "playedAt"])
    .index("by_user_replay", ["userId", "replayId"])
    .index("by_replay", ["replayId"]),

  /** Per-user settings (convex/settings.ts). One row per user; absent = the defaults. */
  settings: defineTable({
    userId: v.id("users"),
    /** Game hotkeys that differ from the defaults, action → key name (src/game/hotkeys.ts). */
    hotkeys: v.record(v.string(), v.string()),
  }).index("by_user", ["userId"]),
});
