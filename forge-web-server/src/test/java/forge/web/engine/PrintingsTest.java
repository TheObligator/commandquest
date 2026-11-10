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
        cards.addObject().put("name", "Krenko, Mob Boss").put("quantity", 1).put("board", "commander").put("set", "m13").put("collectorNumber", "141");
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
}
