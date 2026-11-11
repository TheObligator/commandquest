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
import forge.web.engine.Payment;
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
                BrowserSeat seat = c.seat;
                if (seat != null) {
                    seat.answer(m.path("id").asInt(), m.path("choice"), m.path("text").asText(null));
                }
            }
            case "stops" -> stops(c, m.path("stops"));
            case "yield" -> yieldTo(c, m.path("key").asText(""), m.path("autoYield"), m.path("decision").asText(null));
            case "manual" -> manual(c, m);
            case "payFree" -> payFree(c);
            case "library" -> library(c, m);
            case "libraryCards" -> libraryCards(c, m.path("top").asInt(0), m.path("log").asBoolean(false));
            case "details" -> details(c, m.path("id").asInt());
            case "counter" -> counter(c, m.path("id").asInt(), m.path("type").asText(""), m.path("delta").asInt());
            case "yieldsOff" -> act(c, ctl -> {
                ctl.setDisableAutoYields(m.path("off").asBoolean());
                BrowserSeat seat = c.seat;
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
                seat.setFreePlay(m.path("freePlay").asBoolean(true));
                String name = m.path("name").asText("You").trim();
                name = name.isEmpty() || name.length() > 40 || name.startsWith("AI ") ? "You" : name;
                seats.add(new GameSession.Seat(name, mine, seat, tokenArt(m.path("deck").path("tokens"))));
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
        BrowserSeat seat = c.seat;
        Card card = g == null ? null : g.findById(id);
        if (card == null || seat == null) {
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

    /** The card's abilities for its menu: everything Forge lists for this player, and whether each can be used now. */
    private void actions(Conn c, IGameController ctl, int id) {
        Game g = game(c);
        BrowserSeat seat = c.seat;
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
            BrowserSeat seat = c.seat;
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
            BrowserSeat seat = c.seat;
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

    /**
     * A manual action on your own library (docs/game-protocol.md, {@code library}): draw, mill,
     * exile, reveal the top card, shuffle. Free play only.
     */
    private void library(Conn c, JsonNode m) {
        if (!freePlay(c)) {
            return;
        }
        String action = m.path("action").asText("");
        int n = m.path("n").asInt(1);
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = c.seat;
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
    private void libraryCards(Conn c, int top, boolean log) {
        if (!freePlay(c)) {
            return;
        }
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = c.seat;
            Player me = g == null || seat == null || seat.player() == null ? null : g.getPlayer(seat.player().getId());
            if (me == null) {
                return;
            }
            List<Card> lib = new ArrayList<>(me.getCardsIn(forge.game.zone.ZoneType.Library));
            if (top > 0) {
                lib = lib.subList(0, Math.min(top, lib.size()));
            }
            ObjectNode o = msg("libraryCards");
            o.put("top", top);
            ArrayNode cards = o.putArray("cards");
            for (Card card : lib) {
                cards.add(seat.revealedCard(card.getView()));
            }
            if (log) {
                ManualActions.logLook(g, me, top <= 0 ? 0 : lib.size());
                seat.refresh();
            }
            send(c, o);
        });
    }

    /** Is free play on in this game? If not, tells the browser that manual overrides are off. */
    private boolean freePlay(Conn c) {
        BrowserSeat seat = c.seat;
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
            BrowserSeat seat = c.seat;
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
            BrowserSeat seat = c.seat;
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
        if (delta == 0 || Math.abs(delta) > 99 || !COUNTER_NAME.matcher(type).matches() || !freePlay(c)) {
            return;
        }
        act(c, ctl -> {
            Game g = game(c);
            BrowserSeat seat = c.seat;
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
            BrowserSeat seat = c.seat;
            if (mode == null || mode.equals("null")) {
                if (seat != null) {
                    seat.refresh();
                }
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
            if (seat != null) {
                seat.refresh(); // the view's autoPassing
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
