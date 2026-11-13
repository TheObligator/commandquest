import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { decodeBase64Url, MAX_REPLAY_BYTES, parseReplayMeta, ReplayError, sameSecret } from "./model/replays";

const http = httpRouter();
auth.addHttpRoutes(http); // OAuth callbacks

/**
 * The game server sends a finished game's replay here (docs/replays.md): the gzipped file as the
 * body, its description in X-Replay-Meta (base64url JSON), authenticated with REPLAY_SECRET.
 */
http.route({
  path: "/replays",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.REPLAY_SECRET;
    if (!secret || !sameSecret(req.headers.get("Authorization"), `Bearer ${secret}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    let meta;
    try {
      meta = parseReplayMeta(JSON.parse(decodeBase64Url(req.headers.get("X-Replay-Meta") ?? "")));
    } catch (e) {
      return new Response(e instanceof ReplayError ? e.message : "Bad replay description", { status: 400 });
    }
    const blob = await req.blob();
    if (blob.size === 0 || blob.size > MAX_REPLAY_BYTES) {
      return new Response("Replay file missing or too big", { status: 413 });
    }
    const storageId = await ctx.storage.store(new Blob([blob], { type: "application/gzip" }));
    await ctx.runMutation(internal.replays.add, { storageId, size: blob.size, ...meta });
    return new Response("ok");
  }),
});

export default http;
