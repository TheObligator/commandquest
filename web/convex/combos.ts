import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { deckKey, played, type NearCombo, type SpellbookCombo } from "../src/game/spellbook";
import { hasCommander } from "../src/deckFormats";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { MAX_COMBOS, MAX_NEAR, parseCombos } from "./model/spellbook";
import { nearCombo, spellbookCombo } from "./schema";

// A deck's combos, from Commander Spellbook (commanderspellbook.com), credited wherever they show.
// Looked up for one deck at a time when its cards have changed, and stored with that deck; we keep no
// copy of their database. Their API asks for few requests and a named User-Agent.
const API = "https://backend.commanderspellbook.com/find-my-combos?limit=500&ordering=-popularity";
const MAX_PAGES = 3;
/** Looked up again after this long, for new combos. */
const STALE_MS = 30 * 24 * 3600 * 1000;
/** The same deck isn't looked up more often than this, whatever changes. */
const WAIT_MS = 10_000;

/** The combos stored with one of your decks, or null (none looked up, not yours, signed out). */
export const forDeck = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const deckId = ctx.db.normalizeId("decks", id);
    const deck = userId && deckId ? await ctx.db.get(deckId) : null;
    if (!deck || deck.userId !== userId) return null;
    const row = await ctx.db.query("deckCombos").withIndex("by_deck", (q) => q.eq("deckId", deck._id)).unique();
    return row && { key: row.key, combos: row.combos, near: row.near };
  },
});

export const deckToLookUp = internalQuery({
  args: { id: v.id("decks"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    const deck = await ctx.db.get(id);
    if (!deck || deck.userId !== userId || !hasCommander(deck.format)) return null;
    const row = await ctx.db.query("deckCombos").withIndex("by_deck", (q) => q.eq("deckId", id)).unique();
    const key = deckKey(deck.cards);
    const age = row ? Date.now() - row.at : Infinity;
    if (row && row.key === key && age < STALE_MS) return null;
    if (age < WAIT_MS) return "wait" as const;
    const { commanders, main } = played(deck.cards);
    return { key, commanders: commanders.map((c) => ({ card: c.name, quantity: c.quantity })), main: main.map((c) => ({ card: c.name, quantity: c.quantity })) };
  },
});

export const store = internalMutation({
  args: { deckId: v.id("decks"), key: v.string(), combos: v.array(spellbookCombo), near: v.array(nearCombo) },
  handler: async (ctx, { deckId, key, combos, near }) => {
    if (!(await ctx.db.get(deckId))) return; // deleted meanwhile
    const row = await ctx.db.query("deckCombos").withIndex("by_deck", (q) => q.eq("deckId", deckId)).unique();
    const value = { deckId, key, combos, near, at: Date.now() };
    if (row) await ctx.db.replace(row._id, value);
    else await ctx.db.insert("deckCombos", value);
  },
});

/**
 * Looks the deck's combos up if its cards have changed since last time. Only the card names are sent.
 * "wait": it was just looked up; ask again in a moment.
 */
export const lookUp = action({
  args: { id: v.id("decks") },
  handler: async (ctx, { id }): Promise<"done" | "wait"> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first.");
    type Cards = { card: string; quantity: number }[];
    const deck: { key: string; commanders: Cards; main: Cards } | "wait" | null = await ctx.runQuery(internal.combos.deckToLookUp, { id, userId });
    if (deck === "wait") return "wait";
    if (!deck) return "done";
    const names = [...deck.commanders, ...deck.main].map((c) => c.card);
    const combos: SpellbookCombo[] = [];
    const near: NearCombo[] = [];
    if (names.length) {
      const body = JSON.stringify({ commanders: deck.commanders.slice(0, 12), main: deck.main.slice(0, 600) });
      for (let page = 0; page < MAX_PAGES; page++) {
        let res: Response;
        try {
          res = await fetch(page ? `${API}&offset=${page * 500}` : API, {
            method: "POST",
            headers: { "User-Agent": "CommandQuest/1.0", Accept: "application/json", "Content-Type": "application/json" },
            body,
          });
        } catch {
          throw new ConvexError("Couldn't reach Commander Spellbook.");
        }
        if (!res.ok) throw new ConvexError(res.status === 429 ? "Commander Spellbook is busy. Try again in a minute." : `Commander Spellbook returned an error (${res.status}).`);
        let got: ReturnType<typeof parseCombos>;
        try {
          got = parseCombos(await res.json(), names);
        } catch {
          throw new ConvexError("Commander Spellbook sent something unexpected.");
        }
        combos.push(...got.combos);
        near.push(...got.near);
        if (!got.more) break;
      }
    }
    await ctx.runMutation(internal.combos.store, { deckId: id as Id<"decks">, key: deck.key, combos: combos.slice(0, MAX_COMBOS), near: near.slice(0, MAX_NEAR) });
    return "done";
  },
});
