// Sharing decks: visibility, share links, the shared deck page, copying a shared deck, and the deck
// search (Decks → Browse). Rules in convex/model/sharing.ts.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { DeckError, MAX_DECKS_PER_USER, summarize, validateDeck } from "./model/deckRules";
import {
  cardKey,
  cleanColors,
  commanderText,
  deckCardKeys,
  deckMatches,
  isShared,
  keyDiff,
  makeShareKey,
  MAX_SEARCH_CARDS,
  MAX_SEARCH_TEXT,
  searchText,
  SHARE_KEY_RE,
  visibilityOf,
  type DeckFilter,
} from "./model/sharing";
import { recordChange } from "./changelog";
import { visibility } from "./schema";

export const newShareKey = () => makeShareKey(crypto.getRandomValues(new Uint8Array(16)));

/** The username shown on a user's shared decks; absent when they haven't picked one (never their sign-in name). */
async function authorOf(ctx: QueryCtx, userId: Id<"users">): Promise<string | undefined> {
  return (await ctx.db.get(userId))?.username;
}

/**
 * Brings a deck's search fields and card index in line with the deck, after any change to it. Only
 * public decks are searchable: the others have neither.
 */
export async function refreshSharing(ctx: MutationCtx, deckId: Id<"decks">) {
  const deck = await ctx.db.get(deckId);
  if (!deck) return;
  const isPublic = visibilityOf(deck.visibility) === "public";
  const author = isShared(deck.visibility) ? await authorOf(ctx, deck.userId) : deck.author;
  const want = isPublic ? deckCardKeys(deck.cards) : [];
  const rows = await ctx.db.query("deckCardIndex").withIndex("by_deck", (q) => q.eq("deckId", deckId)).collect();
  const { add, remove } = keyDiff(rows.map((r) => r.key), want);
  const removing = new Set(remove);
  for (const r of rows) if (removing.has(r.key)) await ctx.db.delete(r._id);
  for (const key of add) await ctx.db.insert("deckCardIndex", { deckId, key });
  const fields = {
    author,
    searchText: isPublic ? searchText(deck.name, author) : undefined,
    commanderText: isPublic ? commanderText(deck.cards) || undefined : undefined,
  };
  if (fields.author !== deck.author || fields.searchText !== deck.searchText || fields.commanderText !== deck.commanderText) {
    await ctx.db.patch(deckId, fields);
  }
}

async function ownDeck(ctx: MutationCtx, id: Id<"decks">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  const deck = await ctx.db.get(id);
  if (!deck || deck.userId !== userId) throw new ConvexError("Deck not found.");
  return deck;
}

/** Makes one of your decks public, unlisted or private. Returns its share key. */
export const setVisibility = mutation({
  args: { id: v.id("decks"), visibility, colors: v.optional(v.string()) },
  handler: async (ctx, { id, visibility, colors }) => {
    const deck = await ownDeck(ctx, id);
    const shareKey = deck.shareKey ?? newShareKey();
    const c = cleanColors(colors);
    // Not an edit to the deck, so `updatedAt` (the deck list's order) stays put.
    await ctx.db.patch(id, { visibility, shareKey, ...(c !== undefined ? { colors: c } : {}) });
    await refreshSharing(ctx, id);
    return shareKey;
  },
});

/** Turns comments on one of your decks off (hiding the ones there) or back on. */
export const setCommentsOff = mutation({
  args: { id: v.id("decks"), off: v.boolean() },
  handler: async (ctx, { id, off }) => {
    await ownDeck(ctx, id);
    await ctx.db.patch(id, { commentsOff: off || undefined });
  },
});

/** A deck by its share link, if the viewer may see it. */
export async function sharedDeck(ctx: QueryCtx, key: string): Promise<{ deck: Doc<"decks">; userId: Id<"users"> | null; owner: boolean } | null> {
  if (!SHARE_KEY_RE.test(key)) return null;
  const deck = await ctx.db.query("decks").withIndex("by_share_key", (q) => q.eq("shareKey", key)).unique();
  if (!deck) return null;
  const userId = await getAuthUserId(ctx);
  const owner = deck.userId === userId;
  if (!owner && !isShared(deck.visibility)) return null;
  return { deck, userId, owner };
}

/**
 * The shared deck page (`#/d/<key>`): the deck, if it's public or unlisted (or yours), else null.
 * Settings saved with the deck for games (auto-yields, use later) and its folder stay private.
 */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const found = await sharedDeck(ctx, key);
    if (!found) return null;
    const { deck: d, userId, owner } = found;
    const mark = async (table: "deckLikes" | "deckFavorites") =>
      !!userId && !!(await ctx.db.query(table).withIndex("by_deck_user", (q) => q.eq("deckId", d._id).eq("userId", userId)).unique());
    return {
      key,
      deckId: owner ? d._id : undefined,
      owner,
      name: d.name,
      format: d.format,
      cards: d.cards,
      extraColor: d.extraColor,
      bracket: d.bracket,
      bracketTags: d.bracketTags,
      description: d.description,
      tokenArt: d.tokenArt,
      groupBy: d.groupBy,
      colors: d.colors,
      visibility: visibilityOf(d.visibility),
      author: owner ? d.author ?? (await authorOf(ctx, d.userId)) : d.author,
      updatedAt: d.updatedAt,
      likes: d.likes ?? 0,
      views: d.views ?? 0,
      comments: d.comments ?? 0,
      commentsOff: !!d.commentsOff,
      liked: await mark("deckLikes"),
      favorited: await mark("deckFavorites"),
      signedIn: !!userId,
    };
  },
});

/** Copies a shared deck into your decks. Returns the copy's id. */
export const copy = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const found = await sharedDeck(ctx, key);
    if (!found) throw new ConvexError("This deck isn't shared any more.");
    const { deck: d, userId } = found;
    if (!userId) throw new ConvexError("Sign in first.");
    const count = (await ctx.db.query("decks").withIndex("by_user_updated", (q) => q.eq("userId", userId)).take(MAX_DECKS_PER_USER)).length;
    if (count >= MAX_DECKS_PER_USER) throw new ConvexError(`You can save up to ${MAX_DECKS_PER_USER} decks.`);
    let checked;
    try {
      checked = validateDeck({ name: d.name, format: d.format, cards: d.cards, extraColor: d.extraColor, bracket: d.bracket, bracketTags: d.bracketTags });
    } catch (e) {
      if (e instanceof DeckError) throw new ConvexError(e.message);
      throw e;
    }
    const now = Date.now();
    const id = await ctx.db.insert("decks", {
      userId,
      ...checked,
      ...(d.description ? { description: d.description } : {}),
      ...(d.tokenArt ? { tokenArt: d.tokenArt } : {}),
      ...(d.groupBy ? { groupBy: d.groupBy } : {}),
      ...(d.colors !== undefined ? { colors: d.colors } : {}),
      visibility: "public",
      shareKey: newShareKey(),
      updatedAt: now,
    });
    await recordChange(ctx, id, null, { name: checked.name, format: checked.format, bracket: checked.bracket, cards: checked.cards }, now);
    await refreshSharing(ctx, id);
    return id;
  },
});

// ---- Search ----

/** The most decks the search looks through for one query (each is read whole to filter it). */
const CANDIDATES = 300;
export const MAX_RESULTS = 120;

const sortKey = v.union(v.literal("updated"), v.literal("likes"), v.literal("views"), v.literal("name"));

/** A deck as the search results show it. */
function tile(d: Doc<"decks">) {
  const s = summarize(d.cards);
  return {
    key: d.shareKey!,
    name: d.name,
    format: d.format,
    commanders: s.commanders,
    cardCount: s.cardCount,
    coverScryfallId: s.coverScryfallId,
    colors: d.colors,
    extraColor: d.extraColor,
    bracket: d.bracket,
    author: d.author,
    likes: d.likes ?? 0,
    views: d.views ?? 0,
    comments: d.commentsOff ? 0 : d.comments ?? 0,
    updatedAt: d.updatedAt,
    visibility: visibilityOf(d.visibility),
  };
}

/**
 * Public decks (or your favorites) matching every filter that's set: name or author, commander,
 * cards (all of them), format, colors, bracket. Returns up to `limit` and whether there are more.
 */
export const search = query({
  args: {
    text: v.optional(v.string()),
    commander: v.optional(v.string()),
    cards: v.optional(v.array(v.string())),
    format: v.optional(v.string()),
    colors: v.optional(v.string()),
    colorMatch: v.optional(v.union(v.literal("exact"), v.literal("including"), v.literal("within"))),
    bracket: v.optional(v.number()),
    favorites: v.optional(v.boolean()),
    sort: v.optional(sortKey),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const filter: DeckFilter = {
      text: args.text?.slice(0, MAX_SEARCH_TEXT).trim() || undefined,
      commander: args.commander?.slice(0, MAX_SEARCH_TEXT).trim() || undefined,
      cards: (args.cards ?? []).map((c) => c.slice(0, 200)).filter((c) => c.trim()).slice(0, MAX_SEARCH_CARDS),
      format: args.format || undefined,
      colors: args.colors === undefined ? undefined : cleanColors(args.colors),
      colorMatch: args.colorMatch,
      bracket: args.bracket || undefined,
    };
    const limit = Math.max(1, Math.min(MAX_RESULTS, Math.floor(args.limit ?? 48)));
    const sort = args.sort ?? "updated";
    const userId = await getAuthUserId(ctx);

    let candidates: Doc<"decks">[];
    let more = false;
    if (args.favorites) {
      if (!userId) return { decks: [], more: false };
      const favs = await ctx.db.query("deckFavorites").withIndex("by_user_at", (q) => q.eq("userId", userId)).order("desc").take(CANDIDATES);
      const decks = await Promise.all(favs.map((f) => ctx.db.get(f.deckId)));
      candidates = decks.filter((d): d is Doc<"decks"> => !!d && (isShared(d.visibility) || d.userId === userId) && !!d.shareKey);
    } else if (filter.cards!.length) {
      const [first, ...rest] = filter.cards!.map(cardKey);
      const rows = await ctx.db.query("deckCardIndex").withIndex("by_key", (q) => q.eq("key", first)).take(CANDIDATES + 1);
      more = rows.length > CANDIDATES;
      const ids: Id<"decks">[] = [];
      for (const r of rows.slice(0, CANDIDATES)) {
        let all = true;
        for (const k of rest) {
          if (!(await ctx.db.query("deckCardIndex").withIndex("by_key", (q) => q.eq("key", k).eq("deckId", r.deckId)).first())) {
            all = false;
            break;
          }
        }
        if (all) ids.push(r.deckId);
      }
      candidates = (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((d): d is Doc<"decks"> => !!d);
    } else if (filter.commander) {
      candidates = await ctx.db
        .query("decks")
        .withSearchIndex("search_commander", (q) => q.search("commanderText", filter.commander!).eq("visibility", "public"))
        .take(CANDIDATES);
    } else if (filter.text) {
      candidates = await ctx.db
        .query("decks")
        .withSearchIndex("search_text", (q) => q.search("searchText", filter.text!).eq("visibility", "public"))
        .take(CANDIDATES);
    } else {
      const index = sort === "likes" ? "by_visibility_likes" : sort === "views" ? "by_visibility_views" : "by_visibility_updated";
      candidates = await ctx.db.query("decks").withIndex(index, (q) => q.eq("visibility", "public")).order("desc").take(CANDIDATES + 1);
      more = candidates.length > CANDIDATES;
      candidates = candidates.slice(0, CANDIDATES);
    }

    const matched = candidates.filter((d) => (args.favorites || visibilityOf(d.visibility) === "public") && deckMatches(d, filter));
    const by = {
      updated: (a: Doc<"decks">, b: Doc<"decks">) => b.updatedAt - a.updatedAt,
      likes: (a: Doc<"decks">, b: Doc<"decks">) => (b.likes ?? 0) - (a.likes ?? 0) || b.updatedAt - a.updatedAt,
      views: (a: Doc<"decks">, b: Doc<"decks">) => (b.views ?? 0) - (a.views ?? 0) || b.updatedAt - a.updatedAt,
      name: (a: Doc<"decks">, b: Doc<"decks">) => a.name.localeCompare(b.name),
    }[sort];
    matched.sort(by);
    return { decks: matched.slice(0, limit).map(tile), more: more || matched.length > limit };
  },
});

/** Your favorite decks' share keys, to mark them in the search results. */
export const favoriteKeys = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const favs = await ctx.db.query("deckFavorites").withIndex("by_user_at", (q) => q.eq("userId", userId)).take(1000);
    const decks = await Promise.all(favs.map((f) => ctx.db.get(f.deckId)));
    return decks.flatMap((d) => (d?.shareKey ? [d.shareKey] : []));
  },
});

/** After a username change: the author shown on the user's decks follows. */
export async function refreshAuthor(ctx: MutationCtx, userId: Id<"users">) {
  for (const d of await ctx.db.query("decks").withIndex("by_user_updated", (q) => q.eq("userId", userId)).take(MAX_DECKS_PER_USER)) {
    if (isShared(d.visibility) || d.author !== undefined) await refreshSharing(ctx, d._id);
  }
}
