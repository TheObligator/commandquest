package forge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.util.MyRandom;
import io.javalin.Javalin;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.Test;

/**
 * A multiplayer table's game (docs/tables.md): two people and one Forge AI. Each browser joins
 * with the table's game key; the game starts when both are in, each sees only their own hand, and
 * when one leaves for good they concede while the other plays on.
 */
public class TableGameTest {

    private static final String KEY = "0123456789abcdef0123456789abcdef";
    private final ObjectMapper json = new ObjectMapper();

    private static final class Browser implements WebSocket.Listener {
        final BlockingQueue<String> inbox = new LinkedBlockingQueue<>();
        private final StringBuilder part = new StringBuilder();

        @Override
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            part.append(data);
            if (last) {
                inbox.add(part.toString());
                part.setLength(0);
            }
            ws.request(1);
            return null;
        }
    }

    /** Convex, as far as the game server sees it: one table's roster, and the "ended" calls. */
    private static final class FakeRosters implements TableRosters {
        final List<String> ended = new CopyOnWriteArrayList<>();

        @Override
        public Roster fetch(String issuer, String key) {
            if (!issuer.equals(TestTokens.ISSUER) || !key.equals(KEY)) {
                return null;
            }
            return new Roster("Friday", List.of(new Player("ana", "Ana"), new Player("bob", "Bob")), 1, true, 0);
        }

        @Override
        public void ended(String issuer, String key) {
            ended.add(key);
        }
    }

    private JsonNode next(Browser b, String type, long timeoutMs) throws Exception {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            String s = b.inbox.poll(500, TimeUnit.MILLISECONDS);
            if (s != null) {
                JsonNode m = json.readTree(s);
                if (m.path("t").asText().equals(type)) {
                    return m;
                }
            }
        }
        Assert.fail("no '" + type + "' message within " + timeoutMs + " ms");
        return null;
    }

    private WebSocket connect(Javalin app, Browser b) throws Exception {
        return HttpClient.newHttpClient().newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:" + app.port() + "/ws"), b).get(5, TimeUnit.SECONDS);
    }

    private String join(String key, String commander) throws Exception {
        ObjectNode m = json.createObjectNode();
        m.put("t", "table");
        m.put("key", key);
        ObjectNode d = m.putObject("deck");
        d.put("name", "Deck");
        ArrayNode cards = d.putArray("cards");
        cards.addObject().put("name", commander).put("quantity", 1).put("board", "commander");
        cards.addObject().put("name", "Plains").put("quantity", 99).put("board", "main");
        return json.writeValueAsString(m);
    }

    /** Answers whatever the game asks (keep the hand, play first, pass) until {@code until} says stop. */
    private JsonNode play(Browser b, WebSocket ws, long timeoutMs, java.util.function.Predicate<JsonNode> until) throws Exception {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            String s = b.inbox.poll(500, TimeUnit.MILLISECONDS);
            if (s == null) {
                continue;
            }
            JsonNode m = json.readTree(s);
            if (until.test(m)) {
                return m;
            }
            switch (m.path("t").asText()) {
                case "prompt" -> {
                    if (m.path("ok").path("enabled").asBoolean(true)) {
                        ws.sendText("{\"t\":\"ok\"}", true);
                    }
                }
                case "ask" -> {
                    ObjectNode a = json.createObjectNode();
                    a.put("t", "answer");
                    a.put("id", m.path("id").asInt());
                    a.putArray("choice").add(m.path("selected").size() > 0 ? m.path("selected").get(0).asInt() : 0);
                    ws.sendText(json.writeValueAsString(a), true);
                }
                default -> { }
            }
        }
        return null;
    }

    @Test(timeOut = 240_000)
    public void twoPlayersAndAnAi() throws Exception {
        MyRandom.setRandom(new Random(3));
        TestTokens tokens = new TestTokens();
        FakeRosters rosters = new FakeRosters();
        Javalin app = WebServer.create(new WebServer.Options(null, Set.of(), null, tokens.auth(), 2, rosters),
                hub -> hub.setReconnectGrace(Duration.ofSeconds(1))).start(0);
        Browser ana = new Browser();
        Browser bob = new Browser();
        Browser eve = new Browser();
        WebSocket wa = connect(app, ana);
        WebSocket wb = connect(app, bob);
        WebSocket we = connect(app, eve);
        try {
            wa.sendText("{\"t\":\"hello\",\"token\":\"" + tokens.valid("ana") + "\"}", true);
            wb.sendText("{\"t\":\"hello\",\"token\":\"" + tokens.valid("bob") + "\"}", true);
            we.sendText("{\"t\":\"hello\",\"token\":\"" + tokens.valid("eve") + "\"}", true);
            next(ana, "hello", 10_000);
            next(bob, "hello", 10_000);
            next(eve, "hello", 10_000);

            // Someone who isn't at the table, and a key with no game.
            we.sendText(join(KEY, "Isamaru, Hound of Konda"), true);
            Assert.assertTrue(next(eve, "error", 10_000).path("message").asText().contains("not playing at this table"));
            we.sendText(join("ffffffffffffffffffffffffffffffff", "Isamaru, Hound of Konda"), true);
            next(eve, "tableGone", 10_000);

            // Ana comes in first and waits for Bob.
            wa.sendText(join(KEY, "Isamaru, Hound of Konda"), true);
            JsonNode waiting = next(ana, "tableWaiting", 10_000);
            Assert.assertEquals(waiting.path("joined").asInt(), 1);
            Assert.assertEquals(waiting.path("total").asInt(), 2);
            Assert.assertEquals(waiting.path("waitingFor").get(0).asText(), "Bob");

            // Bob joins: the game starts for both, three seats.
            wb.sendText(join(KEY, "Thalia, Guardian of Thraben"), true);
            JsonNode va = next(ana, "state", 60_000).path("view");
            JsonNode vb = next(bob, "state", 60_000).path("view");
            Assert.assertEquals(va.path("players").size(), 3, "Ana, Bob and an AI");
            Assert.assertEquals(va.path("players").get(0).path("name").asText(), "Ana", "Ana sees herself first");
            Assert.assertEquals(vb.path("players").get(0).path("name").asText(), "Bob", "Bob sees himself first");
            for (JsonNode p : va.path("players")) {
                if (!p.path("name").asText().equals("Ana")) {
                    Assert.assertTrue(p.path("hand").isNull() || p.path("hand").isEmpty(), "Ana can't see " + p.path("name") + "'s hand: " + p.path("hand"));
                }
            }
            Assert.assertEquals(json.readTree(HttpClient.newHttpClient().send(
                    java.net.http.HttpRequest.newBuilder(URI.create("http://localhost:" + app.port() + "/health")).build(),
                    java.net.http.HttpResponse.BodyHandlers.ofString()).body()).path("games").asInt(), 1, "one game, two players");

            // Both keep their hands and play on until Bob has priority; then Bob closes his tab for good.
            // Ana keeps answering whatever she's asked throughout; `seen` is what she was sent.
            List<JsonNode> seen = new CopyOnWriteArrayList<>();
            java.util.concurrent.atomic.AtomicBoolean done = new java.util.concurrent.atomic.AtomicBoolean();
            Thread anaPlays = new Thread(() -> {
                try {
                    play(ana, wa, 200_000, m -> {
                        seen.add(m);
                        return done.get();
                    });
                } catch (Exception ignored) {
                    // the test is over
                }
            });
            anaPlays.setDaemon(true);
            anaPlays.start();
            JsonNode bobsTurn = play(bob, wb, 90_000, m -> m.path("t").asText().equals("prompt")
                    && m.path("ok").path("label").asText().equals("OK") && !m.path("message").asText().contains("hand"));
            Assert.assertNotNull(bobsTurn, "Bob got priority");
            int before = seen.size();
            wb.sendClose(WebSocket.NORMAL_CLOSURE, "bye").get(5, TimeUnit.SECONDS);

            // After the reconnect grace, Bob concedes; Ana's game goes on.
            JsonNode withoutBob = waitFor(seen, before, 60_000, m -> {
                if (!m.path("t").asText().equals("state")) {
                    return false;
                }
                for (JsonNode p : m.path("view").path("players")) {
                    if (p.path("name").asText().equals("Bob")) {
                        return p.path("lost").asBoolean();
                    }
                }
                return false;
            });
            Assert.assertNotNull(withoutBob, "Bob conceded when he didn't come back: " + seen.subList(Math.max(before - 3, seen.size() - 12), seen.size()).stream()
                    .map(m -> m.path("t").asText() + (m.path("t").asText().equals("state") ? " T" + m.path("view").path("turn") + " " + m.path("view").path("step")
                            + " active=" + m.path("view").path("active") + " prio=" + m.path("view").path("priority") + " " + m.path("view").path("players").findValuesAsText("name")
                            + " log=" + m.path("view").path("log") : " " + m.path("message").asText() + " " + m.path("ok"))).toList());
            Assert.assertFalse(withoutBob.path("view").path("gameOver").asBoolean(), "Ana plays on against the AI");
            Assert.assertTrue(rosters.ended.isEmpty(), "the table's game isn't over yet");

            // Ana concedes: nobody's left, the game ends and the table hears about it once.
            int mark = seen.size();
            wa.sendText("{\"t\":\"concede\"}", true);
            Assert.assertNotNull(waitFor(seen, mark, 30_000, m -> m.path("t").asText().equals("over")
                    || (m.path("t").asText().equals("state") && m.path("view").path("gameOver").asBoolean())), "the game ended");
            done.set(true);
            long until = System.currentTimeMillis() + 5_000;
            while (rosters.ended.isEmpty() && System.currentTimeMillis() < until) {
                Thread.sleep(100);
            }
            Thread.sleep(300);
            Assert.assertEquals(rosters.ended, List.of(KEY), "Convex hears the game ended, once");
        } finally {
            for (WebSocket w : new WebSocket[] {wa, we}) {
                w.sendClose(WebSocket.NORMAL_CLOSURE, "done");
            }
            Thread.sleep(500);
            app.stop();
        }
    }

    /** The first message from {@code from} on that matches, waiting for it up to {@code timeoutMs}. */
    private static JsonNode waitFor(List<JsonNode> seen, int from, long timeoutMs, java.util.function.Predicate<JsonNode> match) throws InterruptedException {
        long end = System.currentTimeMillis() + timeoutMs;
        int i = from;
        while (System.currentTimeMillis() < end) {
            while (i < seen.size()) {
                JsonNode m = seen.get(i++);
                if (match.test(m)) {
                    return m;
                }
            }
            Thread.sleep(100);
        }
        return null;
    }

    @Test
    public void seatNamesAreUniqueAndNeverAnAi() {
        Set<String> taken = new java.util.HashSet<>();
        Assert.assertEquals(GameHub.seatName("Ana", taken), "Ana");
        Assert.assertEquals(GameHub.seatName("ana", taken), "ana 2");
        Assert.assertEquals(GameHub.seatName("AI 1", taken), "Player");
        Assert.assertEquals(GameHub.seatName("  ", taken), "Player 2");
    }
}
