package forge.web.engine;

import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.input.InputSelectStackItems;
import forge.interfaces.IGameController;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Counterspells pick their target by clicking it on the stack (the browser's "stack" message). */
public class StackTargetTest {

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
    public void negateTargetsASpellPickedOnTheStack() throws Exception {
        MyRandom.setRandom(new Random(7));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Talrand, Sky Summoner", "Island"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            IGameController ctl = session.controller("You", meView);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Card[] cards = UseLaterTest.onGameThread(g, () -> {
                PaymentTest.tapTheRest(me);
                for (int i = 0; i < 5; i++) {
                    UseLaterTest.make(me, "Island", ZoneType.Battlefield);
                }
                return new Card[] {
                    UseLaterTest.make(me, "Divination", ZoneType.Hand),
                    UseLaterTest.make(me, "Negate", ZoneType.Hand),
                };
            });

            castWithAutoPay(g, ctl, me, cards[0], 1);
            SpellAbilityStackInstance divination = g.getStack().peek();
            Assert.assertEquals(divination.getSourceCard().getName(), "Divination");

            // Negate targets spells only: Forge waits for a click on the stack, not a list question.
            PaymentTest.onUiThread(() -> ctl.selectCard(cards[1].getView(), null, null));
            java.util.function.Supplier<Object> input = () -> ((WebPlayerController) ctl).getInputProxy().getInput();
            PaymentTest.waitFor(() -> input.get() instanceof InputSelectStackItems, "Negate's stack target prompt");
            PaymentTest.onUiThread(() -> {
                ctl.selectStackItem(divination.getView());
                return null;
            });
            PaymentTest.waitFor(() -> Payment.info(ctl, me) != null, "Negate's mana payment");
            PaymentTest.onUiThread(() -> {
                AutoPay.run(ctl, me, ctl::selectButtonOk);
                return null;
            });
            PaymentTest.waitFor(() -> g.getStack().size() == 2, "Negate on the stack");
            SpellAbility negate = g.getStack().peekAbility();
            Assert.assertEquals(negate.getHostCard().getName(), "Negate");
            Assert.assertTrue(negate.getTargets().contains(divination.getSpellAbility()), "Negate targets Divination");
        } finally {
            session.abort();
        }
    }

    private static void castWithAutoPay(Game g, IGameController ctl, Player me, Card spell, int stackSize) throws Exception {
        PaymentTest.onUiThread(() -> ctl.selectCard(spell.getView(), null, null));
        PaymentTest.waitFor(() -> Payment.info(ctl, me) != null, "the mana payment");
        PaymentTest.onUiThread(() -> {
            AutoPay.run(ctl, me, ctl::selectButtonOk);
            return null;
        });
        PaymentTest.waitFor(() -> Payment.info(ctl, me) == null && g.getStack().size() == stackSize, spell.getName() + " on the stack");
    }
}
