import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { displayName } from "../src/username";
import { summarize } from "./model/deckRules";
import { CARD_LIST } from "../src/deckFormats";
import {
  aiSeats,
  AWAY_MS,
  cantStart,
  checkSettings,
  defaultSettings,
  GAME_KEY_RE,
  IDLE_TABLE_MS,
  makeCode,
  makeGameKey,
  nextHost,
  parseCode,
  TableError,
  type TableSettings,
  type TableSettingsInput,
} from "./model/tables";

// Multiplayer tables (docs/tables.md). Someone creates a table and becomes its host; the host
// hands out the invite link (`#/join/<code>`); players sit down, pick decks and say they're ready;
// the host starts the game. When the host leaves, a random player still seated takes over, and
// the table is deleted once the last player leaves. The game itself runs on the game server,
// which reads the roster through http.ts with the table's game key.

async function requireUser(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  return userId;
}

function checked<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof TableError) throw new ConvexError(e.message);
    throw e;
  }
}

const settingsArgs = {
  name: v.optional(v.string()),
  seats: v.optional(v.number()),
  fillWithAI: v.optional(v.boolean()),
  freePlay: v.optional(v.boolean()),
  rewind: v.optional(v.number()),
};

function settingsOf(t: Doc<"tables">): TableSettings {
  return { name: t.name, seats: t.seats, fillWithAI: t.fillWithAI, freePlay: t.freePlay, rewind: t.rewind };
}

function seatsOf(ctx: QueryCtx, tableId: Id<"tables">) {
  return ctx.db.query("tableSeats").withIndex("by_table", (q) => q.eq("tableId", tableId)).collect();
}

async function mySeat(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db.query("tableSeats").withIndex("by_user", (q) => q.eq("userId", userId)).first();
}

/** A table the caller is seated at, and their seat; throws otherwise. */
async function seatedAt(ctx: QueryCtx, id: Id<"tables">) {
  const userId = await requireUser(ctx);
  const table = await ctx.db.get(id);
  const seat = await mySeat(ctx, userId);
  if (!table || !seat || seat.tableId !== id) throw new ConvexError("You're not at this table.");
  return { userId, table, seat };
}

async function hostOf(ctx: QueryCtx, id: Id<"tables">) {
  const at = await seatedAt(ctx, id);
  if (at.table.hostId !== at.userId) throw new ConvexError("Only the host can do that.");
  return at;
}

async function freshCode(ctx: QueryCtx): Promise<string> {
  for (;;) {
    const code = makeCode(crypto.getRandomValues(new Uint8Array(16)));
    if (!(await ctx.db.query("tables").withIndex("by_code", (q) => q.eq("code", code)).first())) return code;
  }
}

/**
 * Takes a seat away. If it was the host's, a random player still seated becomes host; if it was
 * the last seat, the table is deleted.
 */
async function removeSeat(ctx: MutationCtx, seat: Doc<"tableSeats">) {
  await ctx.db.delete(seat._id);
  const table = await ctx.db.get(seat.tableId);
  if (!table) return;
  const rest = await seatsOf(ctx, table._id);
  if (rest.length === 0) {
    await ctx.db.delete(table._id);
    return;
  }
  const patch: Partial<Doc<"tables">> = { updatedAt: Date.now() };
  if (table.hostId === seat.userId) patch.hostId = nextHost(rest, Math.random())!.userId;
  await ctx.db.patch(table._id, patch);
}

/** Before a game starts, players whose table page stopped checking in have left. */
async function sweepAway(ctx: MutationCtx, table: Doc<"tables">, except?: Id<"users">) {
  if (table.status !== "open") return;
  const now = Date.now();
  for (const s of await seatsOf(ctx, table._id)) {
    if (s.userId !== except && now - s.lastSeen > AWAY_MS) await removeSeat(ctx, s);
  }
}

/** Leaves whatever table you're at (you sit at one at a time). */
async function leaveCurrent(ctx: MutationCtx, userId: Id<"users">) {
  const seat = await mySeat(ctx, userId);
  if (seat) await removeSeat(ctx, seat);
}

async function sitDown(ctx: MutationCtx, tableId: Id<"tables">, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  const now = Date.now();
  await ctx.db.insert("tableSeats", { tableId, userId, name: displayName(user ?? {}), ready: false, joinedAt: now, lastSeen: now });
}

/** Opens a new table with you as its host (leaving the table you were at). Returns its id. */
export const create = mutation({
  args: settingsArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    const settings = checked(() => checkSettings(args, defaultSettings(displayName(user ?? {}))));
    await leaveCurrent(ctx, userId);
    const now = Date.now();
    const tableId = await ctx.db.insert("tables", {
      ...settings,
      hostId: userId,
      code: await freshCode(ctx),
      status: "open",
      kicked: [],
      createdAt: now,
      updatedAt: now,
    });
    await sitDown(ctx, tableId, userId);
    return tableId;
  },
});

/** Sits you at the table an invite code (or link) is for. Returns its id. */
export const join = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const code = parseCode(args.code);
    const table = code && (await ctx.db.query("tables").withIndex("by_code", (q) => q.eq("code", code)).first());
    if (!table) throw new ConvexError("This invite isn't valid any more. Ask the host for a new link.");
    const current = await mySeat(ctx, userId);
    if (current?.tableId === table._id) return table._id;
    if (table.kicked.includes(userId)) throw new ConvexError("The host removed you from this table.");
    if (table.status === "playing") throw new ConvexError("This table's game has already started. Try again when it's over.");
    await sweepAway(ctx, table);
    const seated = (await seatsOf(ctx, table._id)).length;
    if (seated >= table.seats) throw new ConvexError("This table is full.");
    if (current) await removeSeat(ctx, current);
    await sitDown(ctx, table._id, userId);
    await ctx.db.patch(table._id, { updatedAt: Date.now() });
    return table._id;
  },
});

/**
 * A table as one of its players sees it, or null if you aren't seated there (or it's gone). Only
 * the host gets the invite code; only seated players get the game key.
 */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const id = ctx.db.normalizeId("tables", args.id);
    const table = id && (await ctx.db.get(id));
    if (!userId || !table) return null;
    const seats = await seatsOf(ctx, table._id);
    const me = seats.find((s) => s.userId === userId);
    if (!me) return null;
    const host = table.hostId === userId;
    return {
      _id: table._id,
      ...settingsOf(table),
      status: table.status,
      isHost: host,
      code: host ? table.code : null,
      gameKey: table.status === "playing" ? (table.gameKey ?? null) : null,
      ai: aiSeats(seats.length, table),
      cantStart: cantStart(seats.map((s) => ({ userId: s.userId, deckId: s.deckId, ready: s.ready })), table.hostId, table),
      me: { deckId: me.deckId ?? null, ready: me.ready },
      /** Who's seated, in the order they sat down (`seats` is how many seats the table has). */
      players: seats.map((s) => ({
        userId: s.userId,
        name: s.name,
        deckName: s.deckName ?? null,
        commanders: s.commanders ?? [],
        ready: s.ready,
        host: s.userId === table.hostId,
        me: s.userId === userId,
        lastSeen: s.lastSeen,
      })),
    };
  },
});

/** The table you're at, if any (the Play page links back to it). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const seat = userId && (await mySeat(ctx, userId));
    const table = seat && (await ctx.db.get(seat.tableId));
    return table ? { _id: table._id, name: table.name, status: table.status } : null;
  },
});

export const leave = mutation({
  args: { id: v.id("tables") },
  handler: async (ctx, { id }) => {
    const { seat } = await seatedAt(ctx, id);
    await removeSeat(ctx, seat);
  },
});

/** The host removes a player; the invite link won't let them back. */
export const kick = mutation({
  args: { id: v.id("tables"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    const { table, userId: me } = await hostOf(ctx, id);
    if (userId === me) throw new ConvexError("Leave the table instead.");
    const seat = await mySeat(ctx, userId);
    if (!seat || seat.tableId !== id) throw new ConvexError("They're not at this table.");
    await ctx.db.patch(id, { kicked: [...table.kicked.filter((k) => k !== userId), userId] });
    await removeSeat(ctx, seat);
  },
});

/** The host hands the table to another player. */
export const makeHost = mutation({
  args: { id: v.id("tables"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    await hostOf(ctx, id);
    const seat = await mySeat(ctx, userId);
    if (!seat || seat.tableId !== id) throw new ConvexError("They're not at this table.");
    await ctx.db.patch(id, { hostId: userId, updatedAt: Date.now() });
  },
});

/** A new invite link; the old one stops working. */
export const newInvite = mutation({
  args: { id: v.id("tables") },
  handler: async (ctx, { id }) => {
    await hostOf(ctx, id);
    await ctx.db.patch(id, { code: await freshCode(ctx), updatedAt: Date.now() });
  },
});

export const update = mutation({
  args: { id: v.id("tables"), ...settingsArgs },
  handler: async (ctx, { id, ...args }) => {
    const { table } = await hostOf(ctx, id);
    if (table.status !== "open") throw new ConvexError("The game has started.");
    const seated = (await seatsOf(ctx, id)).length;
    const next = checked(() => checkSettings(args as TableSettingsInput, settingsOf(table), seated));
    // Changing the game under people who said they're ready: they have to say so again.
    const changed = next.freePlay !== table.freePlay || next.rewind !== table.rewind || next.seats !== table.seats || next.fillWithAI !== table.fillWithAI;
    await ctx.db.patch(id, { ...next, updatedAt: Date.now() });
    if (changed) for (const s of await seatsOf(ctx, id)) if (s.ready) await ctx.db.patch(s._id, { ready: false });
  },
});

/** Pick the deck you'll play (null: none). Picking a deck takes back "ready". */
export const setDeck = mutation({
  args: { id: v.id("tables"), deckId: v.union(v.id("decks"), v.null()) },
  handler: async (ctx, { id, deckId }) => {
    const { userId, table, seat } = await seatedAt(ctx, id);
    if (table.status !== "open") throw new ConvexError("The game has started.");
    if (!deckId) {
      await ctx.db.patch(seat._id, { deckId: undefined, deckName: undefined, commanders: undefined, ready: false });
      return;
    }
    const deck = await ctx.db.get(deckId);
    if (!deck || deck.userId !== userId) throw new ConvexError("Deck not found.");
    if (deck.format === CARD_LIST) throw new ConvexError("That's a card list, not a deck to play.");
    await ctx.db.patch(seat._id, { deckId, deckName: deck.name, commanders: summarize(deck.cards).commanders, ready: false });
  },
});

export const setReady = mutation({
  args: { id: v.id("tables"), ready: v.boolean() },
  handler: async (ctx, { id, ready }) => {
    const { table, seat } = await seatedAt(ctx, id);
    if (table.status !== "open") throw new ConvexError("The game has started.");
    if (ready && !seat.deckId) throw new ConvexError("Pick a deck first.");
    await ctx.db.patch(seat._id, { ready });
  },
});

/** The host starts the game: everyone's browser then joins it on the game server. */
export const start = mutation({
  args: { id: v.id("tables") },
  handler: async (ctx, { id }) => {
    const { table, userId } = await hostOf(ctx, id);
    if (table.status !== "open") throw new ConvexError("The game has already started.");
    await sweepAway(ctx, table, userId);
    const seats = await seatsOf(ctx, id);
    const why = cantStart(seats.map((s) => ({ userId: s.userId, deckId: s.deckId, ready: s.ready })), table.hostId, table);
    if (why) throw new ConvexError(why);
    await ctx.db.patch(id, { status: "playing", gameKey: makeGameKey(crypto.getRandomValues(new Uint8Array(16))), updatedAt: Date.now() });
  },
});

/**
 * The host takes the table back to the lobby while it's playing: the game never got going, or the
 * game server went away. (A game that ends normally comes back by itself, through `ended`.)
 */
export const backToLobby = mutation({
  args: { id: v.id("tables") },
  handler: async (ctx, { id }) => {
    const { table } = await hostOf(ctx, id);
    if (table.status === "playing") await reopen(ctx, table);
  },
});

async function reopen(ctx: MutationCtx, table: Doc<"tables">) {
  const now = Date.now();
  await ctx.db.patch(table._id, { status: "open", gameKey: undefined, updatedAt: now });
  // Ready again for the next game? Each player says so; and the away clock restarts.
  for (const s of await seatsOf(ctx, table._id)) await ctx.db.patch(s._id, { ready: false, lastSeen: now });
}

/** Your table or game page checks in (every 20 s), so players who closed it can be let go. */
export const heartbeat = mutation({
  args: { id: v.id("tables") },
  handler: async (ctx, { id }) => {
    const { userId, table, seat } = await seatedAt(ctx, id);
    await ctx.db.patch(seat._id, { lastSeen: Date.now() });
    await sweepAway(ctx, table, userId);
  },
});

/** For the game server (http.ts): who's playing the game this key started. */
export const roster = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    if (!GAME_KEY_RE.test(key)) return null;
    const table = await ctx.db.query("tables").withIndex("by_game_key", (q) => q.eq("gameKey", key)).first();
    if (!table || table.status !== "playing") return null;
    const seats = await seatsOf(ctx, table._id);
    return {
      table: table._id,
      name: table.name,
      players: seats.map((s) => ({ user: s.userId, name: s.name })),
      ai: aiSeats(seats.length, table),
      freePlay: table.freePlay,
      rewind: table.rewind,
    };
  },
});

/** For the game server (http.ts): the game this key started is over; back to the lobby. */
export const ended = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    if (!GAME_KEY_RE.test(key)) return false;
    const table = await ctx.db.query("tables").withIndex("by_game_key", (q) => q.eq("gameKey", key)).first();
    if (!table || table.status !== "playing") return false;
    await reopen(ctx, table);
    return true;
  },
});

/** Hourly (crons.ts): tables nobody has touched for hours are closed. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("tables").withIndex("by_updated", (q) => q.lt("updatedAt", Date.now() - IDLE_TABLE_MS)).take(100);
    for (const t of old) {
      const seats = await seatsOf(ctx, t._id);
      // Still in use: someone's page checked in lately (a long game keeps the table untouched).
      if (seats.some((s) => Date.now() - s.lastSeen < IDLE_TABLE_MS)) {
        await ctx.db.patch(t._id, { updatedAt: Date.now() });
        continue;
      }
      for (const s of seats) await ctx.db.delete(s._id);
      await ctx.db.delete(t._id);
    }
  },
});
