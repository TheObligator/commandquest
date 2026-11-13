package forge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameLogEntryType;
import forge.game.card.Card;
import forge.game.card.CounterType;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.gamemodes.match.input.InputPassPriority;
import forge.player.AutoYieldStore.TriggerDecision;
import forge.player.PlayerControllerHuman;
import forge.gamemodes.match.YieldUpdate;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.web.engine.AutoPass;
import forge.web.engine.BrowserSeat;
import forge.web.engine.Decks;
import forge.web.engine.Explain;
import forge.web.engine.ManualActions;
import forge.web.engine.AutoPay;
import forge.web.engine.ManaTaps;
import forge.web.engine.Payment;
import forge.web.engine.Rewind;
import forge.web.engine.ForgeEngine;
import forge.web.engine.GameSession;
import io.javalin.websocket.WsContext;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.tinylog.Logger;

/**
 * The game socket ({@code /ws}). Each browser signs in with its Convex token, then starts a game
 * against Forge AI and plays it: the protocol is in docs/game-protocol.md. One game per user;
 * starting another ends the old one. A game belongs to its player, not to the socket: if the
 * socket closes, the game waits {@link #reconnectGrace} for that player to sign in again (a
 * reloaded tab, a dropped connection), then ends. Signing in from another tab takes the game over.
 */
public final class GameHub {

    /** Simultaneous games on this server (each runs AI on the Mac's CPU). */
    private final int maxGames;
    private final ConvexAuth auth;
    private final ObjectMapper json = new ObjectMapper();
    private final Map<String, Conn> conns = new ConcurrentHashMap<>();
    /** Each user's game, by user id. */
    private final Map<String, Hosted> games = new ConcurrentHashMap<>();
    /** How long a game waits for its player after their socket closes. */
    private volatile Duration reconnectGrace = Duration.ofMinutes(5);
    private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "game-expiry");
        t.setDaemon(true);
        return t;
    });
    /** Engine start and game setup are slow; keep them off Jetty's threads. */
    private final ExecutorService work = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "game-setup");
        t.setDaemon(true);
        return t;
    });

    private static final class Conn {
        final WsContext ws;
        volatile String user;
        /** The game this socket is playing, if any. */
        volatile Hosted game;

        Conn(WsContext ws) {
            this.ws = ws;
        }
    }

    /** Where finished games' replays go; null: games aren't recorded. */
    private final GameSession.ReplaySink replays;

    /** A user's game, and the socket it's currently shown on (null while they're away). */
    private static final class Hosted {
        final String user;
        final String seatName;
        volatile BrowserSeat seat;
        volatile GameSession session;
        volatile Conn conn;
        volatile ScheduledFuture<?> expiry;
        /** The last auto-pass mode the player set, for a reconnecting browser. */
        volatile String autoPass;

        Hosted(String user, String seatName, Conn conn) {
            this.user = user;
            this.seatName = seatName;
            this.conn = conn;
        }

        boolean running() {
            GameSession s = session;
            return s != null && !s.isOver();
        }
    }

    public GameHub(ConvexAuth auth, int maxGames) {
        this(auth, maxGames, null);
    }

    public GameHub(ConvexAuth auth, int maxGames, GameSession.ReplaySink replays) {
        this.auth = auth;
        this.maxGames = maxGames;
        this.replays = replays;
    }

    public void onConnect(WsContext ws) {
        conns.put(ws.sessionId(), new Conn(ws));
    }

    /** How long a game waits for its player to come back (tests shorten it). */
    void setReconnectGrace(Duration grace) {
        this.reconnectGrace = grace;
    }

    public void onClose(WsContext ws) {
        Conn c = conns.remove(ws.sessionId());
        Hosted h = c == null ? null : c.game;
        if (h == null) {
            return;
        }
        synchronized (h) {
            if (h.conn != c) {
                return;
            }
            if (h.running()) {
                // Keep the game for a while: the player may be reloading the page or reconnecting.
                h.conn = null;
                h.expiry = timers.schedule(() -> {
                    if (h.conn == null) {
                        Logger.info("Game for {} ended: they didn't come back", h.user);
                        endGame(h);
                    }
                }, reconnectGrace.toMillis(), TimeUnit.MILLISECONDS);
                Logger.info("Game for {} is waiting for them to reconnect", h.user);
                return;
            }
        }
        endGame(h);
    }

    public void onMessage(WsContext ws, String text) {
        Conn c = conns.get(ws.sessionId());
        if (c == null) {
            return;
        }
        JsonNode m;
        try {
            m = json.readTree(text);
        } catch (Exception e) {
            error(c, "Bad message");
            return;
        }
        String t = m.path("t").asText();
        if (t.equals("ping")) {
            send(c, msg("pong"));
            return;
        }
        if (t.equals("hello")) {
            hello(c, m.path("token").asText(null));
            return;
        }
        if (c.user == null) {
            error(c, "Sign in first");
            return;
        }
        switch (t) {
            case "start" -> start(c, m);
            case "ok" -> act(c, ctl -> ok(c, ctl));
            case "cancel" -> act(c, IGameController::selectButtonCancel);
            case "concede" -> {
                BrowserSeat seat = seat(c);
                if (seat != null) {
                    seat.answerOpenWithDefaults(); // Forge can't take the concession while it waits on a question
                }
                rewindLeft(c);
                act(c, IGameController::concede);
            }
            case "card" -> {
                int id = m.path("id").asInt();
                act(c, ctl -> click(c, ctl, id, null, null));
            }
            case "actions" -> {
                int id = m.path("id").asInt();
                act(c, ctl -> actions(c, ctl, id));
            }
            case "ability" -> {
                int id = m.path("id").asInt();
                int ability = m.path("ability").asInt();
                String label = m.path("label").asText(null);
                act(c, ctl -> click(c, ctl, id, ability, label));
            }
            case "player" -> {
                int id = m.path("id").asInt();
                act(c, ctl -> {
                    Player p = game(c) == null ? null : game(c).getPlayer(id);
                    if (p != null) {
                        ctl.selectPlayer(p.getView(), null);
                    }
                });
            }
            case "answer" -> {
                BrowserSeat seat = seat(c);
                if (seat != null) {
                    seat.answer(m.path("id").asInt(), m.path("choice"), m.path("text").asText(null));
                }
            }
            case "stops" -> stops(c, m.path("stops"));
            case "yield" -> yieldTo(c, m.path("key").asText(""), m.path("autoYield"), m.path("decision").asText(null));
            case "manual" -> manual(c, m);
            case "payFree" -> payFree(c);
            case "manaOptions" -> manaOptions(c, m.path("ids"));
            case "tapForMana" -> tapForMana(c, m.path("picks"));
            case "payPool" -> payPool(c, m.path("color").asText(""));
            case "library" -> library(c, m);
            case "libraryCards" -> libraryCards(c, m.path("top").asInt(0), m.path("log").asBoolean(false), m.path("owner").asInt(-1));
            case "letSearch" -> letSearch(c, m.path("to").asInt(-1), true);
            case "endSearch" -> letSearch(c, m.path("owner").asInt(-1), false);
            case "details" -> details(c, m.path("id").asInt());
            case "counter" -> counter(c, m.path("id").asInt(), m.path("type").asText(""), m.path("delta").asInt());
            case "yieldsOff" -> act(c, ctl -> {
                ctl.setDisableAutoYields(m.path("off").asBoolean());
                BrowserSeat seat = seat(c);
                if (seat != null) {
                    seat.refresh();
                }
            });
            case "autopass" -> autoPass(c, m.path("mode").asText(null));
            case "rewind" -> rewind(c, m);
            default -> error(c, "Unknown message: " + t);
        }
    }

    private void hello(Conn c, String token) {
        work.execute(() -> {
            try {
                String user = auth.verify(token);
                c.user = user;
                Hosted h = games.get(user);
                boolean resume = h != null && h.running() && h.seat != null;
                ObjectNode hello = msg("hello");
                hello.put("game", resume);
                if (resume) {
                    hello.put("autoPass", h.autoPass);
                }
                send(c, hello);
                if (resume) {
                    resume(c, h);
                }
            } catch (Exception e) {
                Logger.info("Sign-in refused: {}", e.getMessage());
                error(c, "Sign-in failed: " + e.getMessage());
                c.ws.closeSession(4401, "sign-in failed");
            }
        });
    }

    /** Shows the player's game on this socket (a reload, a reconnect, or another tab taking it over). */
    private void resume(Conn c, Hosted h) {
        Conn old;
        synchronized (h) {
            ScheduledFuture<?> expiry = h.expiry;
            if (expiry != null) {
                expiry.cancel(false);
                h.expiry = null;
            }
            old = h.conn;
            h.conn = c;
            c.game = h;
        }
        if (old != null && old != c) {
            old.game = null;
            send(old, msg("moved"));
        }
        Logger.info("{} is back in their game", h.user);
        FThreads.invokeInEdtLater(h.seat::replay); // reads the game view, like every other action
    }

    /** Games that haven't ended, including ones waiting for their player to reconnect. */
    public long activeGames() {
        return games.values().stream().filter(Hosted::running).count();
    }

    private void start(Conn c, JsonNode m) {
        Hosted previous = games.get(c.user); // one game per user, even across tabs
        if (previous != null) {
            Conn other = previous.conn;
            endGame(previous);
            if (other != null && other != c) {
                send(other, msg("replaced"));
            }
        }
        long running = games.values().stream().filter(Hosted::running).count();
        if (running >= maxGames) {
            error(c, "The game server is full right now. Try again in a few minutes.");
            return;
        }
        int opponents = Math.max(1, Math.min(3, m.path("opponents").asInt(3)));
        work.execute(() -> {
            try {
                ForgeEngine.start();
                Deck mine = Decks.fromJson(m.path("deck"));
                List<GameSession.Seat> seats = new ArrayList<>();
                int rewindLevel = m.path("rewind").asInt(0);
                String name = m.path("name").asText("You").trim();
                name = name.isEmpty() || name.length() > 40 || name.startsWith("AI ") ? "You" : name;
                Hosted h = new Hosted(c.user, name, c);
                // Messages go to whichever socket shows the game now (none while the player is away).
                BrowserSeat seat = new BrowserSeat(json, s -> {
                    Conn to = h.conn;
                    if (to != null) {
                        sendRaw(to, s);
                    }
                });
                seat.setFreePlay(m.path("freePlay").asBoolean(true));
                h.seat = seat;
                seats.add(new GameSession.Seat(name, mine, seat, tokenArt(m.path("deck").path("tokens"))));
                List<Deck> ai = Decks.randomPrecons(opponents);
                for (int i = 0; i < ai.size(); i++) {
                    seats.add(new GameSession.Seat("AI " + (i + 1), ai.get(i), null));
                }
                games.put(c.user, h);
                c.game = h;
                h.session = GameSession.startCommander(seats,
                        new GameSession.Options(rewindLevel, replays, Map.of(name, c.user)));
                Logger.info("Game started for {} ({} AI)", c.user, ai.size());
            } catch (IllegalArgumentException e) {
                error(c, e.getMessage());
            } catch (RuntimeException e) {
                Logger.error(e, "Couldn't start a game");
                error(c, "Couldn't start the game: " + e.getMessage());
            }
        });
    }

    private static final java.util.regex.Pattern SCRYFALL_ID =
            java.util.regex.Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    /** The deck's token art from the browser: identity -> Scryfall id (checked, at most 200). */
    private static Map<String, String> tokenArt(JsonNode tokens) {
        Map<String, String> art = new java.util.HashMap<>();
        if (tokens.isObject()) {
            tokens.fields().forEachRemaining(e -> {
                String id = e.getValue().asText("");
                if (art.size() < 200 && e.getKey().length() <= 120 && e.getKey().contains("|") && SCRYFALL_ID.matcher(id).matches()) {
                    art.put(e.getKey(), id);
                }
            });
        }
        return art;
    }

    /** Runs a player action on Forge's UI thread, where its input handling expects it. */
    private void act(Conn c, java.util.function.Consumer<IGameController> action) {
        IGameController ctl = controller(c);
        if (ctl == null) {
            return;
        }
        FThreads.invokeInEdtLater(() -> {
            try {
                action.accept(ctl);
            } catch (RuntimeException e) {
                Logger.warn(e, "Player action failed");
            }
        });
    }

    /**
     * Clicks a card for this player (Forge decides what that does). {@code ability}: the one picked
     * from the card's menu, which answers Forge's "which ability?" if it asks. If the click does
     * nothing, the browser gets a {@code notice} saying why.
     */
    private void click(Conn c, IGameController ctl, int id, Integer ability, String label) {
        Game g = game(c);
        BrowserSeat seat = seat(c);
        Card card = g == null ? null : g.findById(id);
        if (card == null || seat == null) {
            return;
        }
        Player who = seat.player() == null ? null : g.getPlayer(seat.player().getId());
        if (who != null && priorityInput(ctl) && noTargets(card, who, ability, label)) {
            notice(c, "Nothing it can target right now.");
            return;
        }
        boolean used;
        seat.prefer(ability, label);
        try {
            used = ctl.selectCard(card.getView(), null, null);
        } finally {
            seat.prefer(null, null);
        }
        Player me = seat.player() == null ? null : g.getPlayer(seat.player().getId());
        if (!used && me != null) {
            ObjectNode o = msg("notice");
            o.put("message", Explain.whyNot(g, me, card, priorityInput(ctl)));
            send(c, o);
        }
    }

    /**
     * Would this click start only things that need a target when there's none? ({@code ability}:
     * the one picked from the card's menu, else everything the card can do now.)
     */
    private static boolean noTargets(Card card, Player me, Integer ability, String label) {
        List<SpellAbility> options = new ArrayList<>();
        for (SpellAbility sa : card.getAllPossibleAbilities(me, true)) {
            if (sa.isManaAbility()) {
                continue;
            }
            if (ability == null || sa.getId() == ability || (label != null && label.equals(sa.getView().getDescription()))) {
                options.add(sa);
            }
        }
        return !options.isEmpty() && options.stream().noneMatch(sa -> Explain.hasTargets(sa, me));
    }

    /** The card's abilities for its menu: everything Forge lists for this player, and whether each can be used now. */
    private void actions(Conn c, IGameController ctl, int id) {
        Game g = game(c);
        BrowserSeat seat = seat(c);
        Card card = g == null ? null : g.findById(id);
        Player me = card == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
        ObjectNode o = msg("actions");
        o.put("id", id);
        ArrayNode list = o.putArray("actions");
        if (me != null) {
            boolean canAct = priorityInput(ctl) && g.getPhaseHandler().getPriorityPlayer() == me;
            // By id, and by text for abilities Forge rebuilds on each listing (alternative costs).
            Set<Integer> playable = new HashSet<>();
            boolean noTargets = false;
            Set<String> playableText = new HashSet<>();
            if (canAct) {
                for (SpellAbility sa : card.getAllPossibleAbilities(me, true)) {
                    if (!Explain.hasTargets(sa, me)) {
                        noTargets = true;
                        continue;
                    }
                    playable.add(sa.getId());
                    playableText.add(sa.getView().getDescription());
                }
            }
            Set<String> seen = new HashSet<>();
            for (SpellAbility sa : card.getAllPossibleAbilities(me, false)) {
                String label = sa.getView().getDescription();
                if (label == null || label.isBlank() || !seen.add(label)) {
                    continue;
                }
                ObjectNode a = list.addObject();
                a.put("ability", sa.getId());
                a.put("label", label);
                a.put("enabled", playable.contains(sa.getId()) || playableText.contains(label));
            }
            if (playable.isEmpty()) {
                o.put("reason", noTargets ? "Nothing it can target right now." : Explain.whyNot(g, me, card, priorityInput(ctl)));
            }
        }
        send(c, o);
    }

    /**
     * Auto-yield to an ability (Forge's yield key: this ability of this card), and for an optional
     * trigger, always answer yes (ACCEPT), no (DECLINE) or ask (ASK).
     */
    private void yieldTo(Conn c, String key, JsonNode autoYield, String decision) {
        if (key.isEmpty() || key.length() > 500) {
            return;
        }
        act(c, ctl -> {
            boolean scope = ctl.getYieldController().isAbilityScope();
            if (autoYield.isBoolean()) {
                ctl.setShouldAutoYield(key, autoYield.asBoolean(), scope);
            }
            if (decision != null) {
                try {
                    ctl.setTriggerDecision(key, TriggerDecision.valueOf(decision), scope);
                } catch (IllegalArgumentException e) {
                    return;
                }
            }
            BrowserSeat seat = seat(c);
            if (seat != null) {
                seat.refresh();
            }
        });
    }

    /**
     * A manual override from a card's menu (docs/game-protocol.md, {@code manual}): tap, turn
     * face down, move to a zone, token copy, reveal... Only your own cards.
     */
    private void manual(Conn c, JsonNode m) {
        if (!freePlay(c)) {
            return;
        }
        int id = m.path("id").asInt();
        String action = m.path("action").asText("");
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Card card = g == null ? null : g.findById(id);
            if (card == null || seat == null || seat.player() == null) {
                return;
            }
            Player me = g.getPlayer(seat.player().getId());
            // Searching someone's library they let you search: you may exile cards from it, face down
            // so only you may look at them (they stay in that player's exile), or face up.
            boolean searcher = card.isInZone(forge.game.zone.ZoneType.Library) && card.getOwner() != me && seat.maySearch(card.getOwner().getId())
                    && (action.equals("exileFaceDown") || action.equals("toExile"));
            if (!searcher && !ManualActions.allowed(card, me, action)) {
                notice(c, "You can only do that to your own cards.");
                return;
            }
            if (searcher && action.equals("exileFaceDown")) {
                if (!seat.manual().run(g, me, card, action, List.of(me), seat::refresh)) {
                    notice(c, "That can't be done to this card where it is now.");
                }
                return;
            }
            List<Player> to = new ArrayList<>();
            for (JsonNode p : m.path("to")) {
                Player other = g.getPlayer(p.asInt(-1));
                // You can be one of those who may look at a card you exile face down.
                if (other != null && (other != me || action.equals("exileFaceDown")) && !to.contains(other)) {
                    to.add(other);
                }
            }
            if (!seat.manual().run(g, me, card, action, to, seat::refresh)) {
                notice(c, "That can't be done to this card where it is now.");
            }
        });
    }

    /**
     * A manual action on your own library (docs/game-protocol.md, {@code library}): draw, mill,
     * exile, reveal the top card, shuffle, scry or surveil ({@code top} / {@code away} ids). Free play only.
     */
    private void library(Conn c, JsonNode m) {
        if (!freePlay(c)) {
            return;
        }
        String action = m.path("action").asText("");
        int n = m.path("n").asInt(1);
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Player me = g == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
            if (me == null) {
                return;
            }
            List<Player> to = new ArrayList<>();
            for (JsonNode p : m.path("to")) {
                Player other = g.getPlayer(p.asInt(-1));
                if (other != null && other != me && !to.contains(other)) {
                    to.add(other);
                }
            }
            if (action.equals("scry") || action.equals("surveil")) {
                List<Integer> top = new ArrayList<>();
                List<Integer> away = new ArrayList<>();
                m.path("top").forEach(x -> top.add(x.asInt()));
                m.path("away").forEach(x -> away.add(x.asInt()));
                if (!seat.manual().arrange(g, me, action, top, away, seat::refresh)) {
                    notice(c, "Your library changed: look at the top cards again.");
                }
                return;
            }
            if (!seat.manual().library(g, me, action, n, to, seat::refresh)) {
                notice(c, "That can't be done to your library now.");
            }
        });
    }

    /**
     * Your library's cards, top first, shown only to you: all of them ({@code top} 0, a search)
     * or the top {@code top}. Free play only. {@code log}: note it in the game log (when you open it,
     * not when the list refreshes).
     */
    /**
     * Free play: let another player at the table search your library ({@code on}, {@code id} is
     * theirs), or, from the searcher, end it ({@code id} is the library's owner; then it's shuffled).
     * While it lasts they can list your library and exile cards from it, face down so only they
     * may look at them (in your exile).
     */
    private void letSearch(Conn c, int id, boolean on) {
        if (!freePlay(c)) {
            return;
        }
        Hosted host = c.game;
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Player me = g == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
            Player other = g == null ? null : g.getPlayer(id);
            if (me == null || other == null || other == me) {
                return;
            }
            if (on) {
                Hosted them = games.values().stream()
                        .filter(h -> h.session == host.session && h.seat != null && h.seat.player() != null && h.seat.player().getId() == id)
                        .findFirst().orElse(null);
                if (them == null) {
                    notice(c, other.getName() + " isn't a person at this table, so they can't search it.");
                    return;
                }
                if (them.seat.letSearch(me.getId(), true)) {
                    g.getGameLog().add(GameLogEntryType.INFORMATION, me.getName() + " lets " + other.getName() + " search their library (by hand)");
                    seat.refresh();
                }
            } else if (seat.letSearch(other.getId(), false)) {
                other.shuffle(null);
                g.getGameLog().add(GameLogEntryType.INFORMATION, me.getName() + " finished searching " + other.getName() + "'s library, and it was shuffled (by hand)");
                seat.refresh();
                games.values().stream().filter(h -> h.session == host.session && h.seat != null).forEach(h -> h.seat.refresh());
            }
        });
    }

    private void libraryCards(Conn c, int top, boolean log, int ownerId) {
        if (!freePlay(c)) {
            return;
        }
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Player me = g == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
            if (me == null) {
                return;
            }
            Player owner = me;
            int n = top;
            if (ownerId >= 0 && ownerId != me.getId()) {
                owner = g.getPlayer(ownerId);
                if (owner == null || !seat.maySearch(ownerId)) {
                    notice(c, "You can't search that library now.");
                    return;
                }
                n = 0; // a search: all of it
            }
            List<Card> lib = new ArrayList<>(owner.getCardsIn(forge.game.zone.ZoneType.Library));
            if (n > 0) {
                lib = lib.subList(0, Math.min(n, lib.size()));
            }
            ObjectNode o = msg("libraryCards");
            o.put("top", n);
            o.put("owner", String.valueOf(owner.getId()));
            ArrayNode cards = o.putArray("cards");
            for (Card card : lib) {
                cards.add(seat.revealedCard(card.getView()));
            }
            if (log && owner != me) {
                g.getGameLog().add(GameLogEntryType.INFORMATION, me.getName() + " searched " + owner.getName() + "'s library (by hand)");
                seat.refresh();
            } else if (log) {
                ManualActions.logLook(g, me, n <= 0 ? 0 : lib.size());
                seat.refresh();
            }
            send(c, o);
        });
    }

    /** OK: while you're paying mana it's Auto-pay (our planner, else Forge's); otherwise Forge's OK. */
    private void ok(Conn c, IGameController ctl) {
        BrowserSeat seat = seat(c);
        Game g = game(c);
        if (Payment.input(ctl) != null && seat != null && seat.player() != null && g != null) {
            AutoPay.run(ctl, g.getPlayer(seat.player().getId()), ctl::selectButtonOk);
        } else {
            ctl.selectButtonOk();
        }
    }

    /** Is free play on in this game? If not, tells the browser that manual overrides are off. */
    private boolean freePlay(Conn c) {
        BrowserSeat seat = seat(c);
        if (seat != null && seat.freePlay()) {
            return true;
        }
        notice(c, "Free play is off in this game: only the cards' own effects can do that.");
        return false;
    }

    /**
     * Free play: pay the rest of the mana cost you're paying now with nothing (for a card that
     * should be free but isn't scripted that way). Only from your own browser, so never for AI seats.
     */
    private void payFree(Conn c) {
        if (!freePlay(c)) {
            return;
        }
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Player me = g == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
            if (me != null && !Payment.payFree(ctl, g, me)) {
                notice(c, "There's no mana cost to pay right now.");
            }
        });
    }

    /** Forge's full text for a card as you may see it: rules text with what's changed (counters, granted abilities, commander casts...). */
    private void details(Conn c, int id) {
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Card card = g == null ? null : g.findById(id);
            ObjectNode o = msg("details");
            o.put("id", id);
            if (card != null && seat != null && seat.player() != null) {
                forge.game.card.CardView cv = card.getView();
                PlayerView me = seat.player();
                boolean seen = cv.canBeShownTo(me) && (!cv.isFaceDown() || cv.canFaceDownBeShownTo(me));
                o.put("text", forge.gui.card.CardDetailUtil.composeCardText(cv.getCurrentState(), g.getView(), seen));
                o.put("sick", card.isInPlay() && card.isSick());
                o.put("owner", card.getOwner().getName());
                if (card.isCommander()) {
                    o.put("commanderCasts", card.getOwner().getCommanderCast(card));
                }
            }
            send(c, o);
        });
    }

    /**
     * Rewinding ({@code engine/Rewind}): {@code action} {@code ask} (to {@code point}, one of the view's
     * {@code rewind.options}), {@code yes} / {@code no} (answering someone else's request) or {@code cancel}.
     */
    private void rewind(Conn c, JsonNode m) {
        Hosted h = c.game;
        GameSession s = h == null ? null : h.session;
        BrowserSeat seat = h == null ? null : h.seat;
        Game g = game(c);
        Rewind r = s == null ? null : s.rewind();
        if (r == null || g == null || seat == null || seat.player() == null) {
            notice(c, "Rewinding is off in this game.");
            return;
        }
        Player me = g.getPlayer(seat.player().getId());
        String why = switch (m.path("action").asText("ask")) {
            case "ask" -> r.request(me, m.path("point").asInt(-1), m.path("kind").asText(Rewind.TIMELINE));
            case "yes" -> r.vote(me, true);
            case "no" -> r.vote(me, false);
            case "cancel" -> r.cancel(me);
            case "change" -> {
                List<Integer> ids = new ArrayList<>();
                m.path("cards").forEach(x -> {
                    if (ids.size() < 50) {
                        ids.add(x.asInt(-1));
                    }
                });
                if (m.has("card")) {
                    ids.add(m.path("card").asInt(-1));
                }
                yield r.requestChange(me, ids);
            }
            default -> "Unknown rewind action.";
        };
        if (why != null) {
            notice(c, why);
        }
    }

    /** This player is leaving the game: a rewind request mustn't wait on them. */
    private void rewindLeft(Conn c) {
        Hosted h = c.game;
        GameSession s = h == null ? null : h.session;
        BrowserSeat seat = h == null ? null : h.seat;
        Game g = game(c);
        Rewind r = s == null ? null : s.rewind();
        if (r != null && g != null && seat != null && seat.player() != null) {
            r.playerLeft(g.getPlayer(seat.player().getId()));
        }
    }

    /**
     * May you tap your permanents for mana now: whenever you have priority or are paying a cost (as
     * the rules allow mana abilities), or any time in a free-play game.
     */
    private boolean mayTapForMana(Conn c, IGameController ctl, Game g, Player me) {
        return freePlay(c) || Payment.input(ctl) != null || (priorityInput(ctl) && g.getPhaseHandler().getPriorityPlayer() == me);
    }

    /** The ways each of these cards can be tapped for mana (docs/game-protocol.md, {@code manaOptions}). */
    private void manaOptions(Conn c, JsonNode ids) {
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Player me = g == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
            if (me == null) {
                return;
            }
            List<Card> cards = new ArrayList<>();
            for (JsonNode id : ids) {
                Card card = g.findById(id.asInt(-1));
                if (card != null && cards.size() < 100) {
                    cards.add(card);
                }
            }
            boolean allowed = mayTapForMana(c, ctl, g, me);
            g.getAction().invoke(() -> {
                ObjectNode o = msg("manaOptions");
                ArrayNode list = o.putArray("options");
                if (allowed) {
                    ManaTaps.options(g, me, cards).forEach((id, picks) -> {
                        ObjectNode row = list.addObject();
                        row.put("id", id);
                        ArrayNode ps = row.putArray("picks");
                        for (ManaTaps.Pick p : picks) {
                            ObjectNode po = ps.addObject();
                            po.put("source", p.source());
                            po.put("ability", p.ability());
                            po.put("choice", p.choice());
                            po.put("mana", p.mana());
                            if (p.via() != null) {
                                po.put("via", p.via());
                            }
                            if (p.damage() > 0) {
                                po.put("damage", p.damage());
                            }
                            if (p.life() > 0) {
                                po.put("life", p.life());
                            }
                        }
                    });
                } else {
                    o.put("reason", "You can tap for mana when you have priority or are paying a cost.");
                }
                send(c, o);
            });
        });
    }

    /** Taps cards for mana as picked in the browser (docs/game-protocol.md, {@code tapForMana}). */
    private void tapForMana(Conn c, JsonNode picksJson) {
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Player me = g == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
            if (me == null) {
                return;
            }
            if (!mayTapForMana(c, ctl, g, me)) {
                notice(c, "You can tap for mana when you have priority or are paying a cost.");
                return;
            }
            List<ManaTaps.Pick> picks = new ArrayList<>();
            for (JsonNode p : picksJson) {
                if (picks.size() < 100) {
                    picks.add(new ManaTaps.Pick(p.path("card").asInt(-1), p.path("source").asInt(-1), p.path("ability").asInt(-1),
                            p.path("choice").asText("")));
                }
            }
            g.getAction().invoke(() -> {
                try {
                    if (ManaTaps.tap(g, me, picks) < picks.size()) {
                        notice(c, "Some of those cards couldn't be tapped for mana that way any more.");
                    }
                } finally {
                    seat.refresh();
                }
            });
        });
    }

    /**
     * While paying a cost, use mana from your pool: one of a color ({@code W U B R G C}), or
     * {@code all} for as much as it can pay.
     */
    private void payPool(Conn c, String color) {
        act(c, ctl -> {
            forge.gamemodes.match.input.InputPayMana pay = Payment.input(ctl);
            BrowserSeat seat = seat(c);
            Game g = game(c);
            Player me = g == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
            if (pay == null || me == null) {
                return;
            }
            List<Byte> colors = new ArrayList<>();
            for (byte b : forge.card.mana.ManaAtom.MANATYPES) {
                if (color.equals("all") || forge.card.MagicColor.toShortString(b).equals(color)) {
                    colors.add(b);
                }
            }
            // Colored mana first, so colorless pays generic only once the colors are covered.
            for (int guard = 0; guard < 50 && Payment.input(ctl) == pay; guard++) {
                boolean used = false;
                for (byte b : colors) {
                    if (me.getManaPool().getAmountOfColor(b) > 0 && Payment.input(ctl) == pay) {
                        int before = me.getManaPool().totalMana();
                        pay.useManaFromPool(b);
                        used |= me.getManaPool().totalMana() < before;
                        if (!color.equals("all")) {
                            break;
                        }
                    }
                }
                if (!used || !color.equals("all")) {
                    break;
                }
            }
            seat.refresh();
        });
    }

    private void notice(Conn c, String message) {
        ObjectNode o = msg("notice");
        o.put("message", message);
        send(c, o);
    }

    private static final java.util.regex.Pattern COUNTER_NAME = java.util.regex.Pattern.compile("^[A-Za-z0-9+/\\- ]{1,24}$");

    /**
     * A manual override: put counters on a permanent, or take them off ({@code delta} &lt; 0),
     * outside the rules, like players adjusting a paper board. Any permanent on the battlefield;
     * the game log says who did it.
     */
    private void counter(Conn c, int id, String type, int delta) {
        if (delta == 0 || Math.abs(delta) > 99 || !COUNTER_NAME.matcher(type).matches() || !freePlay(c)) {
            return;
        }
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            Card card = g == null ? null : g.findById(id);
            if (card == null || seat == null || seat.player() == null || !card.isInPlay()) {
                return;
            }
            Player me = g.getPlayer(seat.player().getId());
            CounterType ct = CounterType.getType(type);
            if (ct == null) {
                return;
            }
            int changed;
            if (delta > 0) {
                card.addCounterInternal(ct, delta, me, false, null, null); // no events, like Forge's dev-mode tool (they need trigger params)
                changed = delta;
            } else {
                changed = card.subtractCounter(ct, -delta, me);
            }
            if (changed != 0) {
                String what = Math.abs(changed) + " " + ct.getName() + " counter" + (Math.abs(changed) == 1 ? "" : "s");
                g.getGameLog().add(GameLogEntryType.INFORMATION, me.getName() + (delta > 0 ? " put " + what + " on " : " removed " + what + " from ")
                        + card.getName() + " (by hand)");
            }
            seat.refresh();
        });
    }

    /** Forge is waiting for this player to act with priority (not paying mana, choosing targets...). */
    private static boolean priorityInput(IGameController ctl) {
        return ctl instanceof PlayerControllerHuman h && h.getInputProxy().getInput() instanceof InputPassPriority;
    }

    private IGameController controller(Conn c) {
        Hosted h = c.game;
        GameSession s = h == null ? null : h.session;
        BrowserSeat seat = h == null ? null : h.seat;
        if (s == null || seat == null || seat.player() == null || s.isOver()) {
            return null;
        }
        return s.controller(h.seatName, seat.player());
    }

    private static Game game(Conn c) {
        Hosted h = c.game;
        GameSession s = h == null ? null : h.session;
        return s == null ? null : s.game();
    }

    private static BrowserSeat seat(Conn c) {
        Hosted h = c.game;
        return h == null ? null : h.seat;
    }

    /**
     * Where to stop: {@code {"<player id>": ["UPKEEP", "MAIN1", ...]}}, the steps on that player's
     * turn where you want priority. Every other step on that player's turn is skipped.
     */
    private void stops(Conn c, JsonNode stops) {
        act(c, ctl -> {
            Game g = game(c);
            if (g == null || !stops.isObject()) {
                return;
            }
            for (Player p : g.getPlayers()) {
                JsonNode list = stops.path(String.valueOf(p.getId()));
                if (!list.isArray()) {
                    continue;
                }
                Set<String> on = new HashSet<>();
                list.forEach(n -> on.add(n.asText()));
                for (PhaseType phase : PhaseType.values()) {
                    ctl.applyYieldUpdate(new YieldUpdate.SkipPhase(p.getView(), phase, !on.contains(phase.name())));
                }
            }
        });
    }

    /** Auto-pass: END_OF_TURN, BEFORE_MY_TURN, UNTIL_MY_TURN, ACTION_OR_END_STEP, or null to cancel. */
    private void autoPass(Conn c, String mode) {
        Hosted h = c.game;
        if (h != null) {
            h.autoPass = mode == null || mode.equals("null") ? null : mode;
        }
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = seat(c);
            PlayerView me = seat == null ? null : seat.player();
            if (g == null || me == null) {
                return;
            }
            ctl.applyYieldUpdate(new YieldUpdate.ClearMarker(me));
            ctl.applyYieldUpdate(new YieldUpdate.SetAutoPassUntilEndOfTurn(me, false));
            if (mode == null || mode.equals("null")) {
                if (seat != null) {
                    seat.refresh();
                }
                return;
            }
            YieldUpdate update = AutoPass.update(g, me, mode);
            if (update != null) {
                ctl.applyYieldUpdate(update);
            }
            if (seat != null) {
                seat.refresh(); // the view's autoPassing
            }
        });
    }

    private void endGame(Hosted h) {
        games.remove(h.user, h);
        ScheduledFuture<?> expiry = h.expiry;
        if (expiry != null) {
            expiry.cancel(false);
        }
        Conn c = h.conn;
        if (c != null && c.game == h) {
            c.game = null;
        }
        BrowserSeat seat = h.seat;
        GameSession s = h.session;
        Rewind r = s == null ? null : s.rewind();
        Game g = s == null ? null : s.game();
        if (r != null && g != null && seat != null && seat.player() != null) {
            r.playerLeft(g.getPlayer(seat.player().getId()));   // a rewind request mustn't wait on them
        }
        if (seat != null) {
            seat.close();
        }
        if (s != null) {
            s.abort();
        }
    }

    private ObjectNode msg(String type) {
        ObjectNode o = json.createObjectNode();
        o.put("t", type);
        return o;
    }

    private void error(Conn c, String message) {
        ObjectNode o = msg("error");
        o.put("message", message);
        send(c, o);
    }

    private void send(Conn c, ObjectNode o) {
        try {
            sendRaw(c, json.writeValueAsString(o));
        } catch (Exception e) {
            Logger.debug(e, "Send failed");
        }
    }

    /** One write at a time per socket: game updates and replies come from different threads. */
    private static void sendRaw(Conn c, String text) {
        synchronized (c) {
            if (c.ws.session.isOpen()) {
                c.ws.send(text);
            }
        }
    }
}
