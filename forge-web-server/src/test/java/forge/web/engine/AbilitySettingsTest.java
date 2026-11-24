package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.ability.AbilityKey;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CounterType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.trigger.TriggerType;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.input.Input;
import forge.gamemodes.match.input.InputConfirm;
import forge.gamemodes.match.input.InputPassPriority;
import forge.gui.FThreads;
import forge.model.FModel;
import forge.player.AutoYieldStore.TriggerDecision;
import forge.util.MyRandom;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Auto-yield and always yes / no, set per ability, also when it isn't on the stack. */
public class AbilitySettingsTest {

    private final ObjectMapper json = new ObjectMapper();

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    @Test
    public void everyCopyOrOneCard() throws Exception {
        AbilitySettings s = new AbilitySettings();
        String one = "Soul's Attendant (5): Whenever another creature enters, you may gain 1 life.";
        String two = "Soul's Attendant (9): Whenever another creature enters, you may gain 1 life.";
        s.setDecision(one, TriggerDecision.ACCEPT);
        s.setAutoYield(two, true);
        Assert.assertEquals(s.decision(two), TriggerDecision.ACCEPT, "every copy by default");
        Assert.assertTrue(s.autoYield(one));

        s.setEveryCopy(one, false); // what's set moves to that card
        Assert.assertEquals(s.decision(one), TriggerDecision.ACCEPT);
        Assert.assertTrue(s.autoYield(one));
        Assert.assertEquals(s.decision(two), TriggerDecision.ASK);
        Assert.assertFalse(s.autoYield(two));

        // A card on its own can ask while every other copy doesn't.
        s.setDecision(two, TriggerDecision.DECLINE);
        s.setDecision(one, TriggerDecision.ASK);
        Assert.assertEquals(s.decision(one), TriggerDecision.ASK);
        Assert.assertEquals(s.decision(two), TriggerDecision.DECLINE);
        JsonNode view = s.json(json);
        Assert.assertEquals(view.path("cardOnly").get(0).asText(), one);
        Assert.assertEquals(view.path("set").path("Whenever another creature enters, you may gain 1 life.").path("decision").asText(), "DECLINE");

        // Back to every copy: what that card had (nothing but auto-yield) goes with it.
        s.setEveryCopy(one, true);
        Assert.assertTrue(s.autoYield(two));
        Assert.assertEquals(s.decision(two), TriggerDecision.ASK);

        // Saved with the deck.
        AbilitySettings fresh = new AbilitySettings();
        fresh.seed(json.readTree("[{\"text\":\"Whenever another creature enters, you may gain 1 life.\",\"decision\":\"ACCEPT\"},{\"text\":\"\"},{\"nope\":1}]"));
        Assert.assertEquals(fresh.decision(two), TriggerDecision.ACCEPT);
        Assert.assertFalse(fresh.autoYield(two));
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
        if (zone != ZoneType.Battlefield) {
            return g.getAction().moveTo(zone, c, null, AbilityKey.newMap());
        }
        Card hand = g.getAction().moveTo(ZoneType.Hand, c, null, AbilityKey.newMap());
        Card in = g.getAction().moveToPlay(hand, p, null, AbilityKey.newMap());
        g.getTriggerHandler().runWaitingTriggers(); // what saw it enter
        g.getTriggerHandler().resetActiveTriggers(); // and its own from now on
        return in;
    }

    private static void onUi(Runnable r) throws Exception {
        CompletableFuture<Void> done = new CompletableFuture<>();
        FThreads.invokeInEdtLater(() -> {
            try {
                r.run();
                done.complete(null);
            } catch (RuntimeException e) {
                done.completeExceptionally(e);
            }
        });
        done.get(10, TimeUnit.SECONDS);
    }

    private static Input input(WebPlayerController ctl) {
        return ctl.getInputProxy().getInput();
    }

    /** Presses OK on priority until the stack is empty, or stops at the first other question (returned). */
    private static Input resolveStack(WebPlayerController ctl, Game g) throws Exception {
        long end = System.currentTimeMillis() + 30_000;
        Thread.sleep(300);
        while (System.currentTimeMillis() < end) {
            Input in = input(ctl);
            if (in instanceof InputPassPriority) {
                if (g.getStack().isEmpty() && !g.getStack().hasSimultaneousStackEntries()) {
                    return null;
                }
                onUi(ctl::selectButtonOk);
            } else if (in != null && !(in.getClass().getSimpleName().equals("InputLockUI"))) {
                return in;
            }
            Thread.sleep(150);
        }
        throw new AssertionError("the stack never emptied; input " + input(ctl));
    }

    @Test(timeOut = 240_000)
    public void presetsAnswerRealTriggers() throws Exception {
        MyRandom.setRandom(new Random(5));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            WebPlayerController ctl = (WebPlayerController) session.controller("You", meView);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());

            // Chun-Li's two abilities are listed separately, in hand too; only Lightning Kick asks "you may".
            Card inHand = onGameThread(g, () -> make(me, "Chun-Li, Countless Kicks", ZoneType.Hand));
            JsonNode list = AbilitySettings.list(inHand, me, json);
            Assert.assertEquals(list.size(), 2, list.toString());
            Assert.assertTrue(list.get(0).path("text").asText().startsWith("When Chun-Li enters"), list.toString());
            Assert.assertFalse(list.get(0).has("mayAsk"));
            Assert.assertTrue(list.get(1).path("text").asText().startsWith("Lightning Kick"));
            Assert.assertTrue(list.get(1).path("mayAsk").asBoolean());
            Assert.assertTrue(list.get(1).path("mine").asBoolean());

            // Always yes, set while it isn't on the stack: two copies, neither asks.
            Card[] attendants = onGameThread(g, () -> new Card[] {
                make(me, "Soul's Attendant", ZoneType.Battlefield), make(me, "Soul's Attendant", ZoneType.Battlefield)});
            String key = AbilitySettings.list(attendants[0], me, json).get(0).path("key").asText();
            ctl.setTriggerDecision(key, TriggerDecision.ACCEPT, true);
            Input asked = resolveStack(ctl, g);
            Assert.assertNull(asked, "the second one entering triggered the first; not asked");
            int life = me.getLife();
            onGameThread(g, () -> make(me, "Llanowar Elves", ZoneType.Battlefield));
            waitForStack(ctl, g);
            String other = AbilitySettings.list(attendants[1], me, json).get(0).path("key").asText();
            java.util.Set<String> onStack = new java.util.HashSet<>();
            g.getStack().forEach(si -> onStack.add(si.getSpellAbility().yieldKey()));
            Assert.assertEquals(onStack, java.util.Set.of(key, other), "the stack's keys are the ones worked out off the stack");
            Assert.assertNull(resolveStack(ctl, g), "always yes");
            Assert.assertEquals(me.getLife(), life + 2);

            // Always no for one card only.
            ctl.setEveryCopy(key, false);
            ctl.setTriggerDecision(key, TriggerDecision.DECLINE, true);
            ctl.setTriggerDecision(other, TriggerDecision.ACCEPT, true);
            life = me.getLife();
            onGameThread(g, () -> make(me, "Llanowar Elves", ZoneType.Battlefield));
            waitForStack(ctl, g);
            Assert.assertNull(resolveStack(ctl, g));
            Assert.assertEquals(me.getLife(), life + 1, "one says no, the other yes");

            // Auto-yield: after the priority you have now, you don't stop for the second.
            ctl.setShouldAutoYield(key, true, true);
            ctl.setShouldAutoYield(other, true, true);
            life = me.getLife();
            onGameThread(g, () -> make(me, "Llanowar Elves", ZoneType.Battlefield));
            waitForStack(ctl, g);
            Thread.sleep(300);
            onUi(ctl::selectButtonOk);
            long until = System.currentTimeMillis() + 10_000;
            while (!g.getStack().isEmpty()) {
                Assert.assertTrue(System.currentTimeMillis() < until, "both resolve on one OK");
                Thread.sleep(50);
            }
            Assert.assertNull(resolveStack(ctl, g));
            Assert.assertEquals(me.getLife(), life + 1);
            ctl.setShouldAutoYield(key, false, true);
            ctl.setShouldAutoYield(other, false, true);

            // Cleared: it asks again.
            ctl.setTriggerDecision(other, TriggerDecision.ASK, true);
            onGameThread(g, () -> make(me, "Llanowar Elves", ZoneType.Battlefield));
            waitForStack(ctl, g);
            asked = resolveStack(ctl, g);
            Assert.assertTrue(asked instanceof InputConfirm, "asks: " + asked);
            onUi(ctl::selectButtonCancel);
            Assert.assertNull(resolveStack(ctl, g));

            // Lightning Kick's "You may cast the copies" is asked by its effect.
            Card chunLi = onGameThread(g, () -> {
                for (Card a : attendants) {
                    g.getAction().moveTo(ZoneType.Exile, a, null, AbilityKey.newMap());
                }
                return make(me, "Chun-Li, Countless Kicks", ZoneType.Battlefield);
            });
            resolveStack(ctl, g);
            Card bolt = onGameThread(g, () -> {
                Card c = make(me, "Lightning Bolt", ZoneType.Exile);
                c.addCounterInternal(CounterType.getType("KICK"), 1, me, false, null, null);
                return c;
            });
            Assert.assertEquals(bolt.getCounters(CounterType.getType("KICK")), 1);
            String kick = AbilitySettings.list(chunLi, me, json).get(1).path("key").asText();
            attack(g, chunLi);
            waitForStack(ctl, g);
            asked = resolveStack(ctl, g);
            Assert.assertTrue(asked instanceof InputConfirm, "no setting: asks " + asked);
            onUi(ctl::selectButtonCancel);
            Assert.assertNull(resolveStack(ctl, g));

            ctl.setTriggerDecision(kick, TriggerDecision.DECLINE, true);
            attack(g, chunLi);
            waitForStack(ctl, g);
            Assert.assertNull(resolveStack(ctl, g), "always no: not asked, nothing cast");

            // Two cards: always yes still asks which to cast next; always no doesn't.
            Card second = onGameThread(g, () -> {
                Card c = make(me, "Lightning Strike", ZoneType.Exile);
                c.addCounterInternal(CounterType.getType("KICK"), 1, me, false, null, null);
                return c;
            });
            for (TriggerDecision d : new TriggerDecision[] {TriggerDecision.DECLINE, TriggerDecision.ACCEPT}) {
                ctl.setTriggerDecision(kick, d, true);
                attack(g, chunLi);
                waitForStack(ctl, g);
                asked = resolveStack(ctl, g);
                if (d == TriggerDecision.DECLINE) {
                    Assert.assertNull(asked, "always no: not asked which");
                } else {
                    Assert.assertTrue(asked instanceof forge.gamemodes.match.input.InputSelectEntitiesFromList, "always yes: still pick which, " + asked);
                    onUi(ctl::selectButtonCancel);
                    Assert.assertNull(resolveStack(ctl, g));
                }
            }
            onGameThread(g, () -> g.getAction().moveTo(ZoneType.Graveyard, second, null, AbilityKey.newMap()));

            attack(g, chunLi);
            waitForStack(ctl, g);
            asked = resolveStack(ctl, g);
            Assert.assertFalse(asked == null || asked instanceof InputConfirm, "always yes: straight to casting the copy, not " + asked);
        } finally {
            session.abort();
        }
    }

    private static void attack(Game g, Card attacker) throws Exception {
        onGameThread(g, () -> {
            Map<AbilityKey, Object> p = AbilityKey.newMap();
            p.put(AbilityKey.Attacker, attacker);
            p.put(AbilityKey.Attackers, new CardCollection(attacker));
            p.put(AbilityKey.Attacked, attacker.getController().getOpponents().get(0));
            p.put(AbilityKey.DefendingPlayer, attacker.getController().getOpponents().get(0));
            p.put(AbilityKey.Defender, attacker.getController().getOpponents().get(0));
            p.put(AbilityKey.OtherAttackers, new CardCollection());
            g.getTriggerHandler().runTrigger(TriggerType.Attacks, p, false);
            return null;
        });
    }

    /** Triggers go on the stack when you next get priority: press OK (pass) isn't needed, Forge checks them then. */
    private static void waitForStack(WebPlayerController ctl, Game g) throws Exception {
        onGameThread(g, () -> {
            g.getTriggerHandler().runWaitingTriggers();
            g.getStack().addAllTriggeredAbilitiesToStack();
            return null;
        });
        long end = System.currentTimeMillis() + 10_000;
        while (g.getStack().isEmpty()) {
            Assert.assertTrue(System.currentTimeMillis() < end, "nothing on the stack");
            Thread.sleep(50);
        }
    }
}
