package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.StaticData;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.ability.AbilityFactory;
import forge.game.ability.effects.CopyPermanentEffect;
import forge.game.card.Card;
import forge.game.card.CardFactory;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/**
 * A token copy shows the card it copies: Forge gives it that card's image key ("c:…"), not a token
 * key, so it mustn't be looked up as a token printing (Caller of the Pack's Myriad copies came out
 * as a Kithkin token: "c:Caller of the Pack|C16|1" read as token set tc16, #1).
 */
public class CopyArtTest {

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

    @Test
    public void copiedCardNamesTheCardFromItsKey() {
        Assert.assertEquals(ViewJson.copiedCard("c:Caller of the Pack|C16|1"), "Caller of the Pack");
        Assert.assertEquals(ViewJson.copiedCard("c:Lim-Dul the Necromancer|5ED|1"), "Lim-Dûl the Necromancer", "keys strip accents");
        Assert.assertEquals(ViewJson.copiedCard("c:Delver of Secrets|ISD|1$alt"), "Insectile Aberration", "a transformed copy shows its back");
        Assert.assertNull(ViewJson.copiedCard("t:r_1_1_goblin|10E|4"), "a token's own key isn't a copy");
        Assert.assertNull(ViewJson.copiedCard(null));
    }

    @Test(timeOut = 240_000)
    public void tokenCopiesShowTheCopiedCard() throws Exception {
        MyRandom.setRandom(new Random(5));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            ViewJson views = new ViewJson(json);

            // Myriad: a plain token copy of Caller of the Pack.
            Card caller = CardFactory.getCard(StaticData.instance().getCommonCards().getCard("Caller of the Pack"), me, g);
            SpellAbility copy = AbilityFactory.getAbility("DB$ CopyPermanent | Defined$ Self", caller);
            copy.setActivatingPlayer(me);
            Card callerCopy = CopyPermanentEffect.getProtoType(copy, caller, me);
            ObjectNode o = views.card(g.getView(), callerCopy.getView(), meView, true);
            Assert.assertTrue(o.path("token").asBoolean(), "still a token");
            Assert.assertEquals(o.path("name").asText(), "Caller of the Pack");
            Assert.assertEquals(o.path("copyOf").asText(), "Caller of the Pack", "shows Caller of the Pack's art");
            Assert.assertFalse(o.has("tokenKey"), "not looked up as a token printing: " + o);
            Assert.assertFalse(o.has("tokenSet"), "not looked up as a token printing: " + o);

            // Mishra, Eminent One: a 4/4 copy of an artifact under another name.
            Card mishra = CardFactory.getCard(StaticData.instance().getCommonCards().getCard("Mishra, Eminent One"), me, g);
            Card ring = CardFactory.getCard(StaticData.instance().getCommonCards().getCard("Sol Ring"), me, g);
            SpellAbility warform = AbilityFactory.getAbility(mishra, "TrigCopy");
            warform.setActivatingPlayer(me);
            Card token = CopyPermanentEffect.getProtoType(warform, ring, me);
            ObjectNode w = views.card(g.getView(), token.getView(), meView, true);
            Assert.assertEquals(w.path("name").asText(), "Mishra's Warform");
            Assert.assertEquals(w.path("copyOf").asText(), "Sol Ring", "shows Sol Ring's art");
            Assert.assertFalse(w.has("tokenKey"), "not looked up as a token printing: " + w);
        } finally {
            session.abort();
        }
    }
}
