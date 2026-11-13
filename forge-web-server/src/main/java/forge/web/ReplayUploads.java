package forge.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.web.engine.GameSession;
import forge.web.engine.Recording;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.tinylog.Logger;

/**
 * Sends finished games' replays to Convex (docs/replays.md): {@code POST <issuer>/replays}, to the
 * Convex deployment each player signed in with (a user is {@code "<issuer>#<user id>"}, from
 * {@link ConvexAuth}). The body is the gzipped replay; {@code X-Replay-Meta} is base64url JSON,
 * the replay's meta plus {@code users}, the ids of the players who keep it. Authenticated with
 * {@code REPLAY_SECRET}, set the same in Convex's environment.
 */
public final class ReplayUploads implements GameSession.ReplaySink {

    /** A game shorter than this isn't worth keeping (someone left at once). */
    static final int MIN_TURNS = 2;
    /** Convex stores bigger files, but a replay this big means something went wrong. */
    static final int MAX_BYTES = 20 << 20;

    private final String secret;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json = new ObjectMapper();

    public ReplayUploads(String secret) {
        this.secret = secret;
    }

    /** From {@code REPLAY_SECRET}, or null when it isn't set (games then aren't recorded at all). */
    public static ReplayUploads fromEnv() {
        String s = System.getenv("REPLAY_SECRET");
        return s == null || s.isBlank() ? null : new ReplayUploads(s.trim());
    }

    @Override
    public void finished(Recording replay, Collection<String> users) {
        ObjectNode meta = replay.meta();
        if (meta == null || meta.path("turns").asInt() < MIN_TURNS || users.isEmpty()) {
            return;
        }
        byte[] body;
        try {
            body = replay.bytes();
        } catch (Exception e) {
            Logger.warn(e, "Couldn't write the replay");
            return;
        }
        if (body.length > MAX_BYTES) {
            Logger.warn("Replay too big to keep: {} bytes", body.length);
            return;
        }
        for (Map.Entry<String, List<String>> e : byIssuer(users).entrySet()) {
            ObjectNode m = meta.deepCopy();
            e.getValue().forEach(m.putArray("users")::add);
            HttpRequest req;
            try {
                req = HttpRequest.newBuilder(URI.create(e.getKey() + "/replays"))
                        .timeout(Duration.ofSeconds(60))
                        .header("Authorization", "Bearer " + secret)
                        .header("Content-Type", "application/gzip")
                        .header("X-Replay-Meta", Base64.getUrlEncoder().withoutPadding()
                                .encodeToString(json.writeValueAsString(m).getBytes(StandardCharsets.UTF_8)))
                        .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                        .build();
            } catch (Exception ex) {
                Logger.warn(ex, "Couldn't build the replay upload");
                continue;
            }
            http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> {
                if (err != null) {
                    Logger.warn(err, "Replay upload to {} failed", e.getKey());
                } else if (res.statusCode() / 100 != 2) {
                    Logger.warn("Replay upload to {} refused: {} {}", e.getKey(), res.statusCode(), res.body());
                } else {
                    Logger.info("Replay saved ({} bytes, {} frames)", body.length, meta.path("frames").asInt());
                }
            });
        }
    }

    /** "issuer#id" users, grouped by issuer. */
    static Map<String, List<String>> byIssuer(Collection<String> users) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (String u : users) {
            int hash = u == null ? -1 : u.lastIndexOf('#');
            if (hash <= 0 || !(u.startsWith("https://") || u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost"))) {
                continue;   // not a Convex sign-in (tests, local dev without one)
            }
            out.computeIfAbsent(u.substring(0, hash), k -> new ArrayList<>()).add(u.substring(hash + 1));
        }
        return out;
    }
}
