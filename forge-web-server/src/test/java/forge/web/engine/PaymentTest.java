package forge.web.engine;

import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.ability.AbilityKey;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.model.FModel;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/**
 * Paying mana from the browser in a real game: Auto-pay taps a basic before a dual land, and free
 * play pays a spell's mana cost with nothing.
 */
public class PaymentTest {

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

    private static <T> T onGameThread(Game g, Supplier<T> f) throws Exception {
        CompletableFuture<T> r = new CompletableFuture<>();
        g.getAction().invoke(() -> {
            try {
                r.complete(f.get());
            } catch (RuntimeException e) {
                r.completeExceptionally(e);
            }
        });
        return r.get(10, TimeUnit.SECONDS);
    }

    private static <T> T onUiThread(Supplier<T> f) throws Exception {
        CompletableFuture<T> r = new CompletableFuture<>();
        FThreads.invokeInEdtLater(() -> {
            try {
                r.complete(f.get());
            } catch (RuntimeException e) {
                r.completeExceptionally(e);
            }
        });
        return r.get(10, TimeUnit.SECONDS);
    }

    private static void waitFor(BooleanSupplier cond, String what) throws InterruptedException {
        long end = System.currentTimeMillis() + 15_000;
        while (!cond.getAsBoolean()) {
            if (System.currentTimeMillis() > end) {
                Assert.fail("timed out waiting for " + what);
            }
            Thread.sleep(50);
        }
    }

    private static Card make(Player p, String name, ZoneType zone) {
        Card c = Card.fromPaperCard(FModel.getMagicDb().getCommonCards().getCard(name), p);
        Game g = p.getGame();
        return zone == ZoneType.Battlefield
                ? g.getAction().moveToPlay(c, p, null, AbilityKey.newMap())
                : g.getAction().moveTo(zone, c, null, AbilityKey.newMap());
    }

    @Test(timeOut = 240_000)
    public void autoPayPrefersBasicsAndFreePlayPaysNothing() throws Exception {
        MyRandom.setRandom(new Random(3));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            // Pass (and keep the opening hand) until it's your first main phase with priority.
            PlayerView meView = null;
            IGameController ctl = null;
            long deadline = System.currentTimeMillis() + 120_000;
            while (System.currentTimeMillis() < deadline) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                var gv = session.view();
                if (prompt == null || browser.me == null || !browser.me.contains((PlayerView) prompt[0]) || gv == null) {
                    continue;
                }
                meView = (PlayerView) prompt[0];
                ctl = session.controller("You", meView);
                if (meView.equals(gv.getPlayerTurn()) && gv.getPhase() == PhaseType.MAIN1 && "OK".equals(prompt[1])
                        && session.game().getStack().isEmpty()) {
                    break;
                }
                FThreads.invokeInEdtLater(ctl::selectButtonOk);
                meView = null;
            }
            Assert.assertNotNull(meView, "reached your main phase");
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            IGameController controller = ctl;

            Card[] cards = onGameThread(g, () -> new Card[] {
                make(me, "Forest", ZoneType.Battlefield),
                make(me, "Savannah", ZoneType.Battlefield),
                make(me, "Llanowar Elves", ZoneType.Hand),
                make(me, "Llanowar Elves", ZoneType.Hand),
            });
            Card forest = cards[0];
            Card savannah = cards[1];
            int otherUntapped = (int) me.getCardsIn(ZoneType.Battlefield).stream().filter(c -> c.isLand() && !c.isTapped()).count() - 2;
            Assert.assertEquals(otherUntapped, 0, "only the two test lands are untapped");

            // Cast the first Elves: Forge asks for mana, and the browser would show the pay dialog.
            browser.buttonPrompts.clear();
            onUiThread(() -> controller.selectCard(cards[2].getView(), null, null));
            waitFor(() -> Payment.info(controller, me) != null, "the mana payment");
            Payment.Info info = Payment.info(controller, me);
            Assert.assertEquals(info.card(), "Llanowar Elves");
            Assert.assertEquals(info.kind(), "spell");
            Assert.assertTrue(info.cost().contains("G"), "cost " + info.cost());

            onUiThread(() -> {
                controller.selectButtonOk(); // Auto
                return null;
            });
            waitFor(() -> Payment.info(controller, me) == null && !g.getStack().isEmpty(), "the Elves on the stack");
            Assert.assertTrue(forest.isTapped(), "Auto-pay taps the basic Forest");
            Assert.assertFalse(savannah.isTapped(), "and keeps the dual land untapped");

            // Let it resolve (you get priority back with the Elves on the stack).
            onUiThread(() -> {
                controller.selectButtonOk();
                return null;
            });
            waitFor(() -> g.getStack().isEmpty() && me.getCardsIn(ZoneType.Battlefield).anyMatch(c -> c.getName().equals("Llanowar Elves")), "the Elves resolving");

            // Free play: cast the second Elves without tapping the Savannah.
            waitFor(() -> controller instanceof forge.player.PlayerControllerHuman h
                    && h.getInputProxy().getInput() instanceof forge.gamemodes.match.input.InputPassPriority, "priority again");
            onUiThread(() -> controller.selectCard(cards[3].getView(), null, null));
            waitFor(() -> Payment.info(controller, me) != null, "the second payment");
            Assert.assertTrue(onUiThread(() -> Payment.payFree(controller, g, me)), "paid for free");
            waitFor(() -> !g.getStack().isEmpty(), "the second Elves on the stack");
            Assert.assertFalse(savannah.isTapped(), "free play taps nothing");
            Assert.assertTrue(g.getGameLog().getAllEntries().stream().anyMatch(e -> e.message().contains("without paying its mana cost (by hand)")), "logged");
            Assert.assertNull(Payment.info(controller, me), "nothing left to pay");
        } finally {
            session.abort();
        }
    }
}
