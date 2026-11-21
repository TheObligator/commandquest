package forge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    /** Talks to Convex over HTTP. */
    final class Http implements TableRosters {
        private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        private final ObjectMapper json = new ObjectMapper();

        @Override
        public Roster fetch(String issuer, String key) throws Exception {
            HttpResponse<String> res = http.send(HttpRequest.newBuilder(url(issuer, "roster", key))
                    .timeout(Duration.ofSeconds(15)).GET().build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 404) {
                return null;
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
