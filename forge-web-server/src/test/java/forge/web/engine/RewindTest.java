package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.GameView;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.util.MyRandom;
import java.util.List;
import java.util.Random;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Rewinding real games: undoing an action, going back a turn, and asking the other people at the table. */
public class RewindTest {

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

    private static void waitFor(String what, BooleanSupplier cond) throws InterruptedException {
        long end = System.currentTimeMillis() + 20_000;
        while (!cond.getAsBoolean()) {
            Assert.assertTrue(System.currentTimeMillis() < end, "timed out waiting: " + what);
            Thread.sleep(50);
        }
    }

    private static boolean has(Iterable<CardView> zone, int id) {
        if (zone != null) {
            for (CardView c : zone) {
                if (c.getId() == id) {
                    return true;
                }
            }
        }
        return false;
    }

    @Test
    public void offMeansNoRewind() throws Exception {
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Isamaru, Hound of Konda", "Plains"), browser),
                new GameSession.Seat("AI 1", deck("Krenko, Mob Boss", "Mountain"), null)), 0);
        try {
            Assert.assertNull(session.rewind(), "level 0: rewinding is off");
        } finally {
            session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void undoTheLastActionThenGoBackATurn() throws Exception {
        MyRandom.setRandom(new Random(5));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Isamaru, Hound of Konda", "Plains"), browser),
                new GameSession.Seat("AI 1", deck("Krenko, Mob Boss", "Mountain"), null)), 4);
        try {
            Rewind rewind = session.rewind();
            Assert.assertNotNull(rewind);
            Assert.assertEquals(rewind.level(), 4);
            int landId = -1;
            int landTurn = -1;
            boolean undone = false;
            boolean wentBack = false;
            long deadline = System.currentTimeMillis() + 180_000;
            while (System.currentTimeMillis() < deadline && !wentBack) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                GameView gv = session.view();
                Assert.assertFalse(gv == null || gv.isGameOver(), "game still going");
                if (prompt == null || browser.me == null || !browser.me.contains((PlayerView) prompt[0])) {
                    continue;
                }
                PlayerView me = (PlayerView) prompt[0];
                IGameController ctl = session.controller("You", me);
                Game game = session.game();
                Player mine = game.getPlayer(me.getId());
                boolean myMain = me.equals(gv.getPlayerTurn()) && gv.getPhase() == PhaseType.MAIN1;

                if (landId < 0 && myMain && me.getHand() != null) {
                    CardView land = null;
                    for (CardView c : me.getHand()) {
                        if (c.getCurrentState().getType().isLand()) {
                            land = c;
                            break;
                        }
                    }
                    if (land != null) {
                        landId = land.getId();
                        landTurn = gv.getTurn();
                        CardView play = land;
                        FThreads.invokeInEdtLater(() -> ctl.selectCard(play, null, null));
                        continue;
                    }
                }
                if (landId >= 0 && !undone && myMain && has(me.getBattlefield(), landId)) {
                    // priority again after the land: undo it
                    Rewind.Option undo = rewind.options().stream().filter(o -> o.level() == 1).findFirst().orElse(null);
                    Assert.assertNotNull(undo, "an undo is offered: " + rewind.options());
                    Assert.assertTrue(undo.label().startsWith("Before: "), undo.label());
                    Assert.assertNull(rewind.request(mine, undo.point()), "nobody else to ask: done at once");
                    int id = landId;
                    waitFor("the land back in hand", () -> has(me.getHand(), id) && !has(me.getBattlefield(), id));
                    Assert.assertEquals(session.view().getPhase(), PhaseType.MAIN1, "still in the main phase");
                    Assert.assertEquals(session.view().getTurn(), landTurn, "same turn");
                    Assert.assertTrue(game.getGameLog().getAllEntries().stream()
                            .anyMatch(e -> e.message().startsWith("Rewound to before")), "the log says so");
                    undone = true;
                    browser.buttonPrompts.clear();
                    FThreads.invokeInEdtLater(ctl::selectButtonOk);
                    continue;
                }
                if (undone && gv.getTurn() > landTurn) {
                    // the next player's turn: go back to the main phase of the last one (a level 3-4 rewind)
                    int t = landTurn;
                    Rewind.Option back = rewind.options().stream()
                            .filter(o -> o.turn() == t && o.phase().equals(PhaseType.MAIN1.nameForUi))
                            .findFirst().orElse(null);
                    Assert.assertNotNull(back, "the last turn's main phase is offered: " + rewind.options());
                    Assert.assertEquals(back.level(), 4, "a turn back needs level 4");
                    ObjectNode view = rewind.json(JSON, mine);
                    Assert.assertEquals(view.path("level").asInt(), 4);
                    Assert.assertTrue(view.path("options").size() > 0);
                    int notes = rewind.json(JSON, mine).path("noteId").asInt();
                    Assert.assertNull(rewind.request(mine, back.point()));
                    BooleanSupplier done = () -> rewind.json(JSON, mine).path("noteId").asInt() > notes;
                    // it happens at the next priority: answer whatever is asked meanwhile (e.g. blockers)
                    long end = System.currentTimeMillis() + 20_000;
                    while (!done.getAsBoolean()) {
                        Assert.assertTrue(System.currentTimeMillis() < end, "timed out going back a turn: now "
                                + session.view().getTurn() + " " + session.view().getPhase() + ", " + rewind.json(JSON, mine));
                        if (browser.buttonPrompts.poll(500, TimeUnit.MILLISECONDS) != null && !done.getAsBoolean()) {
                            FThreads.invokeInEdtLater(ctl::selectButtonOk);
                        }
                    }
                    Assert.assertTrue(rewind.json(JSON, mine).path("note").asText().startsWith("Rewound"));
                    Assert.assertEquals(session.view().getTurn(), t, "back in that turn");
                    int id = landId;
                    waitFor("the land still in hand", () -> has(me.getHand(), id));
                    wentBack = true;
                    continue;
                }
                FThreads.invokeInEdtLater(ctl::selectButtonOk);
            }
            Assert.assertTrue(undone, "undid the land");
            Assert.assertTrue(wentBack, "went back a turn");
        } finally {
            session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void attackersCanBeDeclaredAgainUntilDamage() throws Exception {
        MyRandom.setRandom(new Random(9));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        // the AI gets a 1-mana 2/2 out at once and attacks; you have nothing to block with
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Krenko, Mob Boss", "Mountain"), browser),
                new GameSession.Seat("AI 1", deck("Isamaru, Hound of Konda", "Plains"), null)), 1);
        try {
            Rewind rewind = session.rewind();
            boolean asked = false;
            int landTurn = -1;
            long deadline = System.currentTimeMillis() + 180_000;
            while (System.currentTimeMillis() < deadline) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                GameView gv = session.view();
                Assert.assertFalse(gv == null || gv.isGameOver(), "game still going");
                Assert.assertTrue(gv.getTurn() < 12, "the AI never attacked");
                if (prompt == null || browser.me == null || !browser.me.contains((PlayerView) prompt[0])) {
                    continue;
                }
                PlayerView me = (PlayerView) prompt[0];
                IGameController ctl = session.controller("You", me);
                Player mine = session.game().getPlayer(me.getId());
                if (!asked && gv.getPhase() == PhaseType.COMBAT_DECLARE_ATTACKERS && gv.getCombat() != null
                        && gv.getCombat().getAttackers().iterator().hasNext()) {
                    Rewind.Option again = rewind.options().stream().filter(o -> o.kind().equals(Rewind.ATTACKERS)).findFirst().orElse(null);
                    Assert.assertNotNull(again, "attackers can be declared again: " + rewind.options());
                    Assert.assertEquals(again.phase(), PhaseType.COMBAT_BEGIN.nameForUi);
                    Assert.assertTrue(rewind.options().stream().noneMatch(o -> o.kind().equals(Rewind.BLOCKERS)), "no blocks yet");
                    int notes = rewind.json(JSON, mine).path("noteId").asInt();
                    Assert.assertNull(rewind.request(mine, again.point(), Rewind.ATTACKERS));
                    asked = true;
                    waitFor("the rewind", () -> rewind.json(JSON, mine).path("noteId").asInt() > notes);
                    Assert.assertTrue(session.game().getGameLog().getAllEntries().stream()
                            .anyMatch(e -> e.message().startsWith("Rewound to declare attackers again")));
                    break;
                }
                CardView land = null;
                if (me.equals(gv.getPlayerTurn()) && gv.getPhase() == PhaseType.MAIN1 && landTurn != gv.getTurn() && me.getHand() != null) {
                    for (CardView c : me.getHand()) {
                        if (c.getCurrentState().getType().isLand()) {
                            land = c;
                            break;
                        }
                    }
                }
                if (land != null) {   // a land a turn, so there's no discarding at cleanup
                    landTurn = gv.getTurn();
                    CardView play = land;
                    FThreads.invokeInEdtLater(() -> ctl.selectCard(play, null, null));
                } else {
                    FThreads.invokeInEdtLater(ctl::selectButtonOk);
                }
            }
            Assert.assertTrue(asked, "saw an attack");
        } finally {
            session.abort();
        }
    }

    @Test(timeOut = 240_000)
    public void aRedeclaredAttackStartsFromTheOldOneWithTheChange() throws Exception {
        MyRandom.setRandom(new Random(13));
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Isamaru, Hound of Konda", "Plains"), browser),
                new GameSession.Seat("AI 1", deck("Krenko, Mob Boss", "Mountain"), null)), 1);
        try {
            Rewind rewind = session.rewind();
            int landTurn = -1;
            int step = 0;   // 0 cast Isamaru, 1 attack, 2 ask to redeclare, 3 check it's back, 4 ask to stop, 5 check it's gone
            int isamaru = -1;
            long deadline = System.currentTimeMillis() + 180_000;
            while (System.currentTimeMillis() < deadline && step < 6) {
                Object[] prompt = browser.buttonPrompts.poll(3, TimeUnit.SECONDS);
                GameView gv = session.view();
                Assert.assertFalse(gv == null || gv.isGameOver(), "game still going");
                Assert.assertTrue(gv.getTurn() < 14, "stuck at step " + step);
                if (prompt == null || browser.me == null || !browser.me.contains((PlayerView) prompt[0])) {
                    continue;
                }
                PlayerView me = (PlayerView) prompt[0];
                IGameController ctl = session.controller("You", me);
                Player mine = session.game().getPlayer(me.getId());
                var input = ((forge.player.PlayerControllerHuman) mine.getController()).getInputQueue().getInput();
                boolean myTurn = me.equals(gv.getPlayerTurn());
                if (input instanceof forge.gamemodes.match.input.InputPayMana) {
                    FThreads.invokeInEdtLater(ctl::selectButtonOk);   // auto-pay
                    continue;
                }
                if (myTurn && gv.getPhase() == PhaseType.MAIN1 && landTurn != gv.getTurn() && me.getHand() != null) {
                    CardView land = null;
                    for (CardView c : me.getHand()) {
                        if (c.getCurrentState().getType().isLand()) {
                            land = c;
                            break;
                        }
                    }
                    if (land != null) {
                        landTurn = gv.getTurn();
                        CardView play = land;
                        FThreads.invokeInEdtLater(() -> ctl.selectCard(play, null, null));
                        continue;
                    }
                }
                if (step == 0 && myTurn && gv.getPhase() == PhaseType.MAIN1 && me.getCommanders() != null && !me.getCommanders().isEmpty()) {
                    CardView cmd = me.getCommanders().get(0);
                    if (me.getCommand() != null && me.getCommand().contains(cmd)) {
                        isamaru = cmd.getId();
                        step = 1;
                        FThreads.invokeInEdtLater(() -> ctl.selectCard(cmd, null, null));
                        continue;
                    }
                }
                Card dog = isamaru < 0 ? null : session.game().findById(isamaru);
                var combat = session.game().getPhaseHandler().getCombat();
                if (input instanceof forge.gamemodes.match.input.InputAttack) {
                    if (step == 1 && dog != null && dog.isInPlay()) {
                        Card d = dog;
                        FThreads.invokeInEdtLater(() -> {
                            ((forge.gamemodes.match.input.InputAttack) input).selectCard(d, null, null);
                            ctl.selectButtonOk();
                        });
                        step = 2;
                        continue;
                    }
                    if (step == 3) {
                        waitFor("the old attack clicked back in", () -> session.game().getPhaseHandler().getCombat() != null
                                && session.game().getPhaseHandler().getCombat().isAttacking(d0(session, isamaruId(session))));
                        step = 4;
                        Thread.sleep(300);   // Forge's input handler catches up with the new prompt
                        FThreads.invokeInEdtLater(ctl::selectButtonOk);
                        continue;
                    }
                    if (step == 5) {
                        Thread.sleep(500);   // give the plan time to (not) click anything
                        Assert.assertFalse(session.game().getPhaseHandler().getCombat().isAttacking(dog),
                                "taken out of the attack: " + session.game().getPhaseHandler().getCombat());
                        step = 6;
                        continue;
                    }
                }
                if (gv.getPhase() == PhaseType.COMBAT_DECLARE_ATTACKERS && combat != null && dog != null && combat.isAttacking(dog)
                        && input instanceof forge.gamemodes.match.input.InputPassPriority) {
                    if (step == 2) {
                        Rewind.Option again = rewind.options().stream().filter(o -> o.kind().equals(Rewind.ATTACKERS)).findFirst().orElseThrow();
                        Assert.assertNull(rewind.request(mine, again.point(), Rewind.ATTACKERS));
                        step = 3;
                        continue;
                    }
                    if (step == 4) {
                        String why = rewind.requestChange(mine, isamaru);
                        Assert.assertNull(why);
                        step = 5;
                        continue;
                    }
                }
                FThreads.invokeInEdtLater(ctl::selectButtonOk);
            }
            GameView end = session.view();
            Player you = session.game().getPlayers().get(0);
            Assert.assertEquals(step, 6, "went through redeclaring; now turn " + end.getTurn() + " " + end.getPhase()
                    + ", input " + ((forge.player.PlayerControllerHuman) you.getController()).getInputQueue().getInput()
                    + ", priority " + session.game().getPhaseHandler().getPriorityPlayer() + ", combat "
                    + session.game().getPhaseHandler().getCombat());
        } finally {
            session.abort();
        }
    }

    private static int isamaruId(GameSession s) {
        for (Player p : s.game().getPlayers()) {
            for (Card c : p.getCommanders()) {
                if (c.getName().startsWith("Isamaru")) {
                    return c.getId();
                }
            }
        }
        return -1;
    }

    private static Card d0(GameSession s, int id) {
        return s.game().findById(id);
    }

    @Test(timeOut = 240_000)
    public void everyoneElseAtTheTableHasToAgree() throws Exception {
        MyRandom.setRandom(new Random(7));
        GameSessionTest.ScriptedBrowser alice = new GameSessionTest.ScriptedBrowser();
        GameSessionTest.ScriptedBrowser bob = new GameSessionTest.ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("Alice", deck("Isamaru, Hound of Konda", "Plains"), alice),
                new GameSession.Seat("Bob", deck("Krenko, Mob Boss", "Mountain"), bob)), 3);
        AtomicBoolean stop = new AtomicBoolean();
        List<Thread> drivers = List.of(passer(session, "Alice", alice, stop), passer(session, "Bob", bob, stop));
        drivers.forEach(Thread::start);
        try {
            Rewind rewind = session.rewind();
            try {
                waitFor("a few turns", () -> session.view() != null && session.view().getTurn() >= 3);
            } catch (AssertionError e) {
                GameView gv = session.view();
                throw new AssertionError(e.getMessage() + " — turn " + (gv == null ? "?" : gv.getTurn() + " " + gv.getPhase())
                        + ", Alice asked " + alice.asked + ", Bob asked " + bob.asked
                        + ", Alice me " + alice.me + ", Bob me " + bob.me);
            }
            Game game = session.game();
            Player a = game.getPlayer(alice.me.iterator().next().getId());
            Player b = game.getPlayer(bob.me.iterator().next().getId());

            Rewind.Option target = rewind.options().get(rewind.options().size() - 1);
            Assert.assertNull(rewind.request(a, target.point()));
            ObjectNode bobSees = rewind.json(JSON, b);
            Assert.assertTrue(bobSees.path("pending").path("needsMe").asBoolean(), bobSees.toString());
            Assert.assertEquals(bobSees.path("pending").path("by").asText(), "Alice");
            Assert.assertFalse(rewind.json(JSON, a).path("pending").path("needsMe").asBoolean(), "Alice doesn't vote");
            Assert.assertNotNull(rewind.request(b, target.point()), "one request at a time");
            Assert.assertNotNull(rewind.vote(a, true), "the asker doesn't vote");
            Assert.assertNull(rewind.vote(b, false));
            Assert.assertTrue(rewind.json(JSON, a).path("pending").isMissingNode(), "declined: no request left");
            Assert.assertTrue(rewind.json(JSON, a).path("note").asText().contains("Bob declined"));

            int before = session.view().getTurn();
            Rewind.Option again = rewind.options().stream().filter(o -> o.level() == 3).reduce((x, y) -> y)
                    .orElse(rewind.options().get(0));
            Assert.assertNull(rewind.request(a, again.point()));
            Assert.assertNull(rewind.vote(b, true));
            waitFor("the rewind", () -> game.getGameLog().getAllEntries().stream()
                    .anyMatch(e -> e.message().startsWith("Rewound to") && e.message().contains("asked by Alice")));
            Assert.assertTrue(session.view().getTurn() <= before + 1, "no runaway: turn " + session.view().getTurn());
        } finally {
            stop.set(true);
            session.abort();
            for (Thread t : drivers) {
                t.join(5_000);
            }
        }
    }

    /** A player who passes every prompt. */
    private static Thread passer(GameSession session, String name, GameSessionTest.ScriptedBrowser b, AtomicBoolean stop) {
        int[] landTurn = {-1};
        Thread t = new Thread(() -> {
            try {
                while (!stop.get()) {
                    Object[] prompt = b.buttonPrompts.poll(200, TimeUnit.MILLISECONDS);
                    if (prompt == null || b.me == null || !b.me.contains((PlayerView) prompt[0])) {
                        continue;
                    }
                    PlayerView me = (PlayerView) prompt[0];
                    IGameController ctl = session.controller(name, me);
                    GameView gv = session.view();
                    if (ctl == null || gv == null) {
                        continue;
                    }
                    Thread.sleep(20);
                    // a land a turn, so nobody has to discard at cleanup (which needs a card picked, not OK)
                    CardView land = null;
                    if (me.equals(gv.getPlayerTurn()) && gv.getPhase() == PhaseType.MAIN1 && landTurn[0] != gv.getTurn()
                            && me.getHand() != null) {
                        for (CardView c : me.getHand()) {
                            if (c.getCurrentState().getType().isLand()) {
                                land = c;
                                break;
                            }
                        }
                    }
                    if (land != null) {
                        landTurn[0] = gv.getTurn();
                        CardView play = land;
                        FThreads.invokeInEdtLater(() -> ctl.selectCard(play, null, null));
                    } else {
                        FThreads.invokeInEdtLater(ctl::selectButtonOk);
                    }
                }
            } catch (InterruptedException ignored) {
                // done
            }
        }, "passer-" + name);
        t.setDaemon(true);
        return t;
    }
}
