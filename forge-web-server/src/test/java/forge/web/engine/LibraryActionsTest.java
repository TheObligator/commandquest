package forge.web.engine;

import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
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
}
