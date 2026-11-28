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

    static <T> T onUiThread(Supplier<T> f) throws Exception {
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

    static void waitFor(BooleanSupplier cond, String what) throws InterruptedException {
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

    /** Passes (and keeps the opening hand) until it's your first main phase with priority and an empty stack. */
    static PlayerView untilMyMain(GameSession session, GameSessionTest.ScriptedBrowser browser) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 120_000;
        while (System.currentTimeMillis() < deadline) {
            Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
            var gv = session.view();
            if (prompt == null || browser.me == null || !browser.me.contains((PlayerView) prompt[0]) || gv == null) {
                continue;
            }
            PlayerView me = (PlayerView) prompt[0];
            IGameController ctl = session.controller("You", me);
            if (me.equals(gv.getPlayerTurn()) && gv.getPhase() == PhaseType.MAIN1 && "OK".equals(prompt[1])
                    && session.game().getStack().isEmpty()) {
                return me;
            }
            GameSessionTest.pass(ctl);
        }
        Assert.fail("never reached your main phase");
        return null;
    }

    @Test(timeOut = 240_000)
    public void autoPayPrefersBasicsAndFreePlayPaysNothing() throws Exception {
        MyRandom.setRandom(new Random(3));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = untilMyMain(session, browser);
            IGameController ctl = session.controller("You", meView);
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
                AutoPay.run(controller, me, controller::selectButtonOk); // the Auto-pay button
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

    @Test(timeOut = 240_000)
    public void autoPayAvoidsSourcesWithDrawbacks() throws Exception {
        MyRandom.setRandom(new Random(5));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = untilMyMain(session, browser);
            IGameController controller = session.controller("You", meView);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Card[] cards = onGameThread(g, () -> {
                Card[] made = {
                    make(me, "Talisman of Creativity", ZoneType.Battlefield),
                    make(me, "Mystic Monastery", ZoneType.Battlefield),
                    make(me, "Furycalm Snarl", ZoneType.Battlefield),
                    make(me, "Plains", ZoneType.Battlefield),
                    make(me, "Mantis Rider", ZoneType.Hand),
                };
                for (Card c : made) {
                    if (c.isTapped()) {
                        c.untap(); // Mystic Monastery enters tapped
                    }
                }
                return made;
            });
            int life = me.getLife();
            onUiThread(() -> controller.selectCard(cards[4].getView(), null, null));
            waitFor(() -> Payment.info(controller, me) != null, "the mana payment");
            onUiThread(() -> {
                AutoPay.run(controller, me, controller::selectButtonOk);
                return null;
            });
            waitFor(() -> Payment.info(controller, me) == null && !g.getStack().isEmpty(), "Mantis Rider on the stack");
            Assert.assertEquals(me.getLife(), life, "no Talisman damage");
            Assert.assertFalse(cards[0].isTapped(), "the Talisman stays untapped: the lands pay {U}{R}{W}");
            Assert.assertTrue(cards[1].isTapped() && cards[2].isTapped() && cards[3].isTapped(), "the three lands paid");
        } finally {
            session.abort();
        }
    }

    /** Your lands and rocks already in play are tapped, so only the ones a test makes can pay. */
    static void tapTheRest(Player me) {
        for (Card c : me.getCardsIn(ZoneType.Battlefield)) {
            if (c.isUntapped() && (c.isLand() || c.isArtifact())) {
                c.setTapped(true);
            }
        }
    }

    /** Cast {@code spell} from hand with Auto-pay, until it's on the stack. */
    private static void autoPayFor(Game g, IGameController controller, Player me, Card spell) throws Exception {
        onUiThread(() -> controller.selectCard(spell.getView(), null, null));
        waitFor(() -> Payment.info(controller, me) != null, "the mana payment");
        onUiThread(() -> {
            AutoPay.run(controller, me, controller::selectButtonOk);
            return null;
        });
        waitFor(() -> Payment.info(controller, me) == null && !g.getStack().isEmpty(), spell.getName() + " on the stack");
    }

    @Test(timeOut = 240_000)
    public void autoPayTapsAManaRockBeforeAFilterLand() throws Exception {
        MyRandom.setRandom(new Random(5));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = untilMyMain(session, browser);
            IGameController controller = session.controller("You", meView);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Card[] cards = onGameThread(g, () -> {
                tapTheRest(me);
                return new Card[] {
                    make(me, "Mystic Gate", ZoneType.Battlefield),
                    make(me, "Island", ZoneType.Battlefield),
                    make(me, "Plains", ZoneType.Battlefield),
                    make(me, "Mind Stone", ZoneType.Battlefield),
                    make(me, "Teferi, Time Raveler", ZoneType.Hand),
                };
            });
            autoPayFor(g, controller, me, cards[4]);
            Assert.assertTrue(cards[1].isTapped() && cards[2].isTapped(), "the Island and the Plains pay {W}{U}");
            Assert.assertTrue(cards[3].isTapped(), "Mind Stone pays the {1}");
            Assert.assertFalse(cards[0].isTapped(), "the filter land stays up");
        } finally {
            session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void autoPayKeepsUpTheColorYourHandNeeds() throws Exception {
        MyRandom.setRandom(new Random(5));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = untilMyMain(session, browser);
            IGameController controller = session.controller("You", meView);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Card[] cards = onGameThread(g, () -> {
                tapTheRest(me);
                return new Card[] {
                    make(me, "Plains", ZoneType.Battlefield),   // made first: without the hand, it would pay
                    make(me, "Island", ZoneType.Battlefield),
                    make(me, "Sol Ring", ZoneType.Hand),
                    make(me, "Swords to Plowshares", ZoneType.Hand),
                };
            });
            autoPayFor(g, controller, me, cards[2]);
            Assert.assertTrue(cards[1].isTapped(), "the Island pays for Sol Ring");
            Assert.assertFalse(cards[0].isTapped(), "the Plains stays up for Swords to Plowshares");
        } finally {
            session.abort();
        }
    }

    /** Lands and a Talisman for a Jeskai commander, then Guinan ({2}{W}) and {@code hand} in hand. */
    private static void jeskaiPainTest(String[] lands, String hand, java.util.function.BiConsumer<Card[], Integer> check)
            throws Exception {
        MyRandom.setRandom(new Random(5));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Narset, Enlightened Master", "Mountain"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = untilMyMain(session, browser);
            IGameController controller = session.controller("You", meView);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Card[] cards = onGameThread(g, () -> {
                tapTheRest(me);
                Card[] made = new Card[lands.length + 1];
                for (int i = 0; i < lands.length; i++) {
                    made[i] = make(me, lands[i], ZoneType.Battlefield);
                }
                make(me, hand, ZoneType.Hand);
                made[lands.length] = make(me, "Guinan, Ancient Advisor", ZoneType.Hand);
                return made;
            });
            int life = me.getLife();
            autoPayFor(g, controller, me, cards[lands.length]);
            check.accept(cards, life - me.getLife());
        } finally {
            session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void autoPayStaysPainlessWhenYourHandIsStillCastable() throws Exception {
        jeskaiPainTest(new String[] {"Command Tower", "Battlefield Forge", "Mountain", "Island", "Talisman of Conviction"},
                "Negate", (cards, damage) -> {
                    Assert.assertEquals((int) damage, 0, "no damage: the Island and the Talisman can still cast Negate");
                    Assert.assertTrue(cards[0].isTapped(), "Command Tower pays the {W}");
                    Assert.assertFalse(cards[3].isTapped(), "the Island stays up for Negate");
                });
    }

    @Test(timeOut = 240_000)
    public void autoPayTakesPainToKeepASpellCastable() throws Exception {
        jeskaiPainTest(new String[] {"Command Tower", "Battlefield Forge", "Mountain", "Mountain"}, "Opt", (cards, damage) -> {
            Assert.assertEquals((int) damage, 1, "Battlefield Forge pays the {W} for 1 damage");
            Assert.assertFalse(cards[0].isTapped(), "Command Tower stays up to make {U} for Opt");
            Assert.assertTrue(cards[1].isTapped() && cards[2].isTapped() && cards[3].isTapped(), "the Forge and both Mountains paid");
        });
    }
}
