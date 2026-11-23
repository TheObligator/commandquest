package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** In a real game: scry and surveil of one card ask in the card window, and revealed cards don't stop the game. */
public class CardWindowTest {

    private final ObjectMapper json = new ObjectMapper();

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

    private JsonNode next(BlockingQueue<String> sent, String type) throws Exception {
        for (;;) {
            String s = sent.poll(10, TimeUnit.SECONDS);
            Assert.assertNotNull(s, "no " + type + " sent");
            JsonNode m = json.readTree(s);
            if (type.equals(m.path("t").asText())) {
                return m;
            }
        }
    }

    @Test(timeOut = 240_000)
    public void scryOneSurveilOneAndReveal() throws Exception {
        MyRandom.setRandom(new Random(11));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Player ai = g.getPlayers().stream().filter(p -> p != me).findFirst().orElseThrow();
            BlockingQueue<String> sent = new LinkedBlockingQueue<>();
            BrowserSeat seat = new BrowserSeat(json, sent::offer);
            WebPlayerController ctl = new WebPlayerController(g, me, new WebLobbyPlayer("You", seat), seat);
            Card top = me.getCardsIn(ZoneType.Library).get(0);

            // Scry 1: one window with the card, not a yes/no naming it. To the bottom.
            CompletableFuture<ImmutablePair<CardCollection, CardCollection>> scry =
                    CompletableFuture.supplyAsync(() -> ctl.arrangeForScry(new CardCollection(top)));
            JsonNode ask = next(sent, "ask");
            Assert.assertEquals(ask.path("kind").asText(), "scry");
            Assert.assertEquals(ask.path("away").asText(), "bottom");
            Assert.assertEquals(ask.path("options").size(), 1);
            Assert.assertEquals(ask.path("options").get(0).path("cardId").asInt(), top.getId());
            seat.answer(ask.path("id").asInt(), json.readTree("[-1,0]"), null);
            ImmutablePair<CardCollection, CardCollection> s = scry.get(10, TimeUnit.SECONDS);
            Assert.assertNull(s.getLeft(), "nothing kept on top");
            Assert.assertEquals(s.getRight(), List.of(top));

            // Surveil 1: kept on top.
            CompletableFuture<ImmutablePair<CardCollection, CardCollection>> surveil =
                    CompletableFuture.supplyAsync(() -> ctl.arrangeForSurveil(new CardCollection(top)));
            ask = next(sent, "ask");
            Assert.assertEquals(ask.path("away").asText(), "graveyard");
            seat.answer(ask.path("id").asInt(), json.readTree("[0]"), null);
            ImmutablePair<CardCollection, CardCollection> v = surveil.get(10, TimeUnit.SECONDS);
            Assert.assertEquals(v.getLeft(), List.of(top));
            Assert.assertNull(v.getRight(), "nothing into the graveyard");

            // An opponent's hand revealed: a window to close; the game doesn't wait for it.
            CardCollection hand = new CardCollection(ai.getCardsIn(ZoneType.Hand));
            CompletableFuture.runAsync(() -> ctl.reveal(hand, ZoneType.Hand, ai, null, true)).get(10, TimeUnit.SECONDS);
            JsonNode shown = next(sent, "shown");
            Assert.assertTrue(shown.path("title").asText().contains("AI 1"), shown.toString());
            Assert.assertEquals(shown.path("cards").size(), hand.size());
            Assert.assertEquals(shown.path("cards").get(0).path("name").asText(), hand.get(0).getName(), "faces shown");
            seat.close();
        } finally {
            session.abort();
        }
    }
}
