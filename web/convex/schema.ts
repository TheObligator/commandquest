import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const board = v.union(v.literal("commander"), v.literal("main"), v.literal("side"), v.literal("maybe"));

export const visibility = v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"));

export const deckCard = v.object({
  name: v.string(),
  quantity: v.number(),
  board,
  scryfallId: v.optional(v.string()),
  set: v.optional(v.string()),
  collectorNumber: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  category: v.optional(v.string()),
});

/** A deck's combo from Commander Spellbook (src/game/spellbook.ts). */
export const spellbookCombo = v.object({
  id: v.string(),
  cards: v.array(v.object({ name: v.string(), zones: v.string(), quantity: v.optional(v.number()), commander: v.optional(v.boolean()) })),
  needs: v.array(v.string()),
  results: v.array(v.string()),
  mana: v.optional(v.string()),
  before: v.optional(v.string()),
  steps: v.array(v.string()),
});
export const nearCombo = v.object({ id: v.string(), cards: v.array(v.string()), missing: v.string(), results: v.array(v.string()) });

/** When an ability put off in a game is used (src/game/later.ts). */
export const laterSpec = {
  when: v.union(v.literal("BEFORE_MY_TURN"), v.literal("MY_UPKEEP"), v.literal("NEXT_END"), v.literal("STEP")),
  phase: v.optional(v.string()),
  whose: v.optional(v.string()),
  ask: v.optional(v.boolean()),
};

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
    /** The color a Rulebreaker commander like Tolabow lets this deck add: W, U, B, R or G. */
    extraColor: v.optional(v.string()),
    /** The Commander bracket (1-5) the player puts this deck in, and their reasons (web/src/brackets.ts). */
    bracket: v.optional(v.number()),
    bracketTags: v.optional(v.array(v.string())),
    /** The owner's description of the deck: rich text as Tiptap JSON, cleaned by convex/model/richText.ts. */
    description: v.optional(v.string()),
    tokenArt: v.optional(v.array(v.object({ identity: v.string(), scryfallId: v.string() }))),
    /** Auto-yield and always yes / no settings saved with the deck from games, by ability text (src/game/abilities.ts). */
    abilities: v.optional(
      v.array(
        v.object({
          card: v.string(),
          text: v.string(),
          autoYield: v.optional(v.boolean()),
          decision: v.optional(v.union(v.literal("ACCEPT"), v.literal("DECLINE"))),
        }),
      ),
    ),
    /** Abilities saved with the deck to be used later (src/game/later.ts), for every copy of the card. */
    later: v.optional(v.array(v.object({ card: v.string(), text: v.string(), ...laterSpec }))),
    /** How the editor groups this deck (src/deckGroups.ts); absent = by type. */
    groupBy: v.optional(v.string()),
    /** The folder the player filed this deck in (convex/folders.ts); absent = not in a folder. */
    folderId: v.optional(v.id("deckFolders")),
    updatedAt: v.number(),
    // ---- Sharing (convex/sharing.ts, convex/model/sharing.ts) ----
    /** public, unlisted or private; absent = private (decks saved before sharing existed). */
    visibility: v.optional(visibility),
    /** The deck's share link, `#/d/<shareKey>`: made the first time it's shared, then kept. */
    shareKey: v.optional(v.string()),
    /** The deck's colors as the owner's client worked them out (WUBRG letters, "" colorless), for the color filter. */
    colors: v.optional(v.string()),
    /** Public decks: name and author, for the deck search's name box. */
    searchText: v.optional(v.string()),
    /** Public decks: the commanders' names, for the deck search's commander box. */
    commanderText: v.optional(v.string()),
    /** The author's username when the deck was last saved or shared, shown on it. */
    author: v.optional(v.string()),
    likes: v.optional(v.number()),
    views: v.optional(v.number()),
    comments: v.optional(v.number()),
    /** The owner turned comments off: none can be added, and the ones there are hidden. */
    commentsOff: v.optional(v.boolean()),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_share_key", ["shareKey"])
    .index("by_visibility_updated", ["visibility", "updatedAt"])
    .index("by_visibility_likes", ["visibility", "likes"])
    .index("by_visibility_views", ["visibility", "views"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["visibility"] })
    .searchIndex("search_commander", { searchField: "commanderText", filterFields: ["visibility"] }),

  /** Public decks' cards, one row per card name (convex/sharing.ts), for searching decks by card. */
  deckCardIndex: defineTable({
    deckId: v.id("decks"),
    key: v.string(),
  })
    .index("by_key", ["key", "deckId"])
    .index("by_deck", ["deckId"]),

  /** Who liked which shared deck (convex/social.ts). The deck keeps the count. */
  deckLikes: defineTable({
    deckId: v.id("decks"),
    userId: v.id("users"),
  })
    .index("by_deck_user", ["deckId", "userId"])
    .index("by_user", ["userId"]),

  /** Shared decks players keep in their favorites (convex/social.ts). */
  deckFavorites: defineTable({
    deckId: v.id("decks"),
    userId: v.id("users"),
    at: v.number(),
  })
    .index("by_user_at", ["userId", "at"])
    .index("by_deck_user", ["deckId", "userId"]),

  /** Recent views of shared decks, so each viewer counts once a day (convex/social.ts). Forgotten after two days. */
  deckViews: defineTable({
    deckId: v.id("decks"),
    /** The signed-in viewer's user id, or the browser's own random id. */
    viewer: v.string(),
    day: v.number(),
    at: v.number(),
  })
    .index("by_deck_viewer_day", ["deckId", "viewer", "day"])
    .index("by_deck", ["deckId"])
    .index("by_at", ["at"]),

  /**
   * A deck's changelog (convex/changelog.ts): each entry is one sitting's edits, kept open while
   * they keep coming and closed after an hour without one. Card changes are net: a card added and
   * taken out again in the same sitting doesn't show.
   */
  deckChanges: defineTable({
    deckId: v.id("decks"),
    startedAt: v.number(),
    /** The last edit in this entry. */
    at: v.number(),
    /** Net copies added (+) or taken out (-), by card and board. */
    cards: v.array(v.object({ name: v.string(), board, delta: v.number() })),
    /** Other changes: name, format, bracket, as "from → to" by what changed. */
    fields: v.optional(v.array(v.object({ field: v.string(), from: v.string(), to: v.string() }))),
    /** The deck was made in this entry (with these cards). */
    created: v.optional(v.boolean()),
  }).index("by_deck_at", ["deckId", "at"]),

  /** Comments on shared decks, and replies to them (convex/social.ts). */
  deckComments: defineTable({
    deckId: v.id("decks"),
    /** Absent once the comment is deleted but kept for the replies under it. */
    userId: v.optional(v.id("users")),
    /** The comment this one replies to; absent for a comment on the deck itself. */
    parentId: v.optional(v.id("deckComments")),
    body: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    /** Deleted, but replies hang off it, so it stays as "deleted". */
    deleted: v.optional(v.boolean()),
  })
    .index("by_deck_created", ["deckId", "createdAt"])
    .index("by_parent", ["parentId"])
    .index("by_user_created", ["userId", "createdAt"]),

  /** Folders players sort their decks into (convex/folders.ts). Deleting one leaves its decks unfiled. */
  deckFolders: defineTable({
    userId: v.id("users"),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  /** Sets of cards players keep to add to decks (convex/packages.ts). */
  packages: defineTable({
    userId: v.id("users"),
    name: v.string(),
    /** What it's for, in the player's words. */
    note: v.optional(v.string()),
    cards: v.array(deckCard),
    groupBy: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user_updated", ["userId", "updatedAt"]),

  /** Each deck's combos from Commander Spellbook, for the cards `key` stands for (convex/combos.ts). */
  deckCombos: defineTable({
    deckId: v.id("decks"),
    key: v.string(),
    combos: v.array(spellbookCombo),
    near: v.array(nearCombo),
    at: v.number(),
  }).index("by_deck", ["deckId"]),

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

  /**
   * A multiplayer table (convex/tables.ts, docs/tables.md): people gather here, pick decks and
   * start a game together. The host is whoever created it, or whoever took over when they left.
   * Deleted once the last player leaves.
   */
  tables: defineTable({
    name: v.string(),
    hostId: v.id("users"),
    /** The invite code (`#/join/<code>`); the host can replace it, which retires the old link. */
    code: v.string(),
    status: v.union(v.literal("open"), v.literal("playing")),
    seats: v.number(),
    fillWithAI: v.boolean(),
    freePlay: v.boolean(),
    rewind: v.number(),
    /** While playing: the secret the game server fetches the roster with (http.ts). */
    gameKey: v.optional(v.string()),
    /** Players the host removed: the invite link doesn't let them back in. */
    kicked: v.array(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_game_key", ["gameKey"])
    .index("by_updated", ["updatedAt"]),

  /** A player at a table. A player sits at one table at a time. */
  tableSeats: defineTable({
    tableId: v.id("tables"),
    userId: v.id("users"),
    /** Their display name when they sat down (users.me's `name`). */
    name: v.string(),
    deckId: v.optional(v.id("decks")),
    deckName: v.optional(v.string()),
    commanders: v.optional(v.array(v.string())),
    ready: v.boolean(),
    joinedAt: v.number(),
    /** Last check-in from their table or game page (tables.heartbeat). */
    lastSeen: v.number(),
  })
    .index("by_table", ["tableId", "joinedAt"])
    .index("by_user", ["userId"]),

  /** Per-user settings (convex/settings.ts). One row per user; absent = the defaults. */
  settings: defineTable({
    userId: v.id("users"),
    /** Game hotkeys that differ from the defaults, action → key name (src/game/hotkeys.ts). */
    hotkeys: v.record(v.string(), v.string()),
    /** Added to every deck search, e.g. "order:cmc game:paper" (src/searchquery.ts). */
    searchAdditions: v.optional(v.string()),
    /** The printing cards get when you don't pick one (src/printings.ts); absent = Scryfall's default. */
    printingPref: v.optional(v.string()),
  }).index("by_user", ["userId"]),
});
