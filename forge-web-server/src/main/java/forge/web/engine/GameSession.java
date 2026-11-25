package forge.web.engine;

import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.GameView;
import forge.game.event.GameEvent;
import forge.game.event.GameEventPlayerPriority;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.player.RegisteredPlayer;
import com.google.common.eventbus.Subscribe;
import forge.gamemodes.match.DrawOfferCoordinator;
import forge.gamemodes.match.HostedMatch;
import forge.gamemodes.net.IRemote;
import forge.gamemodes.net.ProtocolGuiGame;
import forge.gui.interfaces.IGuiGame;
import forge.interfaces.IGameController;
import forge.player.GamePlayerUtil;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * One live Commander game on the server. Human seats run Forge's own human controller
 * (PlayerControllerHuman); everything it shows or asks goes through that seat's {@link IRemote}
 * (in production, the player's WebSocket). Other seats are Forge AI.
 */
public final class GameSession {

    /** A seat. {@code remote} is null for an AI seat. */
    /** A seat. {@code remote} is null for an AI seat. {@code tokenArt}: the deck's token art, identity -> Scryfall id. */
    public record Seat(String name, Deck deck, IRemote remote, Map<String, String> tokenArt) {
        public Seat(String name, Deck deck, IRemote remote) {
            this(name, deck, remote, Map.of());
        }

        public Seat {
            Objects.requireNonNull(name);
            Objects.requireNonNull(deck);
        }

        public boolean human() {
            return remote != null;
        }
    }

    private final HostedMatch match = new HostedMatch();
    private final Map<String, ProtocolGuiGame> guis = new LinkedHashMap<>();
    /** Each player's token art (by player name, which is the seat name). */
    private final Map<String, Map<String, String>> tokenArt = new java.util.concurrent.ConcurrentHashMap<>();

    /** Where a finished game's replay goes ({@code users}: the signed-in user of each human seat). */
    public interface ReplaySink {
        void finished(Recording replay, java.util.Collection<String> users);
    }

    /**
     * How the game is set up beyond its seats. {@code rewindLevel}: how far back players may ask
     * to rewind ({@link Rewind}), 0 for never. {@code replays}: record the game and hand it there
     * when it's over (null: don't record). {@code users}: seat name -> signed-in user, for replays.
     */
    public record Options(int rewindLevel, ReplaySink replays, Map<String, String> users) {
        public Options {
            rewindLevel = Math.max(0, Math.min(Rewind.MAX_LEVEL, rewindLevel));
            users = users == null ? Map.of() : Map.copyOf(users);
        }
    }

    private final Options options;
    private volatile Rewind rewind;
    private volatile Recording recording;
    private final List<BrowserSeat> browsers = new ArrayList<>();

    private GameSession(Options options) {
        this.options = options;
    }

    /** Starts a Commander game with rewinding off and no replay. */
    public static GameSession startCommander(List<Seat> seats) {
        return startCommander(seats, new Options(0, null, null));
    }

    /** Starts a Commander game with no replay. */
    public static GameSession startCommander(List<Seat> seats, int rewindLevel) {
        return startCommander(seats, new Options(rewindLevel, null, null));
    }

    /** Starts a Commander game. Each seat's deck needs its commander in the Commander section. */
    public static GameSession startCommander(List<Seat> seats, Options options) {
        if (seats.size() < 2 || seats.size() > 8) {
            throw new IllegalArgumentException("A game needs 2 to 8 seats");
        }
        ForgeEngine.start();
        GameSession s = new GameSession(options);
        List<RegisteredPlayer> players = new ArrayList<>();
        Map<RegisteredPlayer, IGuiGame> guiMap = new LinkedHashMap<>();
        for (Seat seat : seats) {
            if (seat.tokenArt() != null && !seat.tokenArt().isEmpty()) {
                s.tokenArt.put(seat.name(), Map.copyOf(seat.tokenArt()));
            }
        }
        for (Seat seat : seats) {
            RegisteredPlayer rp = RegisteredPlayer.forCommander(seat.deck());
            if (seat.human()) {
                rp.setPlayer(new WebLobbyPlayer(seat.name(), seat.remote() instanceof BrowserSeat b ? b : null));
                ProtocolGuiGame gui = new ProtocolGuiGame(seat.remote()) {
                    @Override
                    public void openView(forge.trackable.TrackableCollection<PlayerView> myPlayers) {
                        s.gameCreated(); // before the game thread starts: nothing has happened yet
                        super.openView(myPlayers);
                    }
                };
                gui.setNetGame();
                if (seat.remote() instanceof BrowserSeat browser) {
                    browser.attach(gui, s.tokenArt, s::game);
                    browser.setRewind(s::rewind);
                    browser.setComboRunning(s::comboRunning);
                    browser.combos().setTable(s.aroundCombos());
                    s.browsers.add(browser);
                }
                guiMap.put(rp, gui);
                s.guis.put(seat.name(), gui);
            } else {
                rp.setPlayer(GamePlayerUtil.createAiPlayer(seat.name()));
            }
            players.add(rp);
        }
        GameRules rules = new GameRules(GameType.Commander);
        rules.setAppliedVariants(EnumSet.of(GameType.Commander));
        rules.setGamesPerMatch(1);
        // Forge would list the AI decks' cards it plays badly to every player: that's the AI's
        // decklist, which the other players mustn't see.
        rules.setWarnAboutAICards(false);
        s.match.startMatch(rules, EnumSet.of(GameType.Commander), players, guiMap, null);
        return s;
    }

    /** Hooks rewinding and recording into the game Forge just created (once). */
    private synchronized void gameCreated() {
        Game g = match.getGame();
        if (g == null || hooked) {
            return;
        }
        hooked = true;
        g.subscribeToEvents(new Object() {
            // AllowConcurrentEvents: as in Rewind.onEvent, a game ended from another thread (abort: setGameOver holds the
            // game's lock while it fires events) would otherwise deadlock with the game thread, in here waiting for
            // that lock (isGameOver). Nothing here needs the subscriber's lock: `ending` is volatile and the end itself
            // goes through the game's action queue, which checks again.
            @Subscribe
            @com.google.common.eventbus.AllowConcurrentEvents
            public void on(GameEvent ev) {
                if (ev instanceof GameEventPlayerPriority) {
                    takeConcessions(g); // before Rewind, which subscribes later, sees this event
                }
                endIfNoHumansLeft(g);
                if (isOver(g)) {
                    fireOver();
                }
            }
        });
        if (options.replays() != null) {
            Recording rec = new Recording(g, new com.fasterxml.jackson.databind.ObjectMapper(), tokenArt);
            ReplaySink sink = options.replays();
            rec.onFinish(r -> sink.finished(r, options.users().values()));
            g.subscribeToEvents(rec);
            recording = rec;
        }
        if (options.rewindLevel() > 0) {
            Rewind r = new Rewind(g, options.rewindLevel());
            r.onChange(() -> browsers.forEach(BrowserSeat::refresh));
            g.subscribeToEvents(r);
            rewind = r;
        }
    }

    /** Someone is running a combo. */
    private boolean comboRunning() {
        for (BrowserSeat b : browsers) {
            if (b.combos().running()) {
                return true;
            }
        }
        return false;
    }

    /** A whole combo run is one step back for rewinding, and few frames of the recording. */
    private Combos.Table aroundCombos() {
        return new Combos.Table() {
            @Override
            public void started() {
                hold(true);
            }

            @Override
            public void ended() {
                hold(comboRunning());
                browsers.forEach(BrowserSeat::refresh);
            }

            @Override
            public int rewinds() {
                Rewind r = rewind;
                return r == null ? 0 : r.activity();
            }

            private void hold(boolean on) {
                if (rewind != null) {
                    rewind.hold(on);
                }
                if (recording != null) {
                    recording.hold(on);
                }
            }
        };
    }

    private boolean hooked;
    private volatile boolean ending;

    /**
     * Has this game ended? Forge's own {@code isGameOver()} takes the game's lock, which Forge holds
     * while it ends a game and fires the events for that. Anything that runs because of an event
     * (sending a seat the state, for one) holds that event's lock, so asking Forge there can deadlock
     * with a game ended from another thread (an abort, say), and every other game may need that thread.
     */
    static boolean isOver(Game g) {
        return g.getAge() == GameStage.GameOver;
    }

    /** Takes everyone who has conceded out of the game (game thread, someone is about to get priority). */
    private static void takeConcessions(Game g) {
        List<WebPlayerController> people = new ArrayList<>();
        boolean any = false;
        for (Player p : g.getRegisteredPlayers()) {
            WebPlayerController c = p.getLobbyPlayer() instanceof WebLobbyPlayer w ? w.controller() : null;
            if (c == null || c.getGame() != g) {
                continue;
            }
            people.add(c);
            if (c.concessionDue()) {
                p.concede();
                any = true;
            }
        }
        if (any) {
            g.getAction().checkGameOverCondition();
            people.forEach(WebPlayerController::askAgain);
        }
    }

    /**
     * Once every human seat has lost (conceded, or lost in a game still going on), the game ends,
     * as Forge's own client does: AI playing on alone would only keep a game slot busy, and the
     * player waits for a game that is over for them.
     */
    private void endIfNoHumansLeft(Game g) {
        if (ending || isOver(g)) {
            return;
        }
        boolean anyHuman = false;
        for (Player p : g.getRegisteredPlayers()) {
            if (p.getLobbyPlayer() instanceof WebLobbyPlayer) {
                anyHuman = true;
                if (!p.hasLost()) {
                    return;
                }
            }
        }
        if (!anyHuman) {
            return;
        }
        ending = true;
        g.getAction().invoke(() -> {
            if (!g.isGameOver()) {
                g.setGameOver(GameEndReason.AllHumansLost);
                DrawOfferCoordinator.releaseInputQueues(g);
            }
        });
    }

    private final List<Runnable> overListeners = new java.util.concurrent.CopyOnWriteArrayList<>();
    private final java.util.concurrent.atomic.AtomicBoolean over = new java.util.concurrent.atomic.AtomicBoolean();

    /** Runs {@code r} once, when the game ends (or is aborted). At once if it already has. */
    public void onOver(Runnable r) {
        overListeners.add(r);
        if (over.get() && overListeners.remove(r)) {
            r.run();
        }
    }

    private void fireOver() {
        if (over.compareAndSet(false, true)) {
            for (Runnable r : overListeners) {
                if (overListeners.remove(r)) {
                    try {
                        r.run();
                    } catch (RuntimeException e) {
                        org.tinylog.Logger.warn(e, "A game-over listener failed");
                    }
                }
            }
        }
    }

    /** This game's recording, or null when it isn't recorded. */
    public Recording recording() {
        return recording;
    }

    /** Rewinding in this game, or null when it's off. */
    public Rewind rewind() {
        return rewind;
    }

    /** The live game, or null once it has ended. Read it on the game or forge-ui thread. */
    public Game game() {
        return match.getGame();
    }

    public GameView view() {
        return match.getGameView();
    }

    /** The GUI bridge for a human seat, or null. */
    public ProtocolGuiGame gui(String seatName) {
        return guis.get(seatName);
    }

    /** Where a human seat's answers go (select a card, OK/Cancel, pass priority, concede...). */
    public IGameController controller(String seatName, PlayerView player) {
        ProtocolGuiGame gui = guis.get(seatName);
        return gui == null ? null : gui.getGameController(player);
    }

    public boolean isOver() {
        GameView v = view();
        return v == null || v.isGameOver();
    }

    /** Ends the game now (e.g. everyone left), even if AI seats are still playing. */
    public void abort() {
        Game game = match.getGame();
        if (game != null && !game.isGameOver()) {
            game.setGameOver(GameEndReason.Draw);
        }
        fireOver();
    }
}
