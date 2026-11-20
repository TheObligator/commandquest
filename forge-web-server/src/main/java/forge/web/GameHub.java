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
import forge.web.engine.BrowserSeat;
import forge.web.engine.Decks;
import forge.web.engine.Explain;
import forge.web.engine.ManualActions;
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
        this.auth = auth;
        this.maxGames = maxGames;
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
            case "ok" -> act(c, IGameController::selectButtonOk);
            case "cancel" -> act(c, IGameController::selectButtonCancel);
            case "concede" -> act(c, IGameController::concede);
            case "card" -> {
                int id = m.path("id").asInt();
                List<Integer> others = ids(m.path("others"));
                act(c, ctl -> click(c, ctl, id, null, null, others));
            }
            case "actions" -> {
                int id = m.path("id").asInt();
                act(c, ctl -> actions(c, ctl, id));
            }
            case "ability" -> {
                int id = m.path("id").asInt();
                int ability = m.path("ability").asInt();
                String label = m.path("label").asText(null);
                act(c, ctl -> click(c, ctl, id, ability, label, List.of()));
            }
            case "abilities" -> {
                List<Use> uses = new ArrayList<>();
                for (JsonNode u : m.path("uses")) {
                    if (uses.size() < 100 && u.path("id").isInt()) {
                        uses.add(new Use(u.path("id").asInt(), u.path("ability").asInt(), u.path("label").asText(null)));
                    }
                }
                abilities(c, uses);
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
                h.seat = seat;
                seats.add(new GameSession.Seat(name, mine, seat, tokenArt(m.path("deck").path("tokens"))));
                List<Deck> ai = Decks.randomPrecons(opponents);
                for (int i = 0; i < ai.size(); i++) {
                    seats.add(new GameSession.Seat("AI " + (i + 1), ai.get(i), null));
                }
                games.put(c.user, h);
                c.game = h;
                h.session = GameSession.startCommander(seats);
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
    private boolean click(Conn c, IGameController ctl, int id, Integer ability, String label, List<Integer> others) {
        Game g = game(c);
        BrowserSeat seat = seat(c);
        Card card = g == null ? null : g.findById(id);
        if (card == null || seat == null) {
            return false;
        }
        // The rest of a selected group: Forge's block and attack inputs (and mana abilities) treat
        // them like the clicked card.
        List<forge.game.card.CardView> group = null;
        for (int o : others) {
            Card other = o == id ? null : g.findById(o);
            if (other != null) {
                if (group == null) {
                    group = new ArrayList<>();
                }
                group.add(other.getView());
            }
        }
        boolean used;
        seat.prefer(ability, label);
        try {
            used = ctl.selectCard(card.getView(), group, null);
        } finally {
            seat.prefer(null, null);
        }
        Player me = seat.player() == null ? null : g.getPlayer(seat.player().getId());
        if (!used && me != null) {
            ObjectNode o = msg("notice");
            o.put("message", Explain.whyNot(g, me, card, priorityInput(ctl)));
            send(c, o);
        }
        return used;
    }

    /** One ability of one card, from the browser's {@code abilities} list. */
    private record Use(int id, int ability, String label) {}

    /**
     * Uses an ability on each of several cards, one after another: each starts once the one before
     * is done (its targets chosen and costs paid, or cancelled) and you have priority again, so a
     * click never lands in the middle of another card's payment. The browser gets
     * {@code abilitiesDone} at the end.
     */
    private void abilities(Conn c, List<Use> uses) {
        Thread t = new Thread(() -> {
            try {
                for (Use u : uses) {
                    if (!(controller(c) instanceof PlayerControllerHuman h)) {
                        break;
                    }
                    Object in = awaitInput(c, h, null);
                    if (in == null) {
                        break;
                    }
                    boolean[] used = {false};
                    FThreads.invokeInEdtAndWait(() -> used[0] = click(c, h, u.id(), u.ability(), u.label(), List.of()));
                    if (used[0] && awaitInput(c, h, in) == null) {
                        break;
                    }
                }
            } catch (RuntimeException e) {
                Logger.warn(e, "Using abilities on several cards failed");
            } finally {
                send(c, msg("abilitiesDone"));
            }
        }, "web-abilities");
        t.setDaemon(true);
        t.start();
    }

    /**
     * Waits (up to 10 minutes) until this player has priority with a new prompt: Forge's priority
     * input, other than {@code not} (the one a card was just clicked on). Null if the game ended,
     * the player left, or time ran out.
     */
    private Object awaitInput(Conn c, PlayerControllerHuman h, Object not) {
        long end = System.nanoTime() + TimeUnit.MINUTES.toNanos(10);
        while (System.nanoTime() < end) {
            if (controller(c) != h) {
                return null;
            }
            Object in = h.getInputProxy().getInput();
            if (in instanceof InputPassPriority && in != not) {
                return in;
            }
            try {
                Thread.sleep(40);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        return null;
    }

    /** A JSON array of card ids (at most 100). */
    private static List<Integer> ids(JsonNode a) {
        List<Integer> out = new ArrayList<>();
        for (JsonNode n : a) {
            if (n.isInt() && out.size() < 100) {
                out.add(n.asInt());
            }
        }
        return out;
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
            Set<String> playableText = new HashSet<>();
            if (canAct) {
                for (SpellAbility sa : card.getAllPossibleAbilities(me, true)) {
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
                o.put("reason", Explain.whyNot(g, me, card, priorityInput(ctl)));
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
            if (!ManualActions.allowed(card, me)) {
                notice(c, "You can only do that to your own cards.");
                return;
            }
            List<Player> to = new ArrayList<>();
            for (JsonNode p : m.path("to")) {
                Player other = g.getPlayer(p.asInt(-1));
                if (other != null && other != me && !to.contains(other)) {
                    to.add(other);
                }
            }
            if (!seat.manual().run(g, me, card, action, to, seat::refresh)) {
                notice(c, "That can't be done to this card where it is now.");
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
        if (delta == 0 || Math.abs(delta) > 99 || !COUNTER_NAME.matcher(type).matches()) {
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

    /** Auto-pass: END_OF_TURN, BEFORE_MY_TURN, ACTION_OR_END_STEP, or null to cancel. */
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
                return;
            }
            Player active = g.getPhaseHandler().getPlayerTurn();
            switch (mode) {
                case "END_OF_TURN" -> ctl.applyYieldUpdate(new YieldUpdate.SetAutoPassUntilEndOfTurn(me, true));
                case "ACTION_OR_END_STEP" -> ctl.applyYieldUpdate(new YieldUpdate.SetMarker(active.getView(), PhaseType.END_OF_TURN, false));
                case "BEFORE_MY_TURN" -> {
                    List<Player> order = g.getPlayers();
                    Player mine = g.getPlayer(me.getId());
                    int i = order.indexOf(mine);
                    Player before = order.get((i - 1 + order.size()) % order.size());
                    ctl.applyYieldUpdate(new YieldUpdate.SetMarker(before.getView(), PhaseType.END_OF_TURN, false));
                }
                default -> { }
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
