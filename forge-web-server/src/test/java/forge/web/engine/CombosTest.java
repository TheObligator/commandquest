package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gui.FThreads;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Recording a combo by playing it once, and running it again. */
public class CombosTest {

    private static final ObjectMapper JSON = new ObjectMapper();

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

    private static void waitFor(String what, BooleanSupplier cond) throws InterruptedException {
        long end = System.currentTimeMillis() + 60_000;
        while (!cond.getAsBoolean()) {
            Assert.assertTrue(System.currentTimeMillis() < end, "timed out waiting: " + what);
            Thread.sleep(5);
        }
    }

    /** A person at the table, seen through the messages their browser gets. */
    private static final class Person {
        final List<JsonNode> got = new CopyOnWriteArrayList<>();
        final BrowserSeat seat = new BrowserSeat(JSON, s -> {
            try {
                JsonNode m = JSON.readTree(s);
                if (!m.path("t").asText().equals("state")) {
                    got.add(m);
                }
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        GameSession session;

        Game game() {
            return session.game();
        }

        WebPlayerController ctl() {
            return seat.webController();
        }

        Player me() {
            return ctl().getPlayer();
        }

        boolean priority() {
            return ctl() != null && ctl().getInputQueue().getInput() instanceof forge.gamemodes.match.input.InputPassPriority
                    && seat.shownInput() == ctl().getInputQueue().getInput();
        }

        boolean ready() {
            return seat.openAsk() != null || (ctl() != null && ctl().getInputQueue().getInput() != null
                    && seat.shownInput() == ctl().getInputQueue().getInput());
        }

        /** Does what a browser message does, noted for a recording as GameHub does, and waits for the next thing to do. */
        void move(String t, Integer id, String label) throws Exception {
            waitFor("my move", this::ready);
            ObjectNode m = JSON.createObjectNode().put("t", t);
            if (id != null) {
                m.put("id", id);
            }
            if (label != null) {
                m.put("label", label);
            }
            var before = ctl().getInputQueue().getInput();
            edt(() -> {
                seat.combos().note(m);
                switch (t) {
                    case "ok" -> Payment.ok(ctl(), me());
                    case "player" -> ctl().selectPlayer(game().getPlayer(id).getView(), null);
                    default -> {
                        if (label != null) {
                            seat.prefer(-1, label);
                        }
                        try {
                            ctl().selectCard(game().findById(id).getView(), null, null);
                        } finally {
                            seat.prefer(null, null);
                        }
                    }
                }
            });
            waitFor("something after " + m, () -> ctl().getInputQueue().getInput() != before || seat.openAsk() != null);
            waitFor("my move again after " + m, this::ready);
        }

        void answer(String label) throws Exception {
            waitFor("a question", () -> seat.openAsk() != null);
            ObjectNode ask = seat.openAsk();
            ObjectNode m = JSON.createObjectNode().put("t", "answer").put("id", ask.path("id").asInt());
            var choice = m.putArray("choice");
            for (int i = 0; i < ask.path("options").size(); i++) {
                if (ask.path("options").get(i).path("label").asText().equals(label)) {
                    choice.add(i);
                }
            }
            seat.combos().note(m);
            seat.answer(ask.path("id").asInt(), choice, null);
            waitFor("my move after answering", () -> seat.openAsk() == null && ready());
        }

        String call(java.util.function.Supplier<String> f) throws Exception {
            String[] out = new String[1];
            edt(() -> out[0] = f.get());
            return out[0];
        }

        void run(int times) throws Exception {
            int id = seat.combos().json().path("list").get(0).path("id").asInt();
            Assert.assertNull(call(() -> seat.combos().run(id, times)), "it starts");
            waitFor("the run ends", () -> !seat.combos().running());
            edt(() -> { });
            waitFor("priority again", this::priority);
        }

        String lastNotice() {
            String out = null;
            for (JsonNode m : got) {
                if (m.path("t").asText().equals("notice")) {
                    out = m.path("message").asText();
                }
            }
            return out;
        }
    }

    private static void edt(Runnable r) throws Exception {
        CompletableFuture<Void> done = new CompletableFuture<>();
        FThreads.invokeInEdtLater(() -> {
            try {
                r.run();
                done.complete(null);
            } catch (RuntimeException e) {
                done.completeExceptionally(e);
            }
        });
        done.get(20, TimeUnit.SECONDS);
    }

    /** A game against AI, stopped in your first main phase with nothing on the stack. */
    private static Person table(int seed, int rewind) throws Exception {
        MyRandom.setRandom(new Random(seed));
        Person p = new Person();
        p.session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), p.seat),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)), rewind);
        long end = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < end) {
            if (p.ready()) {
                if (p.priority() && p.game().getPhaseHandler().isPlayerTurn(p.me())
                        && p.game().getPhaseHandler().getPhase() == PhaseType.MAIN1 && p.game().getStack().isEmpty()) {
                    return p;
                }
                ObjectNode ask = p.seat.openAsk();
                if (ask != null) {
                    p.seat.answerOpenWithDefaults();
                } else {
                    GameSessionTest.pass(p.ctl());
                }
            }
            Thread.sleep(30);
        }
        throw new AssertionError("never reached your main phase");
    }

    private static Card make(Person p, String name) throws Exception {
        return UseLaterTest.onGameThread(p.game(), () -> {
            Card c = UseLaterTest.make(p.me(), name, ZoneType.Battlefield);
            c.setSickness(false);
            p.game().getTriggerHandler().resetActiveTriggers();
            return c;
        });
    }

    private static String ability(Card c, Player me, boolean mana) {
        for (SpellAbility sa : c.getAllPossibleAbilities(me, false)) {
            if (sa.isActivatedAbility() && sa.isManaAbility() == mana) {
                return sa.getView().getDescription();
            }
        }
        throw new AssertionError("no such ability");
    }

    private static int colorless(Person p) {
        return p.me().getManaPool().getAmountOfColor((byte) forge.card.mana.ManaAtom.COLORLESS);
    }

    /** Basalt Monolith with Forsaken Monument: {C}{C}{C}{C}, then {3} to untap it. */
    private static void recordMonolith(Person p) throws Exception {
        Card monolith = make(p, "Basalt Monolith");
        make(p, "Forsaken Monument");
        Assert.assertNull(p.call(p.seat.combos()::record));
        p.move("ability", monolith.getId(), ability(monolith, p.me(), true));
        Assert.assertEquals(colorless(p), 4, "four mana");
        p.move("ability", monolith.getId(), ability(monolith, p.me(), false));
        if (!p.priority()) {
            p.move("ok", null, null); // Auto-pay, from the pool
        }
        waitFor("the untap ability on the stack", () -> p.priority() && p.game().getStack().size() == 1);
        p.move("ok", null, null);
        waitFor("it resolved", () -> p.priority() && p.game().getStack().isEmpty());
        Assert.assertEquals(colorless(p), 1, "one more than before");
        Assert.assertNull(p.call(() -> p.seat.combos().keep("Monolith mana")));
    }

    @Test(timeOut = 240_000)
    public void infiniteManaRunsAsOftenAsAskedAndIsOneStepBack() throws Exception {
        Person p = table(21, 4);
        try {
            recordMonolith(p);
            JsonNode combo = p.seat.combos().json().path("list").get(0);
            Assert.assertEquals(combo.path("name").asText(), "Monolith mana");
            Assert.assertTrue(combo.path("loops").asBoolean(), "it ends where it started: " + combo);
            Assert.assertEquals(combo.path("gains").toString(), "[\"+1 {C}\"]", combo.toString());

            int points = p.session.rewind().options(p.me()).size();
            p.run(100);
            Assert.assertEquals(colorless(p), 101, "a hundred more; " + p.lastNotice());
            Assert.assertEquals(p.lastNotice(), "Monolith mana: ran 100 times.");
            Assert.assertTrue(p.session.rewind().options(p.me()).size() <= points + 2, "the run is a step back, not hundreds: " + p.session.rewind().options(p.me()).size());

            // Not from just anywhere, and Stop stops it.
            Assert.assertNull(p.call(() -> p.seat.combos().run(1, 0)), "until stopped");
            waitFor("a few loops", () -> colorless(p) > 110);
            p.seat.combos().stop();
            waitFor("stopped", () -> !p.seat.combos().running());
            edt(() -> { });
            int now = colorless(p);
            Thread.sleep(200);
            Assert.assertEquals(colorless(p), now, "nothing more happens by itself");
            Assert.assertTrue(p.lastNotice().startsWith("Monolith mana: ran "), p.lastNotice());
        } finally {
            p.session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void aRunStopsWhenAStepCantBeDone() throws Exception {
        Person p = table(22, 0);
        try {
            recordMonolith(p);
            Card monument = p.me().getCardsIn(ZoneType.Battlefield).stream().filter(c -> c.getName().equals("Forsaken Monument")).findFirst().orElseThrow();
            UseLaterTest.onGameThread(p.game(), () -> p.game().getAction().moveToGraveyard(monument, null));
            p.run(3);
            Assert.assertEquals(colorless(p), 1, "each loop breaks even without the Monument");
            Card monolith = p.me().getCardsIn(ZoneType.Battlefield).stream().filter(c -> c.getName().equals("Basalt Monolith")).findFirst().orElseThrow();
            UseLaterTest.onGameThread(p.game(), () -> p.game().getAction().moveToGraveyard(monolith, null));
            p.run(5);
            Assert.assertEquals(p.lastNotice(), "Monolith mana: ran 0 times, then stopped: Basalt Monolith isn't there.");
        } finally {
            p.session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void targetsAndAnswersArePlayedAgain() throws Exception {
        Person p = table(23, 0);
        try {
            // Walking Ballista-like: Triskelion removes +1/+1 counters to deal 1 damage to any target.
            Card trike = make(p, "Triskelion");
            Player ai = p.game().getPlayers().stream().filter(x -> x != p.me()).findFirst().orElseThrow();
            int life = ai.getLife();
            UseLaterTest.onGameThread(p.game(), () -> {
                trike.setCounters(forge.game.card.CounterEnumType.P1P1, 5);
                return null;
            });
            Assert.assertNull(p.call(p.seat.combos()::record));
            p.move("ability", trike.getId(), ability(trike, p.me(), false));
            p.move("player", ai.getId(), null);
            for (int i = 0; i < 5 && !(p.priority() && p.game().getStack().size() == 1); i++) {
                p.move("ok", null, null); // done targeting, paying the counter
            }
            p.move("ok", null, null);
            waitFor("it resolved", () -> p.priority() && p.game().getStack().isEmpty());
            Assert.assertEquals(ai.getLife(), life - 1);
            Assert.assertNull(p.call(() -> p.seat.combos().keep("")));
            JsonNode combo = p.seat.combos().json().path("list").get(0);
            Assert.assertTrue(combo.path("gains").toString().contains("−1 life"), combo.toString());
            p.run(10);
            Assert.assertEquals(ai.getLife(), life - 5, "until the counters ran out; " + p.lastNotice());
            Assert.assertTrue(p.lastNotice().startsWith("Combo 1: ran 4 times, then stopped: "), p.lastNotice());
        } finally {
            p.session.abort();
        }
    }

    /** Basalt Monolith with Rings of Brighthearth: an optional payment, a copy, and tapping in response. */
    @Test(timeOut = 240_000)
    public void aLoopWithATriggerYouPayFor() throws Exception {
        Person p = table(25, 2);
        try {
            Card monolith = make(p, "Basalt Monolith");
            make(p, "Rings of Brighthearth");
            UseLaterTest.onGameThread(p.game(), () -> {
                for (int i = 0; i < 2; i++) {
                    UseLaterTest.make(p.me(), "Sol Ring", ZoneType.Battlefield);
                }
                return null;
            });
            // Two mana to start with, floating.
            for (Card ring : List.copyOf(p.me().getCardsIn(ZoneType.Battlefield)).stream().filter(c -> c.getName().equals("Sol Ring")).limit(1).toList()) {
                p.move("ability", ring.getId(), ability(ring, p.me(), true));
            }
            Assert.assertEquals(colorless(p), 2);
            Assert.assertNull(p.call(p.seat.combos()::record));
            p.move("ability", monolith.getId(), ability(monolith, p.me(), true));
            p.move("ability", monolith.getId(), ability(monolith, p.me(), false));
            boolean tapped = false;
            for (int i = 0; i < 30 && !(p.priority() && p.game().getStack().isEmpty()); i++) {
                ObjectNode ask = p.seat.openAsk();
                if (ask != null) {
                    p.answer(ask.path("options").get(0).path("label").asText());
                } else if (p.priority() && !tapped && !monolith.isTapped()) {
                    tapped = true;  // the copy untapped it: tap it again with the first one still on the stack
                    p.move("ability", monolith.getId(), ability(monolith, p.me(), true));
                } else {
                    p.move("ok", null, null);
                }
            }
            Assert.assertEquals(colorless(p), 3, "one more than before: " + p.seat.combos().json());
            Assert.assertFalse(monolith.isTapped());
            Assert.assertNull(p.call(() -> p.seat.combos().keep("Rings")));
            JsonNode combo = p.seat.combos().json().path("list").get(0);
            Assert.assertTrue(combo.path("loops").asBoolean(), combo.toString());
            Assert.assertEquals(combo.path("gains").toString(), "[\"+1 {C}\"]", combo.toString());
            p.run(40);
            Assert.assertEquals(colorless(p), 43, p.lastNotice() + " " + combo);
        } finally {
            p.session.abort();
        }
    }

    /** An opponent doing something in response stops it. */
    @Test(timeOut = 240_000)
    public void somethingElseOnTheStackStopsIt() throws Exception {
        Person p = table(26, 0);
        try {
            recordMonolith(p);
            Card mine = p.me().getCardsIn(ZoneType.Battlefield).stream().filter(c -> c.getName().equals("Basalt Monolith")).findFirst().orElseThrow();
            // A trigger that wasn't there when it was recorded.
            make(p, "Harsh Mentor");
            Card mentor = p.me().getCardsIn(ZoneType.Battlefield).stream().filter(c -> c.getName().equals("Harsh Mentor")).findFirst().orElseThrow();
            Player ai = p.game().getPlayers().stream().filter(x -> x != p.me()).findFirst().orElseThrow();
            UseLaterTest.onGameThread(p.game(), () -> {
                mentor.setController(ai, p.game().getNextTimestamp());
                p.game().getAction().controllerChangeZoneCorrection(mentor);
                p.game().getTriggerHandler().resetActiveTriggers();
                return null;
            });
            p.run(5);
            Assert.assertEquals(p.lastNotice(), "Monolith mana: ran 0 times, then stopped: something else is on the stack.");
            Assert.assertTrue(mine.isTapped(), "left as it was");
        } finally {
            p.session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void whatDoesntComeBackAroundRunsOnce() throws Exception {
        Person p = table(24, 0);
        try {
            Card monolith = make(p, "Basalt Monolith");
            Assert.assertNotNull(p.call(() -> p.seat.combos().keep("x")), "nothing is being recorded");
            Assert.assertNull(p.call(p.seat.combos()::record));
            Assert.assertNotNull(p.call(() -> p.seat.combos().keep("x")), "nothing was recorded");
            Assert.assertNull(p.call(p.seat.combos()::record));
            p.move("ability", monolith.getId(), ability(monolith, p.me(), true));
            Assert.assertNull(p.call(() -> p.seat.combos().keep("Just tap it")));
            JsonNode combo = p.seat.combos().json().path("list").get(0);
            Assert.assertFalse(combo.path("loops").asBoolean(), "the Monolith stays tapped");
            Assert.assertTrue(combo.path("gains").toString().contains("Basalt Monolith stays tapped"), combo.toString());
            Assert.assertNotNull(p.call(() -> p.seat.combos().run(1, 2)), "only once at a time");
            Assert.assertNull(p.call(() -> {
                p.seat.combos().rename(1, "  Tap  ");
                return null;
            }));
            Assert.assertEquals(p.seat.combos().json().path("list").get(0).path("name").asText(), "Tap");
            p.seat.combos().remove(1);
            Assert.assertNull(p.seat.combos().json());
        } finally {
            p.session.abort();
        }
    }

    @Test
    public void questionsAreComparedWithoutIdsAndNumbers() {
        Assert.assertEquals(Combos.plain("Sacrifice Goblin (123)? You have 7 life"), Combos.plain("Sacrifice Goblin (9)?  You have 12 life"));
        Assert.assertNotEquals(Combos.plain("Draw a card?"), Combos.plain("Discard a card?"));
    }
}
