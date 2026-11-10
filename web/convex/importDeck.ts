import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { deckSource, parseArchidekt, parseMoxfield, type ImportedDeck } from "./model/importers";

/**
 * Fetches a public Moxfield or Archidekt deck. Runs on Convex because those APIs don't allow
 * browser (CORS) requests. Moxfield sometimes blocks unknown clients. Moxfield hands out approved
 * User-Agent strings on request: set it as the MOXFIELD_USER_AGENT environment variable.
 */
export const fromUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<ImportedDeck> => {
    if (!(await getAuthUserId(ctx))) throw new ConvexError("Sign in first.");
    const src = deckSource(url);
    if (!src) throw new ConvexError("Paste a Moxfield or Archidekt deck link, or paste the decklist as text.");
    const site = src.site === "moxfield" ? "Moxfield" : "Archidekt";
    const ua = (src.site === "moxfield" && process.env.MOXFIELD_USER_AGENT) || "CommandQuest/0.1 (deck import)";

    let res: Response;
    try {
      res = await fetch(src.apiUrl, { headers: { "User-Agent": ua, Accept: "application/json" }, redirect: "error" });
    } catch {
      throw new ConvexError(`Couldn't reach ${site}. Try again, or paste the decklist as text.`);
    }
    if (res.status === 404) throw new ConvexError(`That deck wasn't found on ${site}. Is it public?`);
    if (res.status === 401 || res.status === 403) {
      throw new ConvexError(`${site} refused the request (it blocks automated imports). Export the deck as text on ${site} and paste it here instead.`);
    }
    if (!res.ok) throw new ConvexError(`${site} returned an error (${res.status}). Try pasting the decklist as text.`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ConvexError(`${site} sent something unexpected. Try pasting the decklist as text.`);
    }
    return src.site === "moxfield" ? parseMoxfield(json) : parseArchidekt(json);
  },
});
