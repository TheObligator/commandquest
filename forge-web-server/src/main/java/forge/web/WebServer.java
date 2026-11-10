package forge.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.ForbiddenResponse;
import io.javalin.http.staticfiles.Location;
import io.javalin.json.JavalinJackson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.tinylog.Logger;

/**
 * Entry point for the Forge web (game) server. It only runs live games. Accounts, decks and stop
 * presets live in Convex (see docs/web-dev.md), so the site keeps working while this server is down.
 *
 * <p>Endpoints:
 * <ul>
 *   <li>{@code GET /health} — liveness check</li>
 *   <li>{@code WS  /ws} — the game socket (docs/game-protocol.md, {@link GameHub})</li>
 * </ul>
 *
 * <p>Environment: {@code PORT} (default 8080), {@code WEB_DIST} (also serve the built frontend
 * from this directory), {@code ALLOWED_ORIGINS} (comma-separated site origins that may open the
 * WebSocket and read {@code /health}; unset allows any, for local dev), {@code GIT_SHA} (reported
 * by {@code /health}), {@code CONVEX_ISSUERS} (Convex deployments whose sign-ins are accepted),
 * {@code MAX_GAMES} (simultaneous games, default 4), {@code FORGE_ASSETS} (upstream forge-gui dir).
 */
public final class WebServer {

    public static final int DEFAULT_PORT = 8080;

    private WebServer() {
    }

    /**
     * Settings that differ between production, dev and tests.
     *
     * @param allowedOrigins site origins allowed to use the server from a browser; empty allows any
     * @param version reported by /health, so the site can tell which build is running
     */
    public record Options(Path webDist, Set<String> allowedOrigins, String version, ConvexAuth auth, int maxGames) {
        public Options(Path webDist) {
            this(webDist, Set.of(), null);
        }

        public Options(Path webDist, Set<String> allowedOrigins, String version) {
            this(webDist, allowedOrigins, version, null, 4);
        }

        boolean allows(String origin) {
            return allowedOrigins.isEmpty() || (origin != null && allowedOrigins.contains(origin));
        }
    }

    public static Javalin create(Options opts) {
        ObjectMapper mapper = new ObjectMapper();
        GameHub hub = new GameHub(opts.auth() != null ? opts.auth() : ConvexAuth.fromEnv(), opts.maxGames());
        return Javalin.create(config -> {
            config.startup.showJavalinBanner = false;
            config.jsonMapper(new JavalinJackson(mapper, false));
            if (opts.webDist() != null) {
                config.staticFiles.add(opts.webDist().toAbsolutePath().toString(), Location.EXTERNAL);
            }
            // The site lives on another origin (commandquest.app) than this server
            // (game.commandquest.app), so /health needs CORS. Browsers don't apply CORS to
            // WebSockets, so the upgrade checks Origin itself: another site can't open a socket
            // with a visitor's browser.
            config.routes.get("/health", ctx -> {
                String origin = ctx.header("Origin");
                if (origin != null && opts.allows(origin)) {
                    ctx.header("Access-Control-Allow-Origin", opts.allowedOrigins().isEmpty() ? "*" : origin);
                    ctx.header("Vary", "Origin");
                }
                Map<String, String> body = new LinkedHashMap<>();
                body.put("status", "ok");
                if (opts.version() != null) {
                    body.put("version", opts.version());
                }
                ctx.json(body);
            });
            config.routes.wsBeforeUpgrade("/ws", ctx -> {
                if (!opts.allows(ctx.header("Origin"))) {
                    throw new ForbiddenResponse("Origin not allowed");
                }
            });
            config.routes.ws("/ws", ws -> {
                ws.onConnect(ctx -> {
                    ctx.enableAutomaticPings();
                    hub.onConnect(ctx);
                });
                ws.onMessage(ctx -> hub.onMessage(ctx, ctx.message()));
                ws.onClose(hub::onClose);
            });
        });
    }

    /** Starts Forge in the background so the first game doesn't wait ~5 s for the card index. */
    private static void warmUp(Javalin app) {
        Thread t = new Thread(() -> {
            try {
                forge.web.engine.ForgeEngine.start();
            } catch (RuntimeException e) {
                Logger.error(e, "Forge engine failed to start");
            }
        }, "forge-warmup");
        t.setDaemon(true);
        t.start();
    }

    private static String env(String name) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? null : v.trim();
    }

    public static void main(String[] args) {
        int port = env("PORT") != null ? Integer.parseInt(env("PORT")) : DEFAULT_PORT;
        Path dist = env("WEB_DIST") != null ? Path.of(env("WEB_DIST")) : null;
        if (dist != null && !Files.isDirectory(dist)) {
            Logger.warn("WEB_DIST {} is not a directory; not serving the frontend", dist);
            dist = null;
        }
        Set<String> origins = env("ALLOWED_ORIGINS") == null ? Set.of()
                : Arrays.stream(env("ALLOWED_ORIGINS").split(",")).map(String::trim)
                        .filter(o -> !o.isEmpty()).collect(Collectors.toUnmodifiableSet());
        if (origins.isEmpty()) {
            Logger.warn("ALLOWED_ORIGINS is unset: any website may connect (fine for local dev only)");
        }
        int maxGames = env("MAX_GAMES") != null ? Integer.parseInt(env("MAX_GAMES")) : 4;
        Javalin app = create(new Options(dist, origins, env("GIT_SHA"), ConvexAuth.fromEnv(), maxGames));
        app.start(port);
        warmUp(app);
    }
}
