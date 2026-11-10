package forge.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import io.javalin.json.JavalinJackson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.tinylog.Logger;

/**
 * Entry point for the Forge web (game) server. It only runs live games. Accounts, decks and stop
 * presets live in Convex (see docs/web-dev.md), so the site keeps working while this server is down.
 *
 * <p>Endpoints:
 * <ul>
 *   <li>{@code GET /health} — liveness check</li>
 *   <li>{@code WS  /ws} — WebSocket that currently echoes every text message back (placeholder
 *       for the game protocol)</li>
 * </ul>
 *
 * <p>Environment: {@code PORT} (default 8080), {@code WEB_DIST} (also serve the built frontend
 * from this directory).
 */
public final class WebServer {

    public static final int DEFAULT_PORT = 8080;

    private WebServer() {
    }

    /** Settings that differ between production, dev and tests. */
    public record Options(Path webDist) {
    }

    public static Javalin create(Options opts) {
        ObjectMapper mapper = new ObjectMapper();
        return Javalin.create(config -> {
            config.startup.showJavalinBanner = false;
            config.jsonMapper(new JavalinJackson(mapper, false));
            if (opts.webDist() != null) {
                config.staticFiles.add(opts.webDist().toAbsolutePath().toString(), Location.EXTERNAL);
            }
            config.routes.get("/health", ctx -> ctx.json(Map.of("status", "ok")));
            config.routes.ws("/ws", ws -> {
                ws.onConnect(ctx -> ctx.enableAutomaticPings());
                ws.onMessage(ctx -> ctx.send(ctx.message()));
            });
        });
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
        create(new Options(dist)).start(port);
    }
}
