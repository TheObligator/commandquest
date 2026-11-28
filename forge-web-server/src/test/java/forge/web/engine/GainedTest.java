package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.util.MyRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Keywords and abilities a permanent gains from other cards are listed apart from its own. */
public class GainedTest {

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    private static <T> T onGameThread(Game g, java.util.function.Supplier<T> f) throws Exception {
        java.util.concurrent.CompletableFuture<T> out = new java.util.concurrent.CompletableFuture<>();
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
    public void gainedFromOtherCards() throws Exception {
        MyRandom.setRandom(new Random(5));
        Deck d = new Deck("Bears");
        d.getOrCreate(DeckSection.Commander).add("Kenrith, the Returned King", 1);
        d.getMain().add("Forest", 95);
        for (String extra : List.of("Grizzly Bears", "Serra Angel", "Cryptolith Rite", "Concordant Crossroads")) {
            d.getMain().add(extra, 1);
        }
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
            for (String name : List.of("Grizzly Bears", "Serra Angel", "Cryptolith Rite", "Concordant Crossroads")) {
                CountDownLatch done = new CountDownLatch(1);
                Assert.assertTrue(manual.run(g, me, named(me, name), "toBattlefield", null, done::countDown), name);
                Assert.assertTrue(done.await(10, TimeUnit.SECONDS), name + " in play");
            }
            ObjectMapper json = new ObjectMapper();
            JsonNode bears = onGameThread(g, () -> Gained.of(g.getCardState(named(me, "Grizzly Bears")), Gained.staticHosts(g), json));
            JsonNode angel = onGameThread(g, () -> Gained.of(g.getCardState(named(me, "Serra Angel")), Gained.staticHosts(g), json));
            JsonNode rite = onGameThread(g, () -> Gained.of(g.getCardState(named(me, "Cryptolith Rite")), Gained.staticHosts(g), json));

            JsonNode haste = find(bears, "Haste");
            Assert.assertNotNull(haste, "Bears gain haste: " + bears);
            Assert.assertEquals(haste.path("keyword").asText(), "Haste");
            Assert.assertEquals(haste.path("source").asText(), "Concordant Crossroads");
            Assert.assertFalse(haste.path("reminder").asText().isEmpty(), "haste says what it does");
            JsonNode mana = null;
            for (JsonNode e : bears) {
                if (e.path("text").asText().contains("Add one mana of any color")) {
                    mana = e;
                }
            }
            Assert.assertNotNull(mana, "the Rite's mana ability: " + bears);
            Assert.assertFalse(mana.has("keyword"));
            Assert.assertEquals(mana.path("source").asText(), "Cryptolith Rite");

            Assert.assertNull(find(angel, "Flying"), "the Angel's own flying isn't gained: " + angel);
            Assert.assertNull(find(angel, "Vigilance"), "nor its vigilance");
            Assert.assertNotNull(find(angel, "Haste"), "but haste is");
            Assert.assertTrue(rite.isEmpty(), "an enchantment gains nothing: " + rite);
        } finally {
            session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void gainedInYourHand() throws Exception {
        MyRandom.setRandom(new Random(6));
        Deck d = new Deck("Lands");
        d.getOrCreate(DeckSection.Commander).add("Kenrith, the Returned King", 1);
        d.getMain().add("Mountain", 98);
        d.getMain().add("Tectonic Reformation", 1);
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
            CountDownLatch done = new CountDownLatch(1);
            Assert.assertTrue(new ManualActions().run(g, me, named(me, "Tectonic Reformation"), "toBattlefield", null, done::countDown));
            Assert.assertTrue(done.await(10, TimeUnit.SECONDS));
            Card land = me.getCardsIn(forge.game.zone.ZoneType.Hand).stream().filter(c -> c.getName().equals("Mountain")).findFirst()
                    .orElseThrow(() -> new AssertionError("no Mountain in hand"));

            // Through the view, as the browser gets it: your hand's Mountain gained cycling.
            ObjectMapper json = new ObjectMapper();
            com.fasterxml.jackson.databind.node.ObjectNode view = json.createObjectNode();
            view.putArray("players").addObject().putArray("hand").addObject().put("id", land.getId());
            onGameThread(g, () -> {
                Gained.annotate(g, view, json);
                return null;
            });
            JsonNode gained = view.path("players").get(0).path("hand").get(0).path("gained");
            JsonNode cycling = gained.size() == 1 ? gained.get(0) : null;
            Assert.assertNotNull(cycling, "cycling: " + gained);
            Assert.assertEquals(cycling.path("keyword").asText(), "Cycling");
            Assert.assertEquals(cycling.path("source").asText(), "Tectonic Reformation");
            Assert.assertTrue(cycling.path("text").asText().startsWith("Cycling"), cycling.toString());
        } finally {
            session.abort();
        }
    }

    private static JsonNode find(JsonNode list, String text) {
        List<JsonNode> hits = new ArrayList<>();
        list.forEach(e -> {
            if (e.path("text").asText().equals(text)) {
                hits.add(e);
            }
        });
        return hits.isEmpty() ? null : hits.get(0);
    }
}
