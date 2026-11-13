package forge.web.engine;

import forge.card.MagicColor;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.util.MyRandom;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Tapping several permanents for mana with chosen colors, including through another card's "tap an untapped artifact" ability. */
public class ManaTapsTest {

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    private static <T> T onGameThread(Game g, Supplier<T> f) throws Exception {
        CompletableFuture<T> out = new CompletableFuture<>();
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
        return p.getAllCards().stream().filter(c -> c.getName().equals(name)).findFirst().orElseThrow(() -> new AssertionError("no " + name + " among " + p.getAllCards().stream().map(Card::getName).filter(n -> !n.equals("Island")).toList()));
    }

    @Test(timeOut = 240_000)
    public void tapSeveralForChosenColors() throws Exception {
        MyRandom.setRandom(new Random(3));
        Deck d = new Deck("Talrand");
        d.getOrCreate(DeckSection.Commander).add("Kenrith, the Returned King", 1);
        d.getMain().add("Island", 94);
        for (String extra : List.of("Urza, Lord High Artificer", "Tundra", "Sol Ring", "Ornithopter", "Birds of Paradise",
                "Adarkar Wastes", "Mana Confluence", "City of Brass")) {
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
            for (String name : List.of("Tundra", "Sol Ring", "Ornithopter", "Birds of Paradise", "Urza, Lord High Artificer")) {
                CountDownLatch done = new CountDownLatch(1);
                Assert.assertTrue(manual.run(g, me, named(me, name), "toBattlefield", null, done::countDown), name);
                Assert.assertTrue(done.await(10, TimeUnit.SECONDS), name + " in play");
            }
            Card tundra = g.getCardState(named(me, "Tundra"));
            Card ring = g.getCardState(named(me, "Sol Ring"));
            Card thopter = g.getCardState(named(me, "Ornithopter"));
            Card birds = g.getCardState(named(me, "Birds of Paradise"));

            Map<Integer, List<ManaTaps.Pick>> opts = onGameThread(g, () -> ManaTaps.options(g, me, List.of(tundra, ring, thopter, birds)));
            List<String> tundraMana = opts.get(tundra.getId()).stream().map(ManaTaps.Pick::mana).sorted().toList();
            Assert.assertEquals(tundraMana, List.of("U", "W"), "Tundra: white or blue");
            List<ManaTaps.Pick> ringPicks = opts.get(ring.getId());
            Assert.assertTrue(ringPicks.stream().anyMatch(p -> p.via() == null && p.mana().equals("CC")), "Sol Ring's own {C}{C}: " + ringPicks);
            Assert.assertTrue(ringPicks.stream().anyMatch(p -> "Urza, Lord High Artificer".equals(p.via()) && p.mana().equals("U")), "or Urza's {U}");
            Assert.assertEquals(opts.get(thopter.getId()).size(), 1, "Ornithopter only through Urza");
            Assert.assertFalse(opts.containsKey(birds.getId()), "Birds is summoning sick");

            ManaTaps.Pick blue = opts.get(tundra.getId()).stream().filter(p -> p.mana().equals("U")).findFirst().orElseThrow();
            ManaTaps.Pick ringUrza = ringPicks.stream().filter(p -> p.via() != null).findFirst().orElseThrow();
            ManaTaps.Pick thopterUrza = opts.get(thopter.getId()).get(0);
            int used = onGameThread(g, () -> ManaTaps.tap(g, me, List.of(blue, ringUrza, thopterUrza)));
            Assert.assertEquals(used, 3, "all three tapped");
            Assert.assertTrue(tundra.isTapped() && ring.isTapped() && thopter.isTapped(), "tapped");
            Assert.assertEquals(me.getManaPool().getAmountOfColor(MagicColor.BLUE), 3, "three blue floating");
            Assert.assertEquals(me.getManaPool().totalMana(), 3, "and nothing else");
            Assert.assertTrue(onGameThread(g, () -> ManaTaps.options(g, me, List.of(tundra, ring))).isEmpty(), "tapped cards have no options");
            Assert.assertEquals(onGameThread(g, () -> ManaTaps.tap(g, me, List.of(blue))).intValue(), 0, "a stale pick is skipped");

            // Pain: Adarkar Wastes' {C} is free, its {W}/{U} deal 1 damage; Mana Confluence costs 1 life; City of Brass's trigger deals 1.
            for (String name : List.of("Adarkar Wastes", "Mana Confluence", "City of Brass")) {
                CountDownLatch done = new CountDownLatch(1);
                Assert.assertTrue(manual.run(g, me, named(me, name), "toBattlefield", null, done::countDown), name);
                Assert.assertTrue(done.await(10, TimeUnit.SECONDS), name + " in play");
            }
            Card wastes = g.getCardState(named(me, "Adarkar Wastes"));
            Card confluence = g.getCardState(named(me, "Mana Confluence"));
            Card brass = g.getCardState(named(me, "City of Brass"));
            Map<Integer, List<ManaTaps.Pick>> pain = onGameThread(g, () -> ManaTaps.options(g, me, List.of(wastes, confluence, brass)));
            List<ManaTaps.Pick> wp = pain.get(wastes.getId());
            Assert.assertTrue(wp.stream().anyMatch(p -> p.mana().equals("C") && p.damage() == 0 && p.life() == 0), "free {C}: " + wp);
            Assert.assertTrue(wp.stream().filter(p -> !p.mana().equals("C")).allMatch(p -> p.damage() == 1 && p.life() == 0), "colors hurt: " + wp);
            Assert.assertEquals(pain.get(confluence.getId()).size(), 5, "Confluence: any color");
            Assert.assertTrue(pain.get(confluence.getId()).stream().allMatch(p -> p.life() == 1 && p.damage() == 0), "1 life each");
            Assert.assertTrue(pain.get(brass.getId()).stream().allMatch(p -> p.damage() == 1 && p.life() == 0), "City of Brass: 1 damage");

            int life = me.getLife();
            ManaTaps.Pick wastesW = wp.stream().filter(p -> p.mana().equals("W")).findFirst().orElseThrow();
            ManaTaps.Pick confluenceG = pain.get(confluence.getId()).stream().filter(p -> p.mana().equals("G")).findFirst().orElseThrow();
            Assert.assertEquals(onGameThread(g, () -> ManaTaps.tap(g, me, List.of(wastesW, confluenceG))).intValue(), 2, "both tapped");
            Assert.assertEquals(me.getManaPool().getAmountOfColor(MagicColor.WHITE), 1, "white floating");
            Assert.assertEquals(me.getManaPool().getAmountOfColor(MagicColor.GREEN), 1, "green floating");
            Assert.assertEquals(me.getLife(), life - 2, "1 damage and 1 life");
        } finally {
            session.abort();
        }
    }
}
