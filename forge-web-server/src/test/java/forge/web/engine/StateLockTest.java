package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/**
 * Sending a seat the game's state never waits for the game's lock. Forge holds that lock while it
 * ends a game (someone conceding on the forge-ui thread) and waits for the events it fires to be
 * delivered; a state being sent because of an event would wait for it in turn, and neither would
 * ever finish. Every game on the server shares the forge-ui thread, so all of them froze.
 */
public class StateLockTest {

    private final ObjectMapper json = new ObjectMapper();

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    private static Deck deck(String commander, String basic) {
        Deck d = new Deck(commander);
        d.getOrCreate(DeckSection.Commander).add(commander, 1);
        d.getMain().add(basic, 99);
        return d;
    }

    @Test(timeOut = 240_000)
    public void sendingTheStateDoesNotWaitForTheGamesLock() throws Exception {
        MyRandom.setRandom(new Random(11));
        BlockingQueue<String> sent = new LinkedBlockingQueue<>();
        BrowserSeat seat = new BrowserSeat(json, sent::offer);
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), seat),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)), 4);
        Thread sender = null;
        try {
            untilMyMain(session, seat, sent);
            Game g = session.game();

            // Your main phase, with priority: the state has everything in it (playable cards, land drop, rewind points).
            CountDownLatch held = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            Thread holder = new Thread(() -> {
                synchronized (g) {
                    held.countDown();
                    try {
                        release.await();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
            });
            holder.setDaemon(true);
            holder.start();
            Assert.assertTrue(held.await(5, TimeUnit.SECONDS));
            sent.clear();
            sender = new Thread(seat::refresh);
            sender.setDaemon(true);
            sender.start();
            sender.join(10_000);
            StackTraceElement[] at = sender.getStackTrace();
            boolean stuck = sender.isAlive();
            release.countDown();
            Assert.assertFalse(stuck, "sending the state waits for the game's lock: " + List.of(at));
            JsonNode state = json.readTree(sent.poll(5, TimeUnit.SECONDS));
            Assert.assertEquals(state.path("t").asText(), "state");
            Assert.assertTrue(state.path("view").path("landDrop").asBoolean(), "a land still to play");
            Assert.assertFalse(state.path("view").path("playable").isEmpty(), "lands to play");
        } finally {
            seat.close();
            session.abort();
        }
    }

    /** Answers and passes until you have priority in your own main phase. */
    private void untilMyMain(GameSession session, BrowserSeat seat, BlockingQueue<String> sent) throws Exception {
        JsonNode view = json.createObjectNode();
        long end = System.currentTimeMillis() + 120_000;
        while (System.currentTimeMillis() < end) {
            String s = sent.poll(5, TimeUnit.SECONDS);
            if (s == null) {
                continue;
            }
            JsonNode m = json.readTree(s);
            switch (m.path("t").asText()) {
                case "state" -> view = m.path("view");
                case "ask" -> seat.answer(m.path("id").asInt(), json.readTree("[0]"), null);
                case "prompt" -> {
                    if (view.path("step").asText().equals("MAIN1") && view.path("active").asText().equals(view.path("viewer").asText())
                            && m.path("cancel").path("label").asText().equals("End Turn")) {
                        return;
                    }
                    if (m.path("ok").path("enabled").asBoolean()) {
                        GameSessionTest.pass(session.controller("You", seat.player()));
                    }
                }
                default -> { }
            }
        }
        Assert.fail("never reached your main phase");
    }
}
