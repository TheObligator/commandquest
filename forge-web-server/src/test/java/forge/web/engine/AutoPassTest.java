package forge.web.engine;

import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.util.MyRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/**
 * "Until my turn", chosen in your main phase: no priority again until your next turn, not even in
 * the end step before it. (This seat has no stops set, so without the auto-pass it'd be asked at
 * every step.)
 */
public class AutoPassTest {

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
    public void untilMyTurnSkipsToYourNextTurn() throws Exception {
        MyRandom.setRandom(new Random(13));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            IGameController ctl = session.controller("You", meView);
            Game g = session.game();
            int myTurn = g.getPhaseHandler().getTurn();
            // Keep the hand small so cleanup never asks for a discard (this test only presses OK).
            CompletableFuture<Void> trimmed = new CompletableFuture<>();
            g.getAction().invoke(() -> {
                for (Card c : g.getPlayer(meView.getId()).getCardsIn(ZoneType.Hand).threadSafeIterable()) {
                    g.getAction().moveToLibrary(c, -1, null);
                }
                trimmed.complete(null);
            });
            trimmed.get(10, TimeUnit.SECONDS);

            browser.buttonPrompts.clear();
            CompletableFuture<Void> set = new CompletableFuture<>();
            FThreads.invokeInEdtLater(() -> {
                ctl.applyYieldUpdate(AutoPass.update(g, meView, "UNTIL_MY_TURN"));
                ctl.selectButtonOk(); // pass this main phase
                set.complete(null);
            });
            set.get(10, TimeUnit.SECONDS);

            // The next time you're asked anything, it's your next turn.
            List<String> seen = new ArrayList<>();
            long deadline = System.currentTimeMillis() + 120_000;
            while (System.currentTimeMillis() < deadline) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                var gv = session.view();
                if (prompt == null || gv == null || !meView.equals(prompt[0]) || !"OK".equals(prompt[1]) || !Boolean.TRUE.equals(prompt[3])) {
                    continue;
                }
                Thread.sleep(200); // a real priority prompt stays; Forge's button resets don't
                if (!(ctl instanceof forge.player.PlayerControllerHuman h
                        && h.getInputProxy().getInput() instanceof forge.gamemodes.match.input.InputPassPriority)) {
                    continue;
                }
                seen.add("T" + g.getPhaseHandler().getTurn() + " " + gv.getPlayerTurn() + " " + gv.getPhase() + " stack=" + g.getStack().size());
                if (g.getStack().isEmpty()) {
                    break;
                }
                FThreads.invokeInEdtLater(ctl::selectButtonOk); // something on the stack: let it resolve
            }
            Assert.assertFalse(seen.isEmpty(), "asked again eventually");
            String last = seen.get(seen.size() - 1);
            Assert.assertTrue(g.getPhaseHandler().getTurn() > myTurn && meView.equals(g.getPhaseHandler().getPlayerTurn().getView()),
                    "next asked on your next turn, not before: " + seen);
            Assert.assertEquals(g.getPhaseHandler().getPhase(), PhaseType.UPKEEP, "at its start: " + last);
        } finally {
            session.abort();
        }
    }
}
