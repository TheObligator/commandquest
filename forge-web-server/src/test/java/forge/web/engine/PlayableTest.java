package forge.web.engine;

import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.ability.AbilityKey;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
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

/** The "playable" glow only goes on cards you can also pay for. */
public class PlayableTest {

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
    public void onlyCardsYouCanPayForGlow() throws Exception {
        MyRandom.setRandom(new Random(5));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            boolean[] usable = onGameThread(g, () -> {
                for (Card land : me.getCardsIn(ZoneType.Battlefield).threadSafeIterable()) {
                    if (land.isLand()) {
                        land.tap(true, null, null);
                    }
                }
                make(me, "Forest", ZoneType.Battlefield);
                Card elves = make(me, "Llanowar Elves", ZoneType.Hand);
                Card giant = make(me, "Craterhoof Behemoth", ZoneType.Hand);
                Card ezuri = me.getCardsIn(ZoneType.Command).stream().filter(Card::isCommander).findFirst().orElseThrow();
                return new boolean[] {Explain.usableNow(elves, me), Explain.usableNow(giant, me), Explain.usableNow(ezuri, me)};
            });
            Assert.assertTrue(usable[0], "one untapped Forest pays for Llanowar Elves");
            Assert.assertFalse(usable[1], "one Forest can't pay for Craterhoof Behemoth");
            Assert.assertFalse(usable[2], "one Forest can't pay for Ezuri ({1}{G}{G})");
        } finally {
            session.abort();
        }
    }
}
