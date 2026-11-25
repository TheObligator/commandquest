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
            String health = HttpClient.newHttpClient().send(
                    java.net.http.HttpRequest.newBuilder(URI.create("http://localhost:" + app.port() + "/health")).build(),
                    java.net.http.HttpResponse.BodyHandlers.ofString()).body();
            Assert.assertEquals(json.readTree(health).path("games").asInt(), 1, "/health counts the game (auto-deploy waits for 0): " + health);
            JsonNode me = state.path("players").get(0);
            Assert.assertEquals(me.path("id").asText(), state.path("viewer").asText(), "the viewer comes first");
            Assert.assertEquals(me.path("name").asText(), "Tester");

            // Keep the opening hand, then play lands on our turns and pass everything else.
            int landsPlayed = 0;
            int lastLandTurn = -1;
            int prompts = 0;
            String notice = null;
            boolean clickedEarly = false;
            boolean landWasPlayable = false;
            boolean landDropInMain = false;
            boolean landDropOffTurn = false;
            boolean askedActions = false;
            boolean usedMenu = false;
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
                    case "state" -> {
                        state = m.path("view");
                        landDropOffTurn |= state.path("landDrop").asBoolean()
                                && !state.path("active").asText().equals(state.path("viewer").asText());
                    }
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
                        if (m.path("message").asText().contains("won the coin toss")) {
                            // Won the toss in a multiplayer game: click a player to go first (yourself).
                            ws.sendText("{\"t\":\"player\",\"id\":" + state.path("viewer").asText() + "}", true);
                            continue;
                        }
                        boolean myMain = state.path("active").asText().equals(state.path("viewer").asText())
                                && state.path("step").asText().equals("MAIN1");
                        JsonNode land = null;
                        for (JsonNode c : state.path("players").get(0).path("hand")) {
                            if (c.path("types").toString().contains("Land")) {
                                land = c;
                                break;
                            }
                        }
                        boolean canPass = m.path("ok").path("enabled").asBoolean() && m.path("ok").path("label").asText().equals("OK")
                                && m.path("cancel").path("label").asText().equals("End Turn"); // priority, not the mulligan
                        if (!myMain && land != null && !clickedEarly && canPass) {
                            // A land outside your main phase: nothing happens, and the server says why.
                            clickedEarly = true;
                            ws.sendText("{\"t\":\"card\",\"id\":" + land.path("id").asInt() + "}", true);
                        }
                        if (myMain && land != null && lastLandTurn != state.path("turn").asInt()) {
                            for (JsonNode id : state.path("playable")) {
                                landWasPlayable |= id.asInt() == land.path("id").asInt();
                            }
                            landDropInMain |= state.path("landDrop").asBoolean();
                            if (!askedActions) {
                                // The first land goes in through its right-click menu.
                                askedActions = true;
                                ws.sendText("{\"t\":\"actions\",\"id\":" + land.path("id").asInt() + "}", true);
                            } else {
                                lastLandTurn = state.path("turn").asInt();
                                landsPlayed++;
                                ws.sendText("{\"t\":\"card\",\"id\":" + land.path("id").asInt() + "}", true);
                            }
                        } else if (m.path("ok").path("enabled").asBoolean()) {
                            ws.sendText("{\"t\":\"ok\"}", true);
                        }
                    }
                    case "notice" -> notice = m.path("message").asText();
                    case "actions" -> {
                        for (JsonNode a : m.path("actions")) {
                            if (a.path("enabled").asBoolean() && !usedMenu) {
                                usedMenu = true;
                                lastLandTurn = state.path("turn").asInt();
                                landsPlayed++;
                                ws.sendText("{\"t\":\"ability\",\"id\":" + m.path("id").asInt() + ",\"ability\":" + a.path("ability").asInt()
                                        + ",\"label\":" + json.writeValueAsString(a.path("label").asText()) + "}", true);
                            }
                        }
                        Assert.assertTrue(usedMenu, "the land's menu offers playing it: " + m);
                    }
                    case "error" -> Assert.fail("server error: " + m.path("message").asText());
                    default -> { }
                }
            }

            try {
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
                // Counters by hand: a +1/+1 counter on our first land shows up, and the log says so.
                int landId = state.path("players").get(0).path("battlefield").get(0).path("id").asInt();
                ws.sendText("{\"t\":\"counter\",\"id\":" + landId + ",\"type\":\"+1/+1\",\"delta\":2}", true);
                boolean counted = false;
                long wait = System.currentTimeMillis() + 10_000;
                while (!counted && System.currentTimeMillis() < wait) {
                    String s = b.inbox.poll(500, TimeUnit.MILLISECONDS);
                    if (s == null) {
                        continue;
                    }
                    JsonNode m = json.readTree(s);
                    if (m.path("t").asText().equals("state")) {
                        state = m.path("view");
                        for (JsonNode c : state.path("players").get(0).path("battlefield")) {
                            counted |= c.path("id").asInt() == landId && c.path("counters").path("+1/+1").asInt() == 2;
                        }
                    }
                }
                Assert.assertTrue(counted, "two +1/+1 counters put on by hand");
                Assert.assertTrue(state.path("log").toString().contains("(by hand)"), "the log says a counter was added by hand");

                // Other manual actions: tap it, keep it from ever untapping, and read its details.
                ws.sendText("{\"t\":\"manual\",\"id\":" + landId + ",\"action\":\"tap\"}", true);
                ws.sendText("{\"t\":\"manual\",\"id\":" + landId + ",\"action\":\"neverUntap\"}", true);
                ws.sendText("{\"t\":\"details\",\"id\":" + landId + "}", true);
                boolean tapped = false;
                boolean locked = false;
                String details = null;
                wait = System.currentTimeMillis() + 10_000;
                while (!(tapped && locked && details != null) && System.currentTimeMillis() < wait) {
                    String s = b.inbox.poll(500, TimeUnit.MILLISECONDS);
                    if (s == null) {
                        continue;
                    }
                    JsonNode m = json.readTree(s);
                    if (m.path("t").asText().equals("state")) {
                        for (JsonNode c : m.path("view").path("players").get(0).path("battlefield")) {
                            if (c.path("id").asInt() == landId) {
                                tapped = c.path("tapped").asBoolean();
                                locked = c.path("untapLock").asText().equals("never");
                            }
                        }
                    } else if (m.path("t").asText().equals("details")) {
                        details = m.path("text").asText();
                    }
                }
                Assert.assertTrue(tapped, "tapped by hand");
                Assert.assertTrue(locked, "set never to untap");
                Assert.assertTrue(details != null && !details.isBlank(), "card details text: " + details);
                Assert.assertTrue(prompts > 3, "Forge's prompts reached the browser");
                Assert.assertTrue(clickedEarly && notice != null && notice.contains("land"), "a land clicked too early says why: " + notice);
                Assert.assertTrue(landWasPlayable, "the land showed as playable in our main phase");
                Assert.assertTrue(landDropInMain, "landDrop is on in our main phase with a land to play");
                Assert.assertFalse(landDropOffTurn, "landDrop is never on during an opponent's turn");
                Assert.assertTrue(usedMenu, "a land was played from its menu");
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
            } catch (AssertionError e) {
                trace.subList(0, Math.max(0, trace.size() - 60)).clear();
                System.out.println("[hub-test] last messages:\n  " + String.join("\n  ", trace));
                throw e;
            }
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "done");
            Thread.sleep(500);
            app.stop();
        }
    }

    /**
     * Commander mulligans, 1v1: the first mulligan is free, and cards go to the bottom only once you
     * keep (London mulligan), not straight after each mulligan.
     */
    @Test(timeOut = 120_000)
    public void commanderMulliganOneOnOne() throws Exception {
        MyRandom.setRandom(new Random(7));
        TestTokens tokens = new TestTokens();
        Javalin app = WebServer.create(new WebServer.Options(null, Set.of(), null, tokens.auth(), 2)).start(0);
        Browser b = new Browser();
        WebSocket ws = HttpClient.newHttpClient().newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:" + app.port() + "/ws"), b).get(5, TimeUnit.SECONDS);
        java.util.List<String> seen = new java.util.ArrayList<>();
        try {
            ws.sendText("{\"t\":\"hello\",\"token\":\"" + tokens.valid("user1") + "\"}", true);
            next(b, "hello", 10_000);
            ObjectNode start = json.createObjectNode();
            start.put("t", "start");
            start.put("name", "Tester");
            start.put("opponents", 1);
            start.set("deck", deck());
            ws.sendText(json.writeValueAsString(start), true);

            JsonNode state = next(b, "state", 60_000).path("view");
            int mulligans = 0;
            boolean kept = false;
            boolean bottomed = false;
            int handAfterKeep = -1;
            String lastButtons = "";
            String lastMessage = "";
            boolean answeredLast = false;
            long end = System.currentTimeMillis() + 90_000;
            while (System.currentTimeMillis() < end && handAfterKeep < 0) {
                String s = b.inbox.poll(5, TimeUnit.SECONDS);
                if (s == null) {
                    continue;
                }
                JsonNode m = json.readTree(s);
                switch (m.path("t").asText()) {
                    case "state" -> {
                        state = m.path("view");
                        seen.add("state hand=" + state.path("players").get(0).path("hand").size());
                    }
                    case "ask" -> {
                        seen.add("ask " + m.path("message").asText() + " " + m.path("options"));
                        ObjectNode a = json.createObjectNode();
                        a.put("t", "answer");
                        a.put("id", m.path("id").asInt());
                        a.putArray("choice").add(m.path("selected").size() > 0 ? m.path("selected").get(0).asInt() : 0);
                        ws.sendText(json.writeValueAsString(a), true);
                    }
                    case "prompt" -> {
                        // Forge often sets a prompt's buttons before its text, so a new prompt can first arrive with
                        // the previous one's text (or none), then again with its own. Go by the buttons, and answer
                        // each prompt once: same buttons with new text is the prompt just answered, filled in.
                        String buttons = m.path("ok").toString() + m.path("cancel");
                        String message = m.path("message").asText();
                        boolean filledIn = buttons.equals(lastButtons) && !message.equals(lastMessage) && answeredLast;
                        lastButtons = buttons;
                        lastMessage = message;
                        answeredLast = false;
                        if (message.isBlank() || filledIn) {
                            answeredLast = filledIn;
                            continue;
                        }
                        answeredLast = true;
                        JsonNode hand = state.path("players").get(0).path("hand");
                        boolean mulliganPrompt = m.path("cancel").path("label").asText().equals("Mulligan");
                        boolean priority = m.path("cancel").path("label").asText().equals("End Turn");
                        seen.add((mulliganPrompt ? "keep?" : priority ? "priority" : "choose") + " hand=" + hand.size() + " " + m.path("message").asText().replace("\n", " ") + " " + m.path("ok") + m.path("cancel"));
                        if (m.path("ok").path("label").asText().equals("Yes")) {
                            // Won the die roll (it depends on the shared random's state, so on test order).
                            ws.sendText("{\"t\":\"ok\"}", true);
                        } else if (mulliganPrompt) {
                            Assert.assertEquals(hand.size(), 7, "every new hand is seven cards: " + seen);
                            if (mulligans < 2) {
                                mulligans++;
                                ws.sendText("{\"t\":\"cancel\"}", true);
                            } else {
                                kept = true;
                                ws.sendText("{\"t\":\"ok\"}", true);
                            }
                        } else if (!priority && !bottomed) {
                            Assert.assertTrue(kept, "cards go to the bottom only after keeping: " + seen);
                            bottomed = true; // (the prompt is sent again once the card is selected)
                            ws.sendText("{\"t\":\"card\",\"id\":" + hand.get(0).path("id").asInt() + "}", true);
                            ws.sendText("{\"t\":\"ok\"}", true);
                        } else if (priority && kept) {
                            handAfterKeep = hand.size();
                        }
                    }
                    default -> { }
                }
            }
            Assert.assertEquals(mulligans, 2, "mulliganed twice: " + seen);
            Assert.assertTrue(bottomed, "asked to bottom a card: " + seen);
            Assert.assertEquals(handAfterKeep, 6, "two mulligans, the first free: one card on the bottom: " + seen);
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "done");
            Thread.sleep(500);
            app.stop();
        }
    }

    private WebSocket connect(Javalin app, Browser b) throws Exception {
        return HttpClient.newHttpClient().newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:" + app.port() + "/ws"), b).get(5, TimeUnit.SECONDS);
    }

    /**
     * A game outlives its socket: after a reload or dropped connection the player signs in again and
     * gets the board and the prompt they were looking at. Signing in from another tab takes it over.
     */
    @Test(timeOut = 120_000)
    public void reconnectResumesTheGame() throws Exception {
        MyRandom.setRandom(new Random(11));
        TestTokens tokens = new TestTokens();
        Javalin app = WebServer.create(new WebServer.Options(null, Set.of(), null, tokens.auth(), 2)).start(0);
        String hello = "{\"t\":\"hello\",\"token\":\"" + tokens.valid("user1") + "\"}";
        Browser first = new Browser();
        WebSocket ws = connect(app, first);
        WebSocket second = null;
        WebSocket third = null;
        try {
            ws.sendText(hello, true);
            Assert.assertFalse(next(first, "hello", 10_000).path("game").asBoolean(), "no game to resume yet");
            ObjectNode start = json.createObjectNode();
            start.put("t", "start");
            start.put("name", "Tester");
            start.put("opponents", 1);
            start.set("deck", deck());
            ws.sendText(json.writeValueAsString(start), true);
            JsonNode prompt = next(first, "prompt", 60_000);
            if (prompt.path("ok").path("label").asText().equals("Yes")) {
                ws.sendText("{\"t\":\"ok\"}", true); // won the die roll: play first
                do {
                    prompt = next(first, "prompt", 60_000);
                } while (prompt.path("ok").path("label").asText().equals("Yes")); // its buttons can come twice
            }
            Assert.assertEquals(prompt.path("cancel").path("label").asText(), "Mulligan", "the opening hand: " + prompt);

            // The tab reloads: the old socket closes, a new one signs in.
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "reload").get(5, TimeUnit.SECONDS);
            Thread.sleep(300);
            Browser back = new Browser();
            second = connect(app, back);
            second.sendText(hello, true);
            Assert.assertTrue(next(back, "hello", 10_000).path("game").asBoolean(), "the game is still there");
            JsonNode view = next(back, "state", 10_000).path("view");
            Assert.assertEquals(view.path("players").get(0).path("hand").size(), 7, "the same board");
            Assert.assertEquals(next(back, "prompt", 10_000).path("cancel").path("label").asText(), "Mulligan",
                    "the prompt that was on screen");

            // Keep the hand from the new socket: the game carries on there.
            second.sendText("{\"t\":\"ok\"}", true);
            next(back, "waiting", 30_000);

            // Another tab signs in: it takes the game, the old one is told.
            Browser other = new Browser();
            third = connect(app, other);
            third.sendText(hello, true);
            Assert.assertTrue(next(other, "hello", 10_000).path("game").asBoolean(), "the other tab gets the game");
            next(other, "state", 10_000);
            next(back, "moved", 10_000);
        } finally {
            for (WebSocket w : new WebSocket[] {second, third}) {
                if (w != null) {
                    w.sendClose(WebSocket.NORMAL_CLOSURE, "done");
                }
            }
            Thread.sleep(500);
            app.stop();
        }
    }

    /**
     * Conceding against three AI ends the game (the AI don't play on alone), and the table says
     * you conceded.
     */
    @Test(timeOut = 120_000)
    public void concedeEndsTheGameForYou() throws Exception {
        MyRandom.setRandom(new Random(7));
        TestTokens tokens = new TestTokens();
        Javalin app = WebServer.create(new WebServer.Options(null, Set.of(), null, tokens.auth(), 2)).start(0);
        Browser b = new Browser();
        WebSocket ws = connect(app, b);
        try {
            ws.sendText("{\"t\":\"hello\",\"token\":\"" + tokens.valid("user1") + "\"}", true);
            next(b, "hello", 10_000);
            ObjectNode start = json.createObjectNode();
            start.put("t", "start");
            start.put("name", "Tester");
            start.put("opponents", 3);
            start.set("deck", deck());
            ws.sendText(json.writeValueAsString(start), true);
            // If you win the coin toss, Forge first asks whether to play first: answer that once (yes), then the
            // mulligan. (Who wins depends on randomness other tests share, so it varies.) Tell them apart by their
            // buttons: Forge sets those before a prompt's text.
            boolean answeredToss = false;
            while (true) {
                JsonNode p = next(b, "prompt", 60_000);
                if (p.path("cancel").path("label").asText().equals("Mulligan")) {
                    break;
                }
                if (!answeredToss) {   // (it may come again with its text: answer it once)
                    answeredToss = true;
                    ws.sendText("{\"t\":\"ok\"}", true);
                }
            }
            ws.sendText("{\"t\":\"ok\"}", true);
            // Play on until the game stops for you with priority (past the mulligan), then concede.
            JsonNode prompt = null;
            long until = System.currentTimeMillis() + 60_000;
            while (prompt == null && System.currentTimeMillis() < until) {
                String s = b.inbox.poll(500, TimeUnit.MILLISECONDS);
                JsonNode m = s == null ? null : json.readTree(s);
                if (m != null && m.path("t").asText().equals("prompt") && m.path("ok").path("label").asText().equals("OK")
                        && !m.path("message").asText().contains("hand")) {
                    prompt = m;
                } else if (m != null && m.path("t").asText().equals("ask")) {
                    ObjectNode ans = json.createObjectNode();
                    ans.put("t", "answer");
                    ans.put("id", m.path("id").asInt());
                    ans.putArray("choice").add(m.path("selected").size() > 0 ? m.path("selected").get(0).asInt() : 0);
                    ws.sendText(json.writeValueAsString(ans), true);
                }
            }
            Assert.assertNotNull(prompt, "the game stopped for you");
            ws.sendText("{\"t\":\"concede\"}", true);

            java.util.List<String> trace = new java.util.ArrayList<>();
            boolean over = false;
            JsonNode last = null;
            long end = System.currentTimeMillis() + 20_000;
            while (System.currentTimeMillis() < end && !over) {
                String s = b.inbox.poll(500, TimeUnit.MILLISECONDS);
                if (s == null) {
                    continue;
                }
                JsonNode m = json.readTree(s);
                String t = m.path("t").asText();
                trace.add(t + (t.equals("prompt") ? " '" + m.path("message").asText().replace('\n', ' ') + "'" : ""));
                if (t.equals("state")) {
                    last = m.path("view");
                    over |= last.path("gameOver").asBoolean(); // the browser ends the game on this
                }
                over |= t.equals("over");
            }
            Assert.assertTrue(over, "conceding ends the game, after " + prompt.path("message") + ": " + trace);
            Assert.assertNotNull(last, "a last look at the table");
            Assert.assertTrue(last.path("gameOver").asBoolean(), "the game is over: " + last);
            Assert.assertEquals(last.path("outcome").asText(), "You conceded.");
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

    /** Recording a combo over the socket: the clicks in between are its steps, and nothing by hand is let in. */
    @Test(timeOut = 240_000)
    public void recordsACombo() throws Exception {
        MyRandom.setRandom(new Random(9));
        TestTokens tokens = new TestTokens();
        Javalin app = WebServer.create(new WebServer.Options(null, Set.of(), null, tokens.auth(), 2)).start(0);
        Browser b = new Browser();
        WebSocket ws = HttpClient.newHttpClient().newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:" + app.port() + "/ws"), b).get(5, TimeUnit.SECONDS);
        try {
            ws.sendText("{\"t\":\"hello\",\"token\":\"" + tokens.valid("combo") + "\"}", true);
            next(b, "hello", 10_000);
            ObjectNode start = json.createObjectNode();
            start.put("t", "start").put("name", "Tester").put("opponents", 1).set("deck", deck());
            ws.sendText(json.writeValueAsString(start), true);

            JsonNode view = null;
            String stage = "land";
            int land = -1;
            boolean refused = false;
            long end = System.currentTimeMillis() + 120_000;
            while (!stage.equals("done")) {
                Assert.assertTrue(System.currentTimeMillis() < end, "timed out at " + stage);
                String text = b.inbox.poll(5, TimeUnit.SECONDS);
                if (text == null) {
                    continue;
                }
                JsonNode m = json.readTree(text);
                String t = m.path("t").asText();
                if (t.equals("state")) {
                    view = m.path("view");
                }
                if (t.equals("notice")) {
                    refused |= m.path("message").asText().contains("can't be part of a combo");
                }
                if (t.equals("ask")) {
                    ObjectNode a = json.createObjectNode();
                    a.put("t", "answer").put("id", m.path("id").asInt()).putArray("choice").add(0);
                    ws.sendText(json.writeValueAsString(a), true);
                }
                if (view == null) {
                    continue;
                }
                JsonNode combos = view.path("combos");
                if (stage.equals("recording") && combos.has("recording")) {
                    ws.sendText("{\"t\":\"manual\",\"id\":" + land + ",\"action\":\"tap\"}", true);
                    ws.sendText("{\"t\":\"card\",\"id\":" + land + "}", true);
                    stage = "tapping";
                } else if (stage.equals("tapping") && combos.path("recording").size() == 1 && t.equals("prompt")) {
                    ws.sendText("{\"t\":\"combo\",\"action\":\"keep\",\"name\":\"Plains mana\",\"ref\":\"12-34\"}", true);
                    stage = "keeping";
                } else if (stage.equals("keeping") && combos.path("list").size() == 1) {
                    JsonNode c = combos.path("list").get(0);
                    Assert.assertEquals(c.path("name").asText(), "Plains mana");
                    Assert.assertEquals(c.path("ref").asText(), "12-34");
                    Assert.assertEquals(c.path("steps").size(), 1, c.toString());
                    Assert.assertTrue(c.path("gains").toString().contains("+1 {W}"), c.toString());
                    Assert.assertFalse(c.path("loops").asBoolean(), "the Plains stays tapped");
                    Assert.assertFalse(combos.has("recording"));
                    stage = "done";
                } else if (t.equals("prompt") && (stage.equals("land") || stage.equals("main"))) {
                    boolean myMain = view.path("active").asText().equals(view.path("viewer").asText()) && view.path("step").asText().equals("MAIN1")
                            && m.path("cancel").path("label").asText().matches("End Turn|Undo.*") && view.path("stack").isEmpty();
                    JsonNode field = view.path("players").get(0).path("battlefield");
                    if (myMain && !field.isEmpty()) {
                        land = field.get(0).path("id").asInt();
                        stage = "recording";
                        ws.sendText("{\"t\":\"combo\",\"action\":\"record\"}", true);
                    } else if (myMain && stage.equals("land")) {
                        for (JsonNode c : view.path("players").get(0).path("hand")) {
                            if (c.path("name").asText().equals("Plains")) {
                                ws.sendText("{\"t\":\"card\",\"id\":" + c.path("id").asInt() + "}", true);
                                stage = "main";
                                break;
                            }
                        }
                    } else if (!myMain && m.path("ok").path("enabled").asBoolean()) {
                        ws.sendText("{\"t\":\"ok\"}", true);
                    }
                }
            }
            Assert.assertTrue(refused, "nothing by hand while recording");
        } finally {
            ws.abort();
            app.stop();
        }
    }
}
