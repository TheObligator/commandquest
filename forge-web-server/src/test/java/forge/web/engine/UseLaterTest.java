package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.google.common.eventbus.AllowConcurrentEvents;
import com.google.common.eventbus.Subscribe;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.ability.AbilityKey;
import forge.game.card.Card;
import forge.game.event.GameEventSpellAbilityCast;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.YieldUpdate;
import forge.gui.FThreads;
import forge.model.FModel;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Abilities put off to a step: used there for the player, or the player is stopped there. */
public class UseLaterTest {

    private static final ObjectMapper JSON = new ObjectMapper();

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

    static <T> T onGameThread(Game g, Supplier<T> f) throws Exception {
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

    static Card make(Player p, String name, ZoneType zone) {
        Card c = Card.fromPaperCard(FModel.getMagicDb().getCommonCards().getCard(name), p);
        Game g = p.getGame();
        return zone == ZoneType.Battlefield
                ? g.getAction().moveToPlay(c, p, null, AbilityKey.newMap())
                : g.getAction().moveTo(zone, c, null, AbilityKey.newMap());
    }

    /** The text of the card's first ability that can be put off. */
    private static String ability(Card c, Player me) {
        return c.getAllPossibleAbilities(me, false).stream().filter(UseLater::applies).map(UseLater::label).findFirst().orElseThrow();
    }

    private static UseLater.Spec spec(UseLater.When when, boolean ask, boolean everyTurn, boolean everyCopy) {
        return new UseLater.Spec(when, null, null, ask, everyTurn, everyCopy);
    }

    /** Where each activation happened: "card, whose turn, step". */
    private static List<String> watch(Game g) {
        List<String> casts = new CopyOnWriteArrayList<>();
        g.subscribeToEvents(new Object() {
            @Subscribe
            @AllowConcurrentEvents
            public void on(GameEventSpellAbilityCast ev) {
                casts.add(ev.si().getSourceCard().getName() + ", " + g.getPhaseHandler().getPlayerTurn().getName() + ", " + g.getPhaseHandler().getPhase());
            }
        });
        return casts;
    }

    private record Table(GameSession session, GameSessionTest.ScriptedBrowser browser, Game g, Player me, PlayerView meView, WebPlayerController ctl) {
    }

    /** A three-player game, stopped in your main phase with an empty hand and no stops on anyone's turn but your main phase. */
    private static Table table(int seed) throws Exception {
        MyRandom.setRandom(new Random(seed));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null),
                new GameSession.Seat("AI 2", deck("Talrand, Sky Summoner", "Island"), null)));
        PlayerView meView = PaymentTest.untilMyMain(session, browser);
        Game g = session.game();
        Player me = g.getPlayer(meView.getId());
        WebPlayerController ctl = (WebPlayerController) session.controller("You", meView);
        CompletableFuture<Void> skipped = new CompletableFuture<>();
        FThreads.invokeInEdtLater(() -> {
            for (Player p : g.getPlayers()) {
                for (PhaseType t : PhaseType.values()) {
                    ctl.applyYieldUpdate(new YieldUpdate.SkipPhase(p.getView(), t, p != me || t != PhaseType.MAIN1));
                }
            }
            skipped.complete(null);
        });
        skipped.get(10, TimeUnit.SECONDS);
        onGameThread(g, () -> {
            for (Card c : me.getCardsIn(ZoneType.Hand).threadSafeIterable()) {
                g.getAction().moveToLibrary(c, -1, null);
            }
            return null;
        });
        return new Table(session, browser, g, me, meView, ctl);
    }

    /** Presses OK at every prompt until it's your next turn's main phase; notes the priority prompts on the way. */
    private static List<String> toMyNextMain(Table t) throws Exception {
        int turn = t.g().getPhaseHandler().getTurn();
        List<String> stops = new CopyOnWriteArrayList<>();
        GameSessionTest.pass(t.ctl());
        long deadline = System.currentTimeMillis() + 90_000;
        while (System.currentTimeMillis() < deadline) {
            Object[] prompt = t.browser().buttonPrompts.poll(5, TimeUnit.SECONDS);
            var gv = t.session().view();
            Assert.assertFalse(gv == null || gv.isGameOver(), "the game goes on");
            if (prompt == null || !t.meView().equals(prompt[0])) {
                continue;
            }
            var ph = t.g().getPhaseHandler();
            if (ph.getTurn() > turn && ph.isPlayerTurn(t.me()) && ph.getPhase() == PhaseType.MAIN1) {
                return stops;
            }
            if (!Boolean.TRUE.equals(prompt[3])) {
                // Searching the library: take the first land offered.
                FThreads.invokeInEdtLater(() -> {
                    for (Card c : t.me().getCardsIn(ZoneType.Library).threadSafeIterable()) {
                        if (t.ctl().selectCard(c.getView(), null, null)) {
                            return;
                        }
                    }
                });
                continue;
            }
            stops.add(ph.getPlayerTurn().getName() + ", " + ph.getPhase() + (t.ctl().later().asking() ? ", asked" : ""));
            GameSessionTest.pass(t.ctl());
        }
        throw new AssertionError("never got to your next turn: " + stops);
    }

    @Test(timeOut = 240_000)
    public void aFetchLandIsCrackedInTheEndStepBeforeYourTurn() throws Exception {
        Table t = table(11);
        try {
            List<String> casts = watch(t.g());
            Card heath = onGameThread(t.g(), () -> make(t.me(), "Windswept Heath", ZoneType.Battlefield));
            String label = ability(heath, t.me());
            Assert.assertNull(onGameThread(t.g(), () -> t.ctl().later().set(t.g(), t.me(), heath, label, spec(UseLater.When.BEFORE_MY_TURN, false, false, false))));
            Assert.assertEquals(t.ctl().later().json(JSON, t.g(), t.me()).get(0).path("text").asText(), "End step before your turn");
            String before = t.g().getPlayers().get((t.g().getPlayers().indexOf(t.me()) + t.g().getPlayers().size() - 1) % t.g().getPlayers().size()).getName();
            int life = t.me().getLife();

            // Auto-passing everything doesn't skip it.
            t.ctl().setPassUntilMyTurn(true);
            toMyNextMain(t);
            Assert.assertTrue(casts.contains("Windswept Heath, " + before + ", " + PhaseType.END_OF_TURN), "cracked just before your turn: " + casts);
            Assert.assertEquals(casts.stream().filter(c -> c.startsWith("Windswept Heath")).count(), 1);
            Assert.assertTrue(t.me().getLife() <= life - 1, "paid the life");
            Assert.assertTrue(t.me().getCardsIn(ZoneType.Graveyard).anyMatch(c -> c.getName().equals("Windswept Heath")), "sacrificed");
            Assert.assertFalse(t.browser().asked.contains("confirm"), "nothing to confirm: " + t.browser().asked);
            Assert.assertEquals(t.ctl().later().json(JSON, t.g(), t.me()).size(), 0, "no longer waiting");
        } finally {
            t.session().abort();
        }
    }

    @Test(timeOut = 240_000)
    public void askingStopsThereEvenWithoutAStop() throws Exception {
        Table t = table(12);
        try {
            List<String> casts = watch(t.g());
            Card heath = onGameThread(t.g(), () -> make(t.me(), "Windswept Heath", ZoneType.Battlefield));
            String label = ability(heath, t.me());
            onGameThread(t.g(), () -> t.ctl().later().set(t.g(), t.me(), heath, label, spec(UseLater.When.BEFORE_MY_TURN, true, false, false)));
            t.ctl().setPassUntilMyTurn(true);
            List<String> stops = toMyNextMain(t);
            String before = t.g().getPlayers().get((t.g().getPlayers().indexOf(t.me()) + t.g().getPlayers().size() - 1) % t.g().getPlayers().size()).getName();
            Assert.assertTrue(stops.contains(before + ", " + PhaseType.END_OF_TURN + ", asked"), "stopped there: " + stops);
            Assert.assertTrue(casts.stream().noneMatch(c -> c.startsWith("Windswept Heath")), "not used for you");
            Assert.assertEquals(t.ctl().later().json(JSON, t.g(), t.me()).size(), 0, "passing left it");
        } finally {
            t.session().abort();
        }
    }

    @Test(timeOut = 240_000)
    public void everyCopyEveryTurnAndYourUpkeep() throws Exception {
        Table t = table(13);
        try {
            List<String> casts = watch(t.g());
            Card a = onGameThread(t.g(), () -> make(t.me(), "Evolving Wilds", ZoneType.Battlefield));
            onGameThread(t.g(), () -> make(t.me(), "Evolving Wilds", ZoneType.Battlefield));
            String label = ability(a, t.me());
            onGameThread(t.g(), () -> t.ctl().later().set(t.g(), t.me(), a, label, spec(UseLater.When.MY_UPKEEP, false, false, true)));
            toMyNextMain(t);
            String wilds = "Evolving Wilds, " + t.me().getName() + ", " + PhaseType.UPKEEP;
            Assert.assertEquals(casts.stream().filter(wilds::equals).count(), 2, "both copies: " + casts);
            Assert.assertEquals(t.ctl().later().json(JSON, t.g(), t.me()).size(), 1, "still waiting for later copies");
        } finally {
            t.session().abort();
        }
    }

    @Test(timeOut = 240_000)
    public void knowsWhatWouldTakeTheCard() throws Exception {
        Table t = table(14);
        try {
            Player ai = t.g().getPlayers().stream().filter(p -> p != t.me()).findFirst().orElseThrow();
            onGameThread(t.g(), () -> {
                Card heath = make(t.me(), "Windswept Heath", ZoneType.Battlefield);
                Card forest = make(t.me(), "Forest", ZoneType.Battlefield);
                Card mine = make(ai, "Strip Mine", ZoneType.Battlefield);
                SpellAbility strip = mine.getAllPossibleAbilities(ai, false).stream().filter(UseLater::applies).findFirst().orElseThrow();
                strip.setActivatingPlayer(ai);
                strip.getTargets().add(heath);
                Assert.assertTrue(UseLater.loses(strip, heath), "Strip Mine on it");
                Assert.assertFalse(UseLater.loses(strip, forest), "on something else");
                SpellAbility geddon = make(ai, "Armageddon", ZoneType.Hand).getFirstSpellAbility();
                geddon.setActivatingPlayer(ai);
                Assert.assertTrue(UseLater.loses(geddon, heath), "Armageddon");
                SpellAbility wrath = make(ai, "Wrath of God", ZoneType.Hand).getFirstSpellAbility();
                wrath.setActivatingPlayer(ai);
                Assert.assertFalse(UseLater.loses(wrath, heath), "Wrath of God is only for creatures");
                return null;
            });
        } finally {
            t.session().abort();
        }
    }

    @Test(timeOut = 240_000)
    public void refusesWhatCantWaitAndForgetsWhatWasUsed() throws Exception {
        Table t = table(15);
        try {
            UseLater later = t.ctl().later();
            Card forest = onGameThread(t.g(), () -> make(t.me(), "Forest", ZoneType.Battlefield));
            Card heath = onGameThread(t.g(), () -> make(t.me(), "Windswept Heath", ZoneType.Battlefield));
            String label = ability(heath, t.me());
            onGameThread(t.g(), () -> {
                Assert.assertNotNull(later.set(t.g(), t.me(), forest, "{T}: Add {G}.", spec(UseLater.When.NEXT_END, false, false, false)), "a mana ability");
                Assert.assertNull(UseLater.Spec.of(JSON.createObjectNode().put("when", "STEP").put("phase", "UNTAP").put("whose", "ME")), "no priority there");
                Assert.assertNull(UseLater.Spec.of(JSON.createObjectNode().put("when", "SOMEDAY")));
                Assert.assertNotNull(UseLater.Spec.of(JSON.createObjectNode().put("when", "STEP").put("phase", "DRAW").put("whose", "OPP")));
                later.set(t.g(), t.me(), heath, label, spec(UseLater.When.NEXT_END, false, false, false));
                later.set(t.g(), t.me(), heath, label, spec(UseLater.When.MY_UPKEEP, false, false, false));
                ArrayNode now = later.json(JSON, t.g(), t.me());
                Assert.assertEquals(now.size(), 1, "set again replaces it");
                Assert.assertEquals(now.get(0).path("when").asText(), "MY_UPKEEP");
                later.used(heath.getId(), label);
                Assert.assertEquals(later.json(JSON, t.g(), t.me()).size(), 0, "used by hand");
                later.seed(JSON.createArrayNode().add(JSON.createObjectNode().put("card", "Windswept Heath").put("text", label).put("when", "NEXT_END"))
                        .add(JSON.createObjectNode().put("card", "").put("text", "x").put("when", "NEXT_END")));
                Assert.assertEquals(later.json(JSON, t.g(), t.me()).get(0).path("everyCopy").asBoolean(), true, "saved ones are for every copy");
                Assert.assertEquals(later.json(JSON, t.g(), t.me()).size(), 1);
                return null;
            });
        } finally {
            t.session().abort();
        }
    }
}
