package forge.web.engine;

import forge.card.MagicColor;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.mana.Mana;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.util.MyRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Clicking a land you tapped for mana again untaps it, while its mana is still unspent in your pool. */
public class ManaUndoTest {

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    private static <T> T onGameThread(Game g, Supplier<T> f) throws Exception {
        CompletableFuture<T> out = new CompletableFuture<>();
        g.getAction().invoke(() -> {
            try {
                out.complete(f.get());
            } catch (RuntimeException e) {
                out.completeExceptionally(e);
            }
        });
        return out.get(10, TimeUnit.SECONDS);
    }

    private static Card named(Player p, String name) {
        return p.getAllCards().stream().filter(c -> c.getName().equals(name)).findFirst().orElseThrow(() -> new AssertionError("no " + name));
    }

    @Test(timeOut = 240_000)
    public void untapWhileTheManaIsUnspent() throws Exception {
        MyRandom.setRandom(new Random(7));
        Deck d = new Deck("Lands");
        d.getOrCreate(DeckSection.Commander).add("Kenrith, the Returned King", 1);
        d.getMain().add("Island", 96);
        d.getMain().add("Tropical Island", 1);
        d.getMain().add("Sol Ring", 1);
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        Deck ai = new Deck("Ezuri");
        ai.getOrCreate(DeckSection.Commander).add("Ezuri, Renegade Leader", 1);
        ai.getMain().add("Forest", 99);
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", d, browser),
                new GameSession.Seat("AI 1", ai, null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            ManualActions manual = new ManualActions();
            for (String name : List.of("Tropical Island", "Sol Ring")) {
                CountDownLatch done = new CountDownLatch(1);
                Assert.assertTrue(manual.run(g, me, named(me, name), "toBattlefield", null, done::countDown), name);
                Assert.assertTrue(done.await(10, TimeUnit.SECONDS), name + " in play");
            }
            Card trop = g.getCardState(named(me, "Tropical Island"));
            Card ring = g.getCardState(named(me, "Sol Ring"));
            Map<Integer, List<ManaTaps.Pick>> opts = onGameThread(g, () -> ManaTaps.options(g, me, List.of(trop, ring)));
            ManaTaps.Pick green = opts.get(trop.getId()).stream().filter(p -> p.mana().equals("G")).findFirst().orElseThrow();
            ManaTaps.Pick colorless = opts.get(ring.getId()).get(0);
            Assert.assertEquals(onGameThread(g, () -> ManaTaps.tap(g, me, List.of(green, colorless))).intValue(), 2);
            Assert.assertTrue(trop.isTapped() && ring.isTapped());
            Assert.assertEquals(me.getManaPool().totalMana(), 3, "G and CC floating");

            Assert.assertFalse(onGameThread(g, () -> ManaUndo.untap(g, me, g.findById(named(me, "Island").getId()))), "an untapped card: nothing to undo");
            Assert.assertTrue(onGameThread(g, () -> ManaUndo.untap(g, me, trop)), "Tropical Island's G is unspent");
            Assert.assertFalse(trop.isTapped(), "untapped again");
            Assert.assertEquals(me.getManaPool().getAmountOfColor(MagicColor.GREEN), 0, "its G is gone");
            Assert.assertEquals(me.getManaPool().totalMana(), 2, "Sol Ring's CC stays");

            // Spend one of Sol Ring's {C}: its mana isn't all there any more, so it stays tapped.
            onGameThread(g, () -> {
                List<Mana> pool = new ArrayList<>();
                me.getManaPool().forEach(pool::add);
                return me.getManaPool().removeMana(pool.get(0));
            });
            Assert.assertNull(onGameThread(g, () -> ManaUndo.undoable(g, me, ring)), "half spent");
            Assert.assertFalse(onGameThread(g, () -> ManaUndo.untap(g, me, ring)));
            Assert.assertTrue(ring.isTapped(), "still tapped");
        } finally {
            session.abort();
        }
    }
}
