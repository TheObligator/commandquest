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
import forge.gamemodes.match.YieldUpdate;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.model.FModel;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** With no upkeep stop, the game still stops in your upkeep when you can use an upkeep-only ability. */
public class UpkeepStopTest {

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

    private static Card make(Player p, String name, ZoneType zone) {
        Card c = Card.fromPaperCard(FModel.getMagicDb().getCommonCards().getCard(name), p);
        Game g = p.getGame();
        return zone == ZoneType.Battlefield
                ? g.getAction().moveToPlay(c, p, null, AbilityKey.newMap())
                : g.getAction().moveTo(zone, c, null, AbilityKey.newMap());
    }

    @Test(timeOut = 240_000)
    public void stopsInUpkeepForAnUpkeepOnlyAbility() throws Exception {
        MyRandom.setRandom(new Random(11));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            IGameController ctl = session.controller("You", meView);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            int myTurn = g.getPhaseHandler().getTurn();

            // No stop in your upkeep. Undead Gladiator: "{1}{B}, Discard a card: Return this from your
            // graveyard to your hand. Activate only during your upkeep."
            CompletableFuture<Void> skip = new CompletableFuture<>();
            FThreads.invokeInEdtLater(() -> {
                ctl.applyYieldUpdate(new YieldUpdate.SkipPhase(meView, PhaseType.UPKEEP, true));
                skip.complete(null);
            });
            skip.get(10, TimeUnit.SECONDS);
            Card[] swamps = onGameThread(g, () -> {
                // A small hand, so there's no discard at cleanup (this test only presses OK).
                for (Card c : me.getCardsIn(ZoneType.Hand).threadSafeIterable()) {
                    g.getAction().moveToLibrary(c, -1, null);
                }
                make(me, "Undead Gladiator", ZoneType.Graveyard);
                make(me, "Forest", ZoneType.Hand);
                return new Card[] {make(me, "Swamp", ZoneType.Battlefield), make(me, "Swamp", ZoneType.Battlefield)};
            });

            // Pass everything until it's your next turn (starting with the main phase we're in).
            FThreads.invokeInEdtLater(ctl::selectButtonOk);
            boolean stoppedInUpkeep = false;
            long deadline = System.currentTimeMillis() + 120_000;
            while (System.currentTimeMillis() < deadline) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                var gv = session.view();
                if (prompt == null || gv == null || !meView.equals(prompt[0])) {
                    continue;
                }
                if (gv.getPlayerTurn().equals(meView) && g.getPhaseHandler().getTurn() > myTurn) {
                    stoppedInUpkeep = gv.getPhase() == PhaseType.UPKEEP;
                    break;
                }
                FThreads.invokeInEdtLater(ctl::selectButtonOk);
            }
            Assert.assertTrue(stoppedInUpkeep, "the game stops in your upkeep");
            Assert.assertEquals(onGameThread(g, () -> UpkeepStop.reason(g, me)).getName(), "Undead Gladiator");

            // Without the mana to pay for it, there's no reason to stop.
            onGameThread(g, () -> {
                for (Card s : swamps) {
                    s.tap(null, me);
                }
                return null;
            });
            Assert.assertNull(onGameThread(g, () -> UpkeepStop.reason(g, me)), "can't pay: no stop");
        } finally {
            session.abort();
        }
    }
}
