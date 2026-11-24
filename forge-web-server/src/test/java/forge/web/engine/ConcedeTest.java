package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.eventbus.Subscribe;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.event.GameEvent;
import forge.game.event.GameEventGameOutcome;
import forge.game.event.GameEventPlayerPriority;
import forge.game.player.Player;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/**
 * Conceding takes you out of the game whenever you do it: the game thread does it, at the next priority. (Forge's own
 * way does it at once on the forge-ui thread, while the game thread may be in the middle of something: the game thread
 * crashed, or never found whose turn is next.)
 */
public class ConcedeTest {

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

    /** One person's side of a game: what the server sent them, and what they say back. */
    private final class Person {
        final BlockingQueue<String> sent = new LinkedBlockingQueue<>();
        final BrowserSeat seat = new BrowserSeat(json, sent::offer);
        final String name;
        GameSession session;

        Person(String name) {
            this.name = name;
        }

        GameSession.Seat seat(String commander, String basic) {
            return new GameSession.Seat(name, deck(commander, basic), seat);
        }

        IGameController controller() {
            return session.controller(name, seat.player());
        }

        void concede() {
            FThreads.invokeInEdtLater(controller()::concede);
        }

        Player player() {
            return session.game().getRegisteredPlayers().stream().filter(p -> p.getName().equals(name)).findFirst().orElseThrow();
        }

        /** Answers questions, and passes prompts that aren't what's wanted, until one is. */
        JsonNode until(java.util.function.Predicate<JsonNode> wanted) throws Exception {
            long end = System.currentTimeMillis() + 60_000;
            while (System.currentTimeMillis() < end) {
                String s = sent.poll(500, TimeUnit.MILLISECONDS);
                JsonNode m = s == null ? json.createObjectNode() : json.readTree(s);
                if (m.path("t").asText().equals("ask")) {
                    seat.answer(m.path("id").asInt(), json.readTree("[0]"), null);
                } else if (m.path("t").asText().equals("prompt") && m.path("ok").path("enabled").asBoolean()) {
                    if (wanted.test(m)) {
                        return m;
                    }
                    GameSessionTest.pass(controller());
                }
            }
            throw new AssertionError(name + " never got the prompt");
        }
    }

    private static boolean priority(JsonNode prompt) {
        return prompt.path("cancel").path("label").asText().equals("End Turn");
    }

    private static void within(long ms, String what, java.util.function.BooleanSupplier done) throws InterruptedException {
        long end = System.currentTimeMillis() + ms;
        while (!done.getAsBoolean()) {
            if (System.currentTimeMillis() > end) {
                StringBuilder at = new StringBuilder();
                Thread.getAllStackTraces().forEach((t, trace) -> {
                    if (t.getName().startsWith("Game") || t.getName().equals("forge-ui")) {
                        at.append('\n').append(t.getName()).append(' ').append(t.getState());
                        for (int i = 0; i < Math.min(12, trace.length); i++) {
                            at.append("\n    ").append(trace[i]);
                        }
                    }
                });
                Assert.fail(what + " within " + ms + " ms" + at);
            }
            Thread.sleep(20);
        }
    }

    private Person alone() {
        Person you = new Person("You");
        you.session = GameSession.startCommander(List.of(
                you.seat("Ezuri, Renegade Leader", "Forest"),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null),
                new GameSession.Seat("AI 2", deck("Krenko, Mob Boss", "Mountain"), null),
                new GameSession.Seat("AI 3", deck("Isamaru, Hound of Konda", "Plains"), null)), 4);
        return you;
    }

    private void endsWith(Person you, int delayMs) throws Exception {
        Game g = you.session.game();
        Player me = you.player();
        // The thread that plays the game, and the one that took you out of it and ended it.
        AtomicReference<Thread> plays = new AtomicReference<>();
        AtomicReference<Thread> ended = new AtomicReference<>();
        g.subscribeToEvents(new Object() {
            @Subscribe
            public void on(GameEvent ev) {
                if (ev instanceof GameEventPlayerPriority) {
                    plays.set(Thread.currentThread());
                } else if (ev instanceof GameEventGameOutcome) {
                    ended.set(Thread.currentThread());
                }
            }
        });
        Thread.sleep(delayMs);
        you.concede();
        within(20_000, "the game ends", () -> GameSession.isOver(g));
        Assert.assertTrue(me.conceded(), "you're out because you conceded");
        within(5_000, "the game says it's over", () -> ended.get() != null);
        Assert.assertNotNull(plays.get(), "at a priority");
        Assert.assertSame(ended.get(), plays.get(), "on the game's own thread");
    }

    /** Whatever the game is doing when you do it: conceding just after you pass, while the AI play on. */
    @Test(timeOut = 600_000)
    public void whileTheGameIsBusy() throws Exception {
        for (int i = 0; i < 12; i++) {
            MyRandom.setRandom(new Random(100 + i));
            Person you = alone();
            try {
                you.until(ConcedeTest::priority);
                GameSessionTest.pass(you.controller());
                endsWith(you, i * 7);
            } finally {
                you.seat.close();
                you.session.abort();
            }
        }
    }

    /** With priority, and before the game has properly begun (the die roll, the mulligan). */
    @Test(timeOut = 300_000)
    public void whileTheGameWaitsForYou() throws Exception {
        for (int i = 0; i < 4; i++) {
            MyRandom.setRandom(new Random(200 + i));
            Person you = alone();
            boolean mulligan = i % 2 == 0;
            try {
                // (the first prompt is the die roll's if you won it, else the mulligan's)
                you.until(mulligan ? m -> true : ConcedeTest::priority);
                endsWith(you, 0);
            } finally {
                you.seat.close();
                you.session.abort();
            }
        }
    }

    /** Someone else has priority: they're asked again, and the game goes on without you. */
    @Test(timeOut = 240_000)
    public void whileSomeoneElseHasPriority() throws Exception {
        MyRandom.setRandom(new Random(300));
        Person ana = new Person("Ana");
        Person bob = new Person("Bob");
        GameSession s = GameSession.startCommander(List.of(
                ana.seat("Ezuri, Renegade Leader", "Forest"),
                bob.seat("Krenko, Mob Boss", "Mountain"),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)), 4);
        ana.session = s;
        bob.session = s;
        try {
            // Both play until Bob has priority.
            Thread anaPlays = new Thread(() -> {
                try {
                    ana.until(m -> false);
                } catch (Throwable ended) {
                    // her prompts stopped, as they should
                }
            });
            anaPlays.setDaemon(true);
            anaPlays.start();
            bob.until(ConcedeTest::priority);
            Game g = s.game();
            Player anaIn = ana.player();
            ana.concede();
            within(10_000, "Ana is out", () -> anaIn.hasLost() && !g.getPlayers().contains(anaIn));
            Assert.assertFalse(GameSession.isOver(g), "Bob plays on against the AI");
            // Bob was asked again, and passing moves the game along.
            String at = g.getPhaseHandler().getTurn() + " " + g.getPhaseHandler().getPhase();
            GameSessionTest.pass(bob.controller());
            bob.until(m -> priority(m) && !at.equals(g.getPhaseHandler().getTurn() + " " + g.getPhaseHandler().getPhase()));
            bob.concede();
            within(20_000, "the game ends with nobody left", () -> GameSession.isOver(g));
        } finally {
            ana.seat.close();
            bob.seat.close();
            s.abort();
        }
    }
}
