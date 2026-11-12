package forge.web.engine;

import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.keyword.Keyword;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.staticability.StaticAbilityCantAttackBlock;
import forge.gamemodes.match.input.InputAttack;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.player.PlayerControllerHuman;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Manual effects on permanents in a real game: until-end-of-turn effects, and putting a creature into combat attacking. */
public class ManualEffectsTest {

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    private static Deck deck(String commander, String basic, String extra) {
        Deck d = new Deck(commander);
        d.getOrCreate(DeckSection.Commander).add(commander, 1);
        d.getMain().add(basic, extra == null ? 99 : 98);
        if (extra != null) {
            d.getMain().add(extra, 1);
        }
        return d;
    }

    private static void run(ManualActions manual, Game g, Player me, Card card, String action, List<Player> to) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        Assert.assertTrue(manual.run(g, me, card, action, to, done::countDown), action + " applies");
        Assert.assertTrue(done.await(10, TimeUnit.SECONDS), action + " ran");
    }

    private static Card named(Player p, String name) {
        return p.getAllCards().stream().filter(c -> c.getName().equals(name)).findFirst().orElseThrow();
    }

    @Test(timeOut = 240_000)
    public void untilEndOfTurnAndAttacking() throws Exception {
        MyRandom.setRandom(new Random(6));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest", "Llanowar Elves"), browser),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island", null), null)));
        try {
            PlayerView meView = PaymentTest.untilMyMain(session, browser);
            Game g = session.game();
            Player me = g.getPlayer(meView.getId());
            Player ai = g.getPlayers().stream().filter(p -> p != me).findFirst().orElseThrow();
            ManualActions manual = new ManualActions();
            Card elves = named(me, "Llanowar Elves");
            Card talrand = named(ai, "Talrand, Sky Summoner");
            run(manual, g, me, elves, "toBattlefield", null);
            run(manual, g, ai, talrand, "toBattlefield", null);
            elves = g.getCardState(elves);
            talrand = g.getCardState(talrand);

            run(manual, g, me, elves, "eot:haste", null);
            run(manual, g, me, elves, "eot:flying", null);
            run(manual, g, me, elves, "eot:pt:+2:+2", null);
            Assert.assertTrue(elves.hasKeyword(Keyword.HASTE) && elves.hasKeyword(Keyword.FLYING), "haste and flying");
            Assert.assertEquals(elves.getNetPower(), 3, "+2/+2");
            run(manual, g, me, elves, "eot:unblockable", null);
            Assert.assertTrue(StaticAbilityCantAttackBlock.cantBlockBy(elves, talrand), "Talrand can't block it");

            Assert.assertFalse(ManualActions.allowed(elves, me, "eot:control"), "you already control it");
            Assert.assertTrue(ManualActions.allowed(talrand, me, "eot:pt:-1:-1"), "effects go on opponents' permanents too");
            Assert.assertFalse(ManualActions.allowed(talrand, me, "tap"), "but tapping is for your own");
            run(manual, g, me, talrand, "eot:control", null);
            Assert.assertEquals(talrand.getController(), me, "stole Talrand for the turn");
            Assert.assertFalse(manual.run(g, me, talrand, "attack", List.of(ai), () -> { }), "no attacking outside combat");
            Assert.assertFalse(manual.run(g, me, elves, "eot:nonsense", null, () -> { }), "unknown effect");

            // Attack with the elves, then put Talrand into combat attacking too.
            IGameController ctl = session.controller("You", meView);
            Card attacker = elves;
            Card extra = talrand;
            long deadline = System.currentTimeMillis() + 60_000;
            boolean declared = false;
            FThreads.invokeInEdtLater(ctl::selectButtonOk); // leave the main phase (its prompt was already taken)
            while (System.currentTimeMillis() < deadline) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                if (prompt == null) {
                    continue;
                }
                Thread.sleep(100);
                PhaseType ph = g.getPhaseHandler().getPhase();
                Combat combat = g.getCombat();
                if (!declared && ((PlayerControllerHuman) ctl).getInputProxy().getInput() instanceof InputAttack) {
                    declared = true;
                    FThreads.invokeInEdtLater(() -> {
                        ctl.selectCard(attacker.getView(), null, null);
                        ctl.selectButtonOk();
                    });
                    continue;
                }
                if (combat != null && combat.isAttacking(attacker) && ph.isAfter(PhaseType.COMBAT_BEGIN)) {
                    run(manual, g, me, extra, "attack", List.of(ai));
                    Assert.assertTrue(combat.isAttacking(extra, ai), "Talrand is attacking the AI");
                    Assert.assertTrue(extra.isTapped(), "tapped and attacking");
                    Assert.assertFalse(manual.run(g, me, extra, "attack", List.of(ai), () -> { }), "already attacking");
                    run(manual, g, me, attacker, "removeFromCombat", null);
                    Assert.assertFalse(combat.isAttacking(attacker), "elves left combat");
                    String log = String.join("\n", g.getGameLog().getAllEntries().stream().map(e -> e.message()).toList());
                    for (String s : List.of("gave Llanowar Elves flying until end of turn (by hand)", "gave Llanowar Elves +2/+2 until end of turn",
                            "gained control of Talrand, Sky Summoner until end of turn", "into combat tapped and attacking AI 1", "removed Llanowar Elves from combat")) {
                        Assert.assertTrue(log.contains(s), "log has '" + s + "':\n" + log);
                    }
                    return;
                }
                FThreads.invokeInEdtLater(ctl::selectButtonOk);
            }
            Assert.fail("never got into combat");
        } finally {
            session.abort();
        }
    }
}
