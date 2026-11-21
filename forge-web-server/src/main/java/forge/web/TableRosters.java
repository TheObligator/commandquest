package forge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.tinylog.Logger;

/**
 * Who's playing a multiplayer table's game (docs/tables.md), from the Convex deployment the table
 * lives on: {@code GET <issuer>/tables/roster?key=<game key>}. The game key is the secret: Convex
 * gives it only to the table's players, who hand it to this server. When the game ends, {@code POST
 * <issuer>/tables/ended?key=} sends the table back to its lobby.
 */
public interface TableRosters {

    /** A player at the table: their Convex user id (without the issuer) and display name. */
    record Player(String user, String name) {}

    /** The game a table started: its players, how many AI seats, and the table's settings. */
    record Roster(String tableName, List<Player> players, int ai, boolean freePlay, int rewind) {
        public Roster {
            players = List.copyOf(players);
        }
    }

    /** The roster for this key on this Convex deployment, or null if there's no such game. */
    Roster fetch(String issuer, String key) throws Exception;

    /** The game is over (best effort). */
    void ended(String issuer, String key);

    /**
     * Talks to Convex over HTTP. Convex now and then answers a request with a 5xx (e.g. 503) that's
     * gone a few seconds later, so a failed roster fetch is tried again a few times before the
     * player is told.
     */
    final class Http implements TableRosters {
        /** Waits before each retry of a roster fetch that failed with a 5xx or a network error. */
        static final long[] RETRY_MS = {1_000, 2_000, 4_000};

        private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        private final ObjectMapper json = new ObjectMapper();
        private final long[] retryMs;

        public Http() {
            this(RETRY_MS);
        }

        Http(long[] retryMs) {
            this.retryMs = retryMs.clone();
        }

        @Override
        public Roster fetch(String issuer, String key) throws Exception {
            for (int attempt = 0; ; attempt++) {
                try {
                    return fetchOnce(issuer, key);
                } catch (IOException | Unavailable e) {
                    if (attempt >= retryMs.length) {
                        throw e;
                    }
                    Logger.warn("Table roster fetch failed ({}), trying again in {} ms", e.getMessage(), retryMs[attempt]);
                    Thread.sleep(retryMs[attempt]);
                }
            }
        }

        /** Convex answered with a 5xx: worth trying again. */
        static final class Unavailable extends IllegalStateException {
            Unavailable(int status) {
                super("Convex answered " + status);
            }
        }

        private Roster fetchOnce(String issuer, String key) throws Exception {
            HttpResponse<String> res = http.send(HttpRequest.newBuilder(url(issuer, "roster", key))
                    .timeout(Duration.ofSeconds(15)).GET().build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 404) {
                return null;
            }
            if (res.statusCode() / 100 == 5) {
                throw new Unavailable(res.statusCode());
            }
            if (res.statusCode() / 100 != 2) {
                throw new IllegalStateException("Convex answered " + res.statusCode());
            }
            JsonNode r = json.readTree(res.body());
            List<Player> players = new ArrayList<>();
            for (JsonNode p : r.path("players")) {
                players.add(new Player(p.path("user").asText(), p.path("name").asText("Player")));
            }
            return new Roster(r.path("name").asText("Table"), players, r.path("ai").asInt(0),
                    r.path("freePlay").asBoolean(true), r.path("rewind").asInt(0));
        }

        @Override
        public void ended(String issuer, String key) {
            http.sendAsync(HttpRequest.newBuilder(url(issuer, "ended", key)).timeout(Duration.ofSeconds(15))
                            .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
                    .whenComplete((res, err) -> {
                        if (err != null) {
                            Logger.warn("Couldn't tell {} the table's game ended: {}", issuer, err.getMessage());
                        }
                    });
        }

        private static URI url(String issuer, String what, String key) {
            return URI.create(issuer + "/tables/" + what + "?key=" + URLEncoder.encode(key, StandardCharsets.UTF_8));
        }
    }
}
