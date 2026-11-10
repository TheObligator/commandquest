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
import java.util.Random;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.Test;

/**
 * The game socket end to end, as a browser uses it: sign in, start a game against three Forge AI,
 * keep the opening hand, play lands and pass, and check what this player is (and isn't) shown.
 */
public class GameHubTest {

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

    private ObjectNode deck() {
        ObjectNode d = json.createObjectNode();
        d.put("name", "Test deck");
        ArrayNode cards = d.putArray("cards");
        cards.addObject().put("name", "Isamaru, Hound of Konda").put("quantity", 1).put("board", "commander");
        cards.addObject().put("name", "Plains").put("quantity", 99).put("board", "main");
        return d;
    }

    @Test(timeOut = 240_000)
    public void signInStartAndPlay() throws Exception {
        MyRandom.setRandom(new Random(5));
        TestTokens tokens = new TestTokens();
        Javalin app = WebServer.create(new WebServer.Options(null, Set.of(), null, tokens.auth(), 2)).start(0);
        Browser b = new Browser();
        WebSocket ws = HttpClient.newHttpClient().newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:" + app.port() + "/ws"), b).get(5, TimeUnit.SECONDS);
        try {
            ws.sendText("{\"t\":\"start\"}", true);
            Assert.assertTrue(next(b, "error", 5000).path("message").asText().contains("Sign in"), "start needs sign-in");

            ws.sendText("{\"t\":\"hello\",\"token\":\"" + tokens.valid("user1") + "\"}", true);
            next(b, "hello", 10_000);

            ObjectNode start = json.createObjectNode();
            start.put("t", "start");
            start.put("name", "Tester");
            start.put("opponents", 3);
            start.set("deck", deck());
            ws.sendText(json.writeValueAsString(start), true);

            JsonNode state = next(b, "state", 60_000).path("view");
            Assert.assertEquals(state.path("players").size(), 4, "four seats");
            JsonNode me = state.path("players").get(0);
            Assert.assertEquals(me.path("id").asText(), state.path("viewer").asText(), "the viewer comes first");
            Assert.assertEquals(me.path("name").asText(), "Tester");

            // Keep the opening hand, then play lands on our turns and pass everything else.
            int landsPlayed = 0;
            int lastLandTurn = -1;
            int prompts = 0;
            java.util.List<String> trace = new java.util.ArrayList<>();
            long end = System.currentTimeMillis() + 150_000;
            while (System.currentTimeMillis() < end && (landsPlayed < 2 || state.path("turn").asInt() < 6)) {
                String s = b.inbox.poll(5, TimeUnit.SECONDS);
                if (s == null) {
                    continue;
                }
                JsonNode m = json.readTree(s);
                trace.add(m.path("t").asText() + (m.path("t").asText().equals("prompt") ? " '" + m.path("message").asText().replace('\n', ' ') + "' ok=" + m.path("ok") + " cancel=" + m.path("cancel")
                        : m.path("t").asText().equals("state") ? " T" + m.path("view").path("turn") + " " + m.path("view").path("step") + " active=" + m.path("view").path("active")
                        : m.path("t").asText().equals("ask") ? " " + m.path("message") + " " + m.path("options") : ""));
                switch (m.path("t").asText()) {
                    case "state" -> state = m.path("view");
                    case "ask" -> { // answer any question with its preselected or first option
                        ObjectNode a = json.createObjectNode();
                        a.put("t", "answer");
                        a.put("id", m.path("id").asInt());
                        ArrayNode choice = a.putArray("choice");
                        if (m.path("selected").size() > 0) {
                            choice.add(m.path("selected").get(0).asInt());
                        } else if (m.path("options").size() > 0) {
                            choice.add(0);
                        }
                        ws.sendText(json.writeValueAsString(a), true);
                    }
                    case "prompt" -> {
                        prompts++;
                        boolean myMain = state.path("active").asText().equals(state.path("viewer").asText())
                                && state.path("step").asText().equals("MAIN1");
                        JsonNode land = null;
                        for (JsonNode c : state.path("players").get(0).path("hand")) {
                            if (c.path("types").toString().contains("Land")) {
                                land = c;
                                break;
                            }
                        }
                        if (myMain && land != null && lastLandTurn != state.path("turn").asInt()) {
                            lastLandTurn = state.path("turn").asInt();
                            landsPlayed++;
                            ws.sendText("{\"t\":\"card\",\"id\":" + land.path("id").asInt() + "}", true);
                        } else if (m.path("ok").path("enabled").asBoolean()) {
                            ws.sendText("{\"t\":\"ok\"}", true);
                        }
                    }
                    case "error" -> Assert.fail("server error: " + m.path("message").asText());
                    default -> { }
                }
            }

            // The last land's state update may still be on its way.
            long settle = System.currentTimeMillis() + 15_000;
            while (state.path("players").get(0).path("battlefield").size() < 2 && System.currentTimeMillis() < settle) {
                String s = b.inbox.poll(500, TimeUnit.MILLISECONDS);
                if (s == null) {
                    continue;
                }
                JsonNode m = json.readTree(s);
                if (m.path("t").asText().equals("state")) {
                    state = m.path("view");
                } else if (m.path("t").asText().equals("prompt") && m.path("ok").path("enabled").asBoolean()) {
                    ws.sendText("{\"t\":\"ok\"}", true);
                }
            }
            Assert.assertTrue(prompts > 3, "Forge's prompts reached the browser");
            if (landsPlayed < 2) {
                trace.subList(0, Math.max(0, trace.size() - 40)).clear();
                System.out.println("[hub-test] last messages:\n  " + String.join("\n  ", trace));
            }
            Assert.assertTrue(landsPlayed >= 2, "played lands: " + landsPlayed);
            me = state.path("players").get(0);
            Assert.assertTrue(me.path("battlefield").size() >= 2, "our lands are on the battlefield");
            Assert.assertTrue(me.path("hand").size() > 0, "we see our own hand");
            Assert.assertEquals(me.path("command").size() + countCommander(me.path("battlefield")), 1, "our commander is visible");
            for (int i = 1; i < 4; i++) {
                JsonNode opp = state.path("players").get(i);
                Assert.assertEquals(opp.path("hand").size(), 0, "an opponent's hand is never sent");
                Assert.assertTrue(opp.path("handCount").asInt() > 0, "but its size is");
                Assert.assertTrue(opp.path("libraryCount").asInt() > 50, "library is a count");
                Assert.assertTrue(opp.path("name").asText().startsWith("AI "));
            }
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "done");
            Thread.sleep(500);
            app.stop();
        }
    }

    private static int countCommander(JsonNode cards) {
        int n = 0;
        for (JsonNode c : cards) {
            if (c.path("commander").asBoolean()) {
                n++;
            }
        }
        return n;
    }
}
