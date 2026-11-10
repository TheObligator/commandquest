package forge.web.engine;

import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.phase.PhaseType;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbilityView;
import forge.gamemodes.net.IRemote;
import forge.gamemodes.net.event.GuiGameEvent;
import forge.gamemodes.net.event.IdentifiableNetEvent;
import forge.gamemodes.net.event.NetEvent;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.trackable.TrackableCollection;
import forge.util.MyRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/**
 * A real four-player Commander game: one human seat driven like a browser would (through
 * {@link IRemote} and {@link IGameController}), three Forge AI seats.
 */
public class GameSessionTest {

    /** Stands in for the browser: records prompts, answers blocking questions with defaults. */
    static final class ScriptedBrowser implements IRemote {
        final BlockingQueue<Object[]> buttonPrompts = new LinkedBlockingQueue<>();
        final List<String> asked = new ArrayList<>();
        volatile TrackableCollection<PlayerView> me;

        @Override
        @SuppressWarnings("unchecked")
        public void send(NetEvent event) {
            GuiGameEvent ev = (GuiGameEvent) event;
            switch (ev.getMethod()) {
                case openView -> me = (TrackableCollection<PlayerView>) ev.getObjects()[0];
                case updateButtons -> buttonPrompts.offer(ev.getObjects());
                default -> { }
            }
        }

        @Override
        @SuppressWarnings("unchecked")
        public Object sendAndWait(IdentifiableNetEvent event) {
            GuiGameEvent ev = (GuiGameEvent) event;
            Object[] a = ev.getObjects();
            synchronized (asked) {
                asked.add(ev.getMethod().name());
            }
            return switch (ev.getMethod()) {
                case getAbilityToPlay -> ((List<SpellAbilityView>) a[1]).get(0);
                case getChoices -> {
                    List<?> choices = (List<?>) a[3];
                    int min = (Integer) a[1];
                    yield new ArrayList<>(choices.subList(0, Math.min(choices.size(), Math.max(min, 1))));
                }
                case confirm -> a[2];
                case showConfirmDialog -> a[4];
                case showOptionDialog -> a[4];
                case showInputDialog -> a[3];
                default -> null;
            };
        }
    }

    private static Deck commanderDeck(String commander, String basic) {
        Deck d = new Deck(commander);
        d.getOrCreate(DeckSection.Commander).add(commander, 1);
        d.getMain().add(basic, 99);
        return d;
    }

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    @Test(timeOut = 240_000)
    public void humanSeatPlaysAgainstThreeAi() throws Exception {
        MyRandom.setRandom(new Random(11));
        ScriptedBrowser browser = new ScriptedBrowser();
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", commanderDeck("Isamaru, Hound of Konda", "Plains"), browser),
                new GameSession.Seat("AI 1", commanderDeck("Krenko, Mob Boss", "Mountain"), null),
                new GameSession.Seat("AI 2", commanderDeck("Ezuri, Renegade Leader", "Forest"), null),
                new GameSession.Seat("AI 3", commanderDeck("Talrand, Sky Summoner", "Island"), null)));
        try {
            int landsPlayed = 0;
            int lastLandTurn = -1;
            long deadline = System.currentTimeMillis() + 180_000;
            while (System.currentTimeMillis() < deadline) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                GameView gv = session.view();
                if (gv == null || gv.isGameOver()) {
                    break;
                }
                if (prompt == null || browser.me == null || !browser.me.contains((PlayerView) prompt[0])) {
                    continue;
                }
                PlayerView owner = (PlayerView) prompt[0];
                IGameController controller = session.controller("You", owner);
                boolean myMain = owner.equals(gv.getPlayerTurn()) && gv.getPhase() == PhaseType.MAIN1;
                CardView land = null;
                if (myMain && lastLandTurn != gv.getTurn() && owner.getHand() != null) {
                    for (CardView c : owner.getHand()) {
                        if (c.getCurrentState().getType().isLand()) {
                            land = c;
                            break;
                        }
                    }
                }
                if (land != null) {
                    CardView toPlay = land;
                    lastLandTurn = gv.getTurn();
                    landsPlayed++;
                    FThreads.invokeInEdtLater(() -> controller.selectCard(toPlay, null, null));
                } else if (landsPlayed >= 2 && gv.getTurn() >= 9) {
                    break;
                } else {
                    FThreads.invokeInEdtLater(controller::selectButtonOk); // keep / pass priority
                }
            }

            GameView gv = session.view();
            Assert.assertNotNull(browser.me, "the human seat got its view");
            PlayerView me = browser.me.iterator().next();
            Assert.assertEquals(gv.getPlayers().size(), 4, "four players");
            Assert.assertTrue(gv.getTurn() >= 9, "the game advanced through several turns, at turn " + gv.getTurn());
            Assert.assertTrue(landsPlayed >= 2, "the human played lands: " + landsPlayed);
            Assert.assertTrue(me.getBattlefield() != null && me.getBattlefield().size() >= 2, "lands reached the battlefield");
            Assert.assertTrue(me.getLife() > 0 && me.getLife() <= 40, "Commander life total: " + me.getLife());
        } finally {
            session.abort();
        }
        long end = System.currentTimeMillis() + 30_000;
        while (!session.isOver() && System.currentTimeMillis() < end) {
            Thread.sleep(100);
        }
        Assert.assertTrue(session.isOver(), "abort ended the game");
    }
}
