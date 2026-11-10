package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.StaticData;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.item.PaperCard;
import forge.item.PaperToken;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Your chosen printings reach Forge, and Forge's token printings translate to Scryfall's. */
public class PrintingsTest {

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    @Test
    public void deckCardsKeepTheChosenPrinting() {
        ObjectMapper json = new ObjectMapper();
        ObjectNode deck = json.createObjectNode();
        ArrayNode cards = deck.putArray("cards");
        cards.addObject().put("name", "Krenko, Mob Boss").put("quantity", 1).put("board", "commander").put("set", "m13").put("collectorNumber", "138");
        cards.addObject().put("name", "Mountain").put("quantity", 99).put("board", "main");
        Deck d = Decks.fromJson(deck);
        PaperCard krenko = d.get(DeckSection.Commander).toFlatList().get(0);
        Assert.assertEquals(krenko.getEdition(), "M13", "Krenko comes from the set you picked");
    }

    @Test
    public void tokenKeysMapToScryfallPrintings() {
        // Tenth Edition lists a red 1/1 Goblin token, #4 (Scryfall: t10e/4, "Goblin").
        PaperToken goblin = StaticData.instance().getAllTokens().getToken("r_1_1_goblin", "10E");
        Assert.assertNotNull(goblin, "Forge has 10E's Goblin token");
        String key = goblin.getImageKey(false);
        Assert.assertEquals(key.substring(0, key.lastIndexOf('|')), "t:r_1_1_goblin|10E|4");
        Assert.assertEquals(ViewJson.tokenPrinting(key), new String[] {"t10e", "4"});
        Assert.assertNull(ViewJson.tokenPrinting("t:r_1_1_goblin"), "no printing without a set");
    }

    @Test
    public void tokensUseTheOwnersDeckArt() {
        java.util.Map<String, String> art = java.util.Map.of(
                "goblin|R|1/1", "11111111-1111-1111-1111-111111111111",
                "ooze|G|0/0", "22222222-2222-2222-2222-222222222222",
                "treasure||-", "33333333-3333-3333-3333-333333333333");
        Assert.assertEquals(ViewJson.pickedArt(art, "goblin|R|1/1"), "11111111-1111-1111-1111-111111111111");
        Assert.assertEquals(ViewJson.pickedArt(art, "treasure||-"), "33333333-3333-3333-3333-333333333333");
        // Forge's X/X Ooze is "x/x"; the deck's only green Ooze still matches by name and colors.
        Assert.assertEquals(ViewJson.pickedArt(art, "ooze|G|x/x"), "22222222-2222-2222-2222-222222222222");
        Assert.assertNull(ViewJson.pickedArt(art, "goblin|B|1/1"), "a black Goblin isn't the deck's red one");
        Assert.assertNull(ViewJson.pickedArt(null, "goblin|R|1/1"));
    }
}
