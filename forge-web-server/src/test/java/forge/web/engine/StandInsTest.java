package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Stand-ins for cards Forge doesn't have, played with free play. */
public class StandInsTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String NEW_CARD = "Zyxor, Test Paragon";

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    private static ObjectNode scryfall(String name, String cost, String type, String oracle) {
        ObjectNode c = JSON.createObjectNode().put("name", name).put("manaCost", cost).put("typeLine", type).put("oracleText", oracle);
        if (type.contains("Creature")) {
            c.put("power", "3").put("toughness", "4");
        }
        return c;
    }

    private static ObjectNode deck(boolean withStandIn) {
        ObjectNode deck = JSON.createObjectNode().put("name", "New cards");
        ArrayNode cards = deck.putArray("cards");
        cards.addObject().put("name", "Whtz, the Bibliophile").put("quantity", 1).put("board", "commander");
        cards.addObject().put("name", "Island").put("quantity", 98).put("board", "main");
        ObjectNode card = cards.addObject().put("name", NEW_CARD).put("quantity", 1).put("board", "main");
        if (withStandIn) {
            card.set("standIn", scryfall(NEW_CARD, "{1}{W/U}{U/P}", "Legendary Creature — Human Wizard", "Flying\nWhen this enters, draw a card."));
        }
        return deck;
    }

    @Test
    public void manaCostsInForgeSyntax() {
        Assert.assertEquals(StandIns.manaCost("{2}{W}{U}"), "2 W U");
        Assert.assertEquals(StandIns.manaCost("{X}{R/G}{2/B}{G/U/P}"), "X RG 2B GUP");
        Assert.assertEquals(StandIns.manaCost(""), "no cost");
        Assert.assertNull(StandIns.manaCost("{2}{W} A:AB$ Draw"));
        Assert.assertNull(StandIns.manaCost("2W"));
    }

    @Test
    public void aStandInHasTheCardsFaceButNoAbilities() {
        PaperCard pc = StandIns.build(scryfall(NEW_CARD, "{1}{U}", "Legendary Creature — Human Wizard", "Flying\nA:AB$ Draw | Cost$ 0 | NumCards$ 7"));
        Assert.assertNotNull(pc);
        Assert.assertEquals(pc.getName(), NEW_CARD);
        Assert.assertEquals(pc.getRules().getManaCost().getCMC(), 2);
        Assert.assertTrue(pc.getRules().getType().isLegendary() && pc.getRules().getType().isCreature());
        Assert.assertEquals(pc.getRules().getMainPart().getIntPower(), 3);
        Assert.assertFalse(pc.getRules().getMainPart().getAbilities().iterator().hasNext(), "rules text never becomes an ability");
        Assert.assertTrue(pc.getRules().getOracleText().contains("A:AB$ Draw"), "it's shown as text instead");
    }

    @Test
    public void planeswalkersBattlesAndDoubleFacedCards() {
        PaperCard walker = StandIns.build(scryfall("Test Walker", "{2}{B}{B}", "Legendary Planeswalker — Liliana", "+1: Each player discards a card.").put("loyalty", "3"));
        Assert.assertNotNull(walker);
        Assert.assertEquals(walker.getRules().getInitialLoyalty(), "3");
        PaperCard battle = StandIns.build(scryfall("Test Siege", "{3}{R}", "Battle — Siege", "When this enters, ...").put("defense", "5"));
        Assert.assertNotNull(battle);

        ObjectNode dfc = JSON.createObjectNode().put("name", "Test Werewolf").put("layout", "transform");
        ArrayNode faces = dfc.putArray("faces");
        faces.add(scryfall("Test Werewolf", "{1}{G}", "Creature — Human Werewolf", "Daybound"));
        faces.add(scryfall("Test Wolfform", "", "Creature — Werewolf", "Nightbound").put("power", "4").put("toughness", "4"));
        PaperCard pc = StandIns.build(dfc);
        Assert.assertNotNull(pc);
        Assert.assertEquals(pc.getName(), "Test Werewolf");
        Assert.assertEquals(pc.getRules().getOtherPart().getName(), "Test Wolfform");
        Assert.assertEquals(pc.getRules().getOtherPart().getIntPower(), 4);
    }

    @Test
    public void malformedDataIsRefused() {
        Assert.assertNull(StandIns.build(scryfall("Bad\nName:Island", "{U}", "Creature — Bird", "")));
        Assert.assertNull(StandIns.build(scryfall("Bad Type", "{U}", "Creature\nK:Flying", "")));
        Assert.assertNull(StandIns.build(scryfall("Bad Cost", "{U} | SVar:X", "Instant", "")));
        Assert.assertNull(StandIns.build(scryfall("No Type", "{U}", "", "")));
    }

    @Test
    public void standInsNeedFreePlay() {
        IllegalArgumentException e = Assert.expectThrows(IllegalArgumentException.class, () -> Decks.fromJson(deck(true), false));
        Assert.assertTrue(e.getMessage().contains("Turn on free play"), e.getMessage());
        Assert.expectThrows(IllegalArgumentException.class, () -> Decks.fromJson(deck(false), true)); // no data: still unknown
        Deck d = Decks.fromJson(deck(true), true);
        Assert.assertEquals(d.get(DeckSection.Main).countAll(), 99);
        Assert.assertNull(forge.StaticData.instance().getCommonCards().getCard(NEW_CARD), "never added to Forge's card database");
    }

    @Test(timeOut = 240_000)
    public void aStandInPlaysByHandAndRewindsWithTheGame() throws Exception {
        MyRandom.setRandom(new Random(8));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", Decks.fromJson(deck(true), true), browser),
                new GameSession.Seat("AI 1", Decks.fromJson(deck(true), true), null)), Rewind.MAX_LEVEL);
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Card card = me.getAllCards().stream().filter(c -> c.getName().equals(NEW_CARD)).findFirst().orElseThrow();
            CountDownLatch done = new CountDownLatch(1);
            Assert.assertTrue(new ManualActions().run(g, me, card, "toBattlefield", null, done::countDown));
            Assert.assertTrue(done.await(10, TimeUnit.SECONDS));
            Card onField = g.getCardState(card);
            Assert.assertEquals(onField.getZone().getZoneType(), ZoneType.Battlefield);
            Assert.assertEquals(onField.getNetPower(), 3);
            Assert.assertEquals(onField.getNetToughness(), 4);
            Assert.assertTrue(onField.getOracleText().contains("draw a card"), "it keeps its rules text");
            // Rewind puts a game with a stand-in in it back: undo putting it onto the battlefield.
            Rewind rewind = session.rewind();
            Rewind.Option undo = rewind.options().stream().filter(o -> o.level() == 1).findFirst().orElse(null);
            Assert.assertNotNull(undo, "an undo is offered: " + rewind.options());
            Assert.assertNull(rewind.request(me, undo.point()), "nobody else to ask: done at once");
            long end = System.currentTimeMillis() + 20_000;
            while (session.game().getCardsIn(ZoneType.Battlefield).stream().anyMatch(c -> c.getName().equals(NEW_CARD))) {
                Assert.assertTrue(System.currentTimeMillis() < end, "timed out waiting for the undo");
                Thread.sleep(50);
            }
            Card back = session.game().getPlayer(meView.getId()).getAllCards().stream().filter(c -> c.getName().equals(NEW_CARD)).findFirst().orElseThrow();
            Assert.assertEquals(back.getNetPower(), 3, "the stand-in came back intact");
        } finally {
            session.abort();
        }
    }
}
