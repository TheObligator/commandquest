package forge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.gamemodes.match.YieldUpdate;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.web.engine.BrowserSeat;
import forge.web.engine.Decks;
import forge.web.engine.ForgeEngine;
import forge.web.engine.GameSession;
import io.javalin.websocket.WsContext;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.tinylog.Logger;

/**
 * The game socket ({@code /ws}). Each browser signs in with its Convex token, then starts a game
 * against Forge AI and plays it: the protocol is in docs/game-protocol.md. One game per user;
 * starting another, or closing the socket, ends the old one.
 */
public final class GameHub {

    /** Simultaneous games on this server (each runs AI on the Mac's CPU). */
    private final int maxGames;
    private final ConvexAuth auth;
    private final ObjectMapper json = new ObjectMapper();
    private final Map<String, Conn> conns = new ConcurrentHashMap<>();
    /** Engine start and game setup are slow; keep them off Jetty's threads. */
    private final ExecutorService work = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "game-setup");
        t.setDaemon(true);
        return t;
    });

    private static final class Conn {
        final WsContext ws;
        volatile String user;
        volatile String seatName;
        volatile BrowserSeat seat;
        volatile GameSession session;

        Conn(WsContext ws) {
            this.ws = ws;
        }
    }

    public GameHub(ConvexAuth auth, int maxGames) {
        this.auth = auth;
        this.maxGames = maxGames;
    }

    public void onConnect(WsContext ws) {
        conns.put(ws.sessionId(), new Conn(ws));
    }

    public void onClose(WsContext ws) {
        Conn c = conns.remove(ws.sessionId());
        if (c != null) {
            endGame(c);
        }
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
                act(c, ctl -> {
                    Card card = game(c) == null ? null : game(c).findById(id);
                    if (card != null) {
                        ctl.selectCard(card.getView(), null, null);
                    }
                });
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
                BrowserSeat seat = c.seat;
                if (seat != null) {
                    seat.answer(m.path("id").asInt(), m.path("choice"), m.path("text").asText(null));
                }
            }
            case "stops" -> stops(c, m.path("stops"));
            case "autopass" -> autoPass(c, m.path("mode").asText(null));
            default -> error(c, "Unknown message: " + t);
        }
    }

    private void hello(Conn c, String token) {
        work.execute(() -> {
            try {
                c.user = auth.verify(token);
                send(c, msg("hello"));
            } catch (Exception e) {
                Logger.info("Sign-in refused: {}", e.getMessage());
                error(c, "Sign-in failed: " + e.getMessage());
                c.ws.closeSession(4401, "sign-in failed");
            }
        });
    }

    private void start(Conn c, JsonNode m) {
        endGame(c);
        for (Conn other : conns.values()) { // one game per user, even across tabs
            if (other != c && c.user.equals(other.user)) {
                endGame(other);
                send(other, msg("replaced"));
            }
        }
        long running = conns.values().stream().filter(x -> x.session != null && !x.session.isOver()).count();
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
                BrowserSeat seat = new BrowserSeat(json, s -> sendRaw(c, s));
                String name = m.path("name").asText("You").trim();
                name = name.isEmpty() || name.length() > 40 || name.startsWith("AI ") ? "You" : name;
                seats.add(new GameSession.Seat(name, mine, seat));
                c.seatName = name;
                List<Deck> ai = Decks.randomPrecons(opponents);
                for (int i = 0; i < ai.size(); i++) {
                    seats.add(new GameSession.Seat("AI " + (i + 1), ai.get(i), null));
                }
                c.seat = seat;
                c.session = GameSession.startCommander(seats);
                Logger.info("Game started for {} ({} AI)", c.user, ai.size());
            } catch (IllegalArgumentException e) {
                error(c, e.getMessage());
            } catch (RuntimeException e) {
                Logger.error(e, "Couldn't start a game");
                error(c, "Couldn't start the game: " + e.getMessage());
            }
        });
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

    private IGameController controller(Conn c) {
        GameSession s = c.session;
        BrowserSeat seat = c.seat;
        if (s == null || seat == null || seat.player() == null || s.isOver()) {
            return null;
        }
        return s.controller(c.seatName, seat.player());
    }

    private static Game game(Conn c) {
        GameSession s = c.session;
        return s == null ? null : s.game();
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
        act(c, ctl -> {
            Game g = game(c);
            PlayerView me = c.seat.player();
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

    private void endGame(Conn c) {
        BrowserSeat seat = c.seat;
        GameSession s = c.session;
        c.seat = null;
        c.session = null;
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
