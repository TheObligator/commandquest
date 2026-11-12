package forge.web.engine;

import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Free play on your own library in a real game: draw, mill, exile, reveal the top card, shuffle. */
public class LibraryActionsTest {

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

    private static void run(ManualActions manual, Game g, Player me, String action, int n, List<Player> to) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        Assert.assertTrue(manual.library(g, me, action, n, to, done::countDown), action + " applies");
        Assert.assertTrue(done.await(10, TimeUnit.SECONDS), action + " ran");
    }

    @Test(timeOut = 240_000)
    public void drawMillExileRevealShuffle() throws Exception {
        MyRandom.setRandom(new Random(4));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Player ai = g.getPlayers().stream().filter(p -> p != me).findFirst().orElseThrow();
            ManualActions manual = new ManualActions();
            int lib = me.getCardsIn(ZoneType.Library).size();
            int hand = me.getCardsIn(ZoneType.Hand).size();
            int grave = me.getCardsIn(ZoneType.Graveyard).size();
            int exile = me.getCardsIn(ZoneType.Exile).size();

            run(manual, g, me, "draw", 2, null);
            Assert.assertEquals(me.getCardsIn(ZoneType.Hand).size(), hand + 2, "drew two");
            run(manual, g, me, "mill", 3, null);
            Assert.assertEquals(me.getCardsIn(ZoneType.Graveyard).size(), grave + 3, "milled three");
            run(manual, g, me, "exile", 1, null);
            Assert.assertEquals(me.getCardsIn(ZoneType.Exile).size(), exile + 1, "exiled one");
            run(manual, g, me, "revealTop", 1, List.of(ai));
            run(manual, g, me, "shuffle", 1, null);
            Assert.assertEquals(me.getCardsIn(ZoneType.Library).size(), lib - 6, "library shrank by six");
            Assert.assertFalse(manual.library(g, me, "nonsense", 1, null, () -> { }), "unknown action");
            Assert.assertFalse(manual.library(g, me, "revealTop", 1, List.of(), () -> { }), "reveal needs someone to show");
            String log = String.join("\n", g.getGameLog().getAllEntries().stream().map(e -> e.message()).toList());
            for (String s : List.of("drew 2 cards (by hand)", "milled 3 cards: ", "exiled the top card of their library: ", "revealed the top card", "shuffled their library (by hand)")) {
                Assert.assertTrue(log.contains(s), "log has '" + s + "':\n" + log);
            }
        } finally {
            session.abort();
        }
    }

    /** "Put onto the battlefield" without casting: permanent cards only. */
    @Test(timeOut = 240_000)
    public void putOntoBattlefieldOnlyPermanents() throws Exception {
        MyRandom.setRandom(new Random(5));
        Deck mine = deck("Ezuri, Renegade Leader", "Forest");
        mine.getMain().add("Giant Growth", 1);
        mine.getMain().add("Llanowar Elves", 1);
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", mine, browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            ManualActions manual = new ManualActions();
            Card growth = me.getAllCards().stream().filter(c -> c.getName().equals("Giant Growth")).findFirst().orElseThrow();
            Card elves = me.getAllCards().stream().filter(c -> c.getName().equals("Llanowar Elves")).findFirst().orElseThrow();
            Assert.assertFalse(manual.run(g, me, growth, "toBattlefield", null, () -> { }), "an instant can't be put onto the battlefield");
            CountDownLatch done = new CountDownLatch(1);
            Assert.assertTrue(manual.run(g, me, elves, "toBattlefield", null, done::countDown), "a creature can");
            Assert.assertTrue(done.await(10, TimeUnit.SECONDS), "it ran");
            Assert.assertTrue(me.getCardsIn(ZoneType.Battlefield).stream().anyMatch(c -> c.getName().equals("Llanowar Elves")), "elves on the battlefield");
            Assert.assertTrue(g.getStack().isEmpty(), "nothing was cast");

            // Plot from hand, discard from hand, phase out.
            for (String step : List.of("toHand", "plot")) {
                CountDownLatch d = new CountDownLatch(1);
                Assert.assertTrue(manual.run(g, me, g.getCardState(growth), step, null, d::countDown), step);
                Assert.assertTrue(d.await(10, TimeUnit.SECONDS), step + " ran");
            }
            Card plotted = g.getCardState(growth);
            Assert.assertTrue(plotted.isInZone(ZoneType.Exile) && plotted.isPlotted(), "plotted in exile");
            Card forest = me.getCardsIn(ZoneType.Hand).getFirst();
            int grave = me.getCardsIn(ZoneType.Graveyard).size();
            CountDownLatch d1 = new CountDownLatch(1);
            Assert.assertTrue(manual.run(g, me, forest, "discard", null, d1::countDown), "discard");
            Assert.assertTrue(d1.await(10, TimeUnit.SECONDS));
            Assert.assertEquals(me.getCardsIn(ZoneType.Graveyard).size(), grave + 1, "discarded");
            // Exile face down so only you may look at it (foretell, hideaway): hidden from the AI.
            Card secret = me.getCardsIn(ZoneType.Hand).getFirst();
            Player ai = g.getPlayers().stream().filter(p -> p != me).findFirst().orElseThrow();
            CountDownLatch d3 = new CountDownLatch(1);
            Assert.assertTrue(manual.run(g, me, secret, "exileFaceDown", List.of(me), d3::countDown), "exile face down");
            Assert.assertTrue(d3.await(10, TimeUnit.SECONDS));
            Card hidden = g.getCardState(secret);
            Assert.assertTrue(hidden.isInZone(ZoneType.Exile) && hidden.isFaceDown(), "face down in exile");
            Assert.assertTrue(hidden.getView().canFaceDownBeShownTo(me.getView()), "you may look at it");
            Assert.assertFalse(hidden.getView().canFaceDownBeShownTo(ai.getView()), "the AI may not");
            Card inPlay = g.getCardState(elves);
            CountDownLatch d2 = new CountDownLatch(1);
            Assert.assertTrue(manual.run(g, me, inPlay, "phaseOut", null, d2::countDown), "phase out");
            Assert.assertTrue(d2.await(10, TimeUnit.SECONDS));
            Assert.assertTrue(g.getCardState(inPlay).isPhasedOut(), "phased out");
        } finally {
            session.abort();
        }
    }

    private static void arrange(ManualActions manual, Game g, Player me, String kind, List<Integer> top, List<Integer> away) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        Assert.assertTrue(manual.arrange(g, me, kind, top, away, done::countDown), kind + " applies");
        Assert.assertTrue(done.await(10, TimeUnit.SECONDS), kind + " ran");
    }

    /** Scry and surveil by hand: the cards go where you put them, through Forge's own scry and surveil. */
    @Test(timeOut = 240_000)
    public void scryAndSurveil() throws Exception {
        MyRandom.setRandom(new Random(7));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            ManualActions manual = new ManualActions();
            List<Integer> ids = me.getCardsIn(ZoneType.Library).stream().limit(3).map(Card::getId).toList();
            int a = ids.get(0), b = ids.get(1), c = ids.get(2);
            int lib = me.getCardsIn(ZoneType.Library).size();

            // Scry 3: c then a on top, b to the bottom.
            arrange(manual, g, me, "scry", List.of(c, a), List.of(b));
            List<Card> now = new java.util.ArrayList<>(me.getCardsIn(ZoneType.Library));
            Assert.assertEquals(now.get(0).getId(), c, "c on top");
            Assert.assertEquals(now.get(1).getId(), a, "then a");
            Assert.assertEquals(now.get(now.size() - 1).getId(), b, "b on the bottom");

            // Surveil 2: a into the graveyard, c stays.
            int grave = me.getCardsIn(ZoneType.Graveyard).size();
            arrange(manual, g, me, "surveil", List.of(c), List.of(a));
            Assert.assertEquals(me.getCardsIn(ZoneType.Library).get(0).getId(), c, "c still on top");
            Assert.assertEquals(me.getCardsIn(ZoneType.Graveyard).size(), grave + 1, "a in the graveyard");
            Assert.assertEquals(me.getCardsIn(ZoneType.Library).size(), lib - 1, "one card left the library");

            Assert.assertFalse(manual.arrange(g, me, "scry", List.of(b), List.of(), () -> { }), "b isn't on top any more");
            Assert.assertFalse(manual.arrange(g, me, "scry", List.of(c, c), List.of(), () -> { }), "the same card twice");
            String log = String.join("\n", g.getGameLog().getAllEntries().stream().map(e -> e.message()).toList());
            Assert.assertTrue(log.contains("scried 3: 2 on top, 1 on the bottom (by hand)"), log);
            Assert.assertTrue(log.contains("surveilled 2: 1 on top, 1 into the graveyard (by hand)"), log);
        } finally {
            session.abort();
        }
    }

    private static void ok(ManualActions manual, Game g, Player me, Card card, String action, List<Player> to) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        Assert.assertTrue(manual.run(g, me, card, action, to, done::countDown), action + " applies");
        Assert.assertTrue(done.await(10, TimeUnit.SECONDS), action + " ran");
    }

    /** Foretell and suspend from hand, letting a card be cast from exile, and exiling from someone else's library. */
    @Test(timeOut = 240_000)
    public void foretellSuspendCastAndSearchersExile() throws Exception {
        MyRandom.setRandom(new Random(8));
        Deck mine = deck("Ezuri, Renegade Leader", "Forest");
        mine.getMain().add("Grizzly Bears", 3);
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", mine, browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Player ai = g.getPlayers().stream().filter(p -> p != me).findFirst().orElseThrow();
            ManualActions manual = new ManualActions();
            List<Card> bears = me.getAllCards().stream().filter(c -> c.getName().equals("Grizzly Bears")).toList();
            for (Card b : bears) {
                ok(manual, g, me, g.getCardState(b), "toHand", null);
            }

            // Foretell: face down in exile, foretold, only you may look.
            ok(manual, g, me, g.getCardState(bears.get(0)), "foretell", null);
            Card foretold = g.getCardState(bears.get(0));
            Assert.assertTrue(foretold.isInZone(ZoneType.Exile) && foretold.isFaceDown() && foretold.isForetold(), "foretold");
            Assert.assertTrue(foretold.getView().canFaceDownBeShownTo(me.getView()) && !foretold.getView().canFaceDownBeShownTo(ai.getView()), "only you look");

            // Suspend 3: exiled with three time counters and gains suspend.
            ok(manual, g, me, g.getCardState(bears.get(1)), "suspend:3", null);
            Card suspended = g.getCardState(bears.get(1));
            Assert.assertEquals(suspended.getCounters(forge.game.card.CounterEnumType.TIME), 3, "three time counters");
            Assert.assertTrue(suspended.hasKeyword(forge.game.keyword.Keyword.SUSPEND), "gains suspend");

            // Let yourself cast an exiled card for free: Forge then offers casting it from exile.
            ok(manual, g, me, g.getCardState(bears.get(2)), "toExile", null);
            Card exiled = g.getCardState(bears.get(2));
            ok(manual, g, me, exiled, "cast:free", null);
            Assert.assertFalse(exiled.mayPlay(me).isEmpty(), "you may cast it");
            Assert.assertFalse(manual.run(g, me, exiled, "cast:cost:DROP TABLE", null, () -> { }), "a cost must be mana symbols");
            Assert.assertFalse(manual.run(g, ai, exiled, "cast:free", null, () -> { }), "not someone else's face-up card");

            // The AI "searches" your library and exiles a card face down that only it may look at.
            Card top = me.getCardsIn(ZoneType.Library).getFirst();
            ok(manual, g, ai, top, "exileFaceDown", List.of(ai));
            Card taken = g.getCardState(top);
            Assert.assertTrue(taken.isInZone(ZoneType.Exile) && taken.getOwner() == me, "in your exile");
            Assert.assertTrue(taken.getView().canFaceDownBeShownTo(ai.getView()) && !taken.getView().canFaceDownBeShownTo(me.getView()), "only the searcher looks");
            Assert.assertTrue(ManualActions.castable(taken, ai), "the searcher may be let cast it");
            Assert.assertFalse(ManualActions.castable(foretold, ai), "but not your foretold card");
        } finally {
            session.abort();
        }
    }
}
