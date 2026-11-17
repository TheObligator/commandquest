package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.phase.PhaseType;
import forge.game.player.PlayerView;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Decks with no maximum size (Rulebreakers like Whtz, the Bibliophile) up to the server's cap. */
public class DeckSizeTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    /** Whtz plus {@code size - 1} basic lands, at most 250 of each (the per-card limit). */
    private static ObjectNode whtzDeck(int size) {
        ObjectNode deck = JSON.createObjectNode().put("name", "Big Whtz");
        ArrayNode cards = deck.putArray("cards");
        cards.addObject().put("name", "Whtz, the Bibliophile").put("quantity", 1).put("board", "commander");
        int left = size - 1;
        for (String basic : new String[] {"Plains", "Island", "Snow-Covered Plains", "Snow-Covered Island", "Wastes"}) {
            int n = Math.min(250, left);
            if (n > 0) {
                cards.addObject().put("name", basic).put("quantity", n).put("board", "main");
            }
            left -= n;
        }
        return deck;
    }

    @Test
    public void decksUpToTheCapAreAccepted() {
        Assert.assertEquals(Decks.fromJson(whtzDeck(Decks.MAX_DECK_SIZE)).getMain().countAll(), Decks.MAX_DECK_SIZE - 1);
        IllegalArgumentException e = Assert.expectThrows(IllegalArgumentException.class, () -> Decks.fromJson(whtzDeck(Decks.MAX_DECK_SIZE + 1)));
        Assert.assertTrue(e.getMessage().contains(String.valueOf(Decks.MAX_DECK_SIZE)), e.getMessage());
    }

    /**
     * A full-size deck against three normal ones, with rewind at its highest level. Rewind's saves
     * walk every card in the game, so a 1000-card deck costs about twice the time of a 100-card one
     * (4 x 1000 cards would be ten times as slow).
     */
    @Test(timeOut = 300_000)
    public void aFullSizeDeckPlaysAgainstThreeAiWithRewindOn() throws Exception {
        play(Decks.MAX_DECK_SIZE, 100);
    }

    private void play(int size, int aiSize) throws Exception {
        MyRandom.setRandom(new Random(3));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", Decks.fromJson(whtzDeck(size)), browser),
                new GameSession.Seat("AI 1", Decks.fromJson(whtzDeck(aiSize)), null),
                new GameSession.Seat("AI 2", Decks.fromJson(whtzDeck(aiSize)), null),
                new GameSession.Seat("AI 3", Decks.fromJson(whtzDeck(aiSize)), null)), Rewind.MAX_LEVEL);
        try {
            long deadline = System.currentTimeMillis() + 240_000;
            int lastLandTurn = -1;
            while (System.currentTimeMillis() < deadline) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                GameView gv = session.view();
                if (gv == null || gv.isGameOver() || gv.getTurn() >= 9) {
                    break;
                }
                if (prompt == null || browser.me == null || !browser.me.contains((PlayerView) prompt[0])) {
                    continue;
                }
                PlayerView owner = (PlayerView) prompt[0];
                IGameController controller = session.controller("You", owner);
                // The deck is all lands: play one a turn, so the hand never needs a discard.
                CardView land = null;
                if (owner.equals(gv.getPlayerTurn()) && gv.getPhase() == PhaseType.MAIN1 && lastLandTurn != gv.getTurn() && owner.getHand() != null) {
                    land = owner.getHand().isEmpty() ? null : owner.getHand().iterator().next();
                }
                if (land != null) {
                    CardView toPlay = land;
                    lastLandTurn = gv.getTurn();
                    FThreads.invokeInEdtLater(() -> controller.selectCard(toPlay, null, null));
                } else {
                    FThreads.invokeInEdtLater(controller::selectButtonOk); // keep / pass priority
                }
            }
            GameView gv = session.view();
            Assert.assertTrue(gv.getTurn() >= 9, "the game advanced through several turns, at turn " + gv.getTurn());
            PlayerView me = browser.me.iterator().next();
            Assert.assertTrue(me.getZoneSize(forge.game.zone.ZoneType.Library) > size - 20, "the whole deck is in the library");
        } finally {
            session.abort();
        }
    }
}
