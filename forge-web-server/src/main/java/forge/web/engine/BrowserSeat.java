package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.game.GameEntityView;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.player.PlayerView;
import forge.gamemodes.net.IRemote;
import forge.gamemodes.net.ProtocolGuiGame;
import forge.gamemodes.net.event.GuiGameEvent;
import forge.gamemodes.net.event.IdentifiableNetEvent;
import forge.gamemodes.net.event.NetEvent;
import forge.gui.interfaces.IGuiGame;
import forge.util.FSerializableFunction;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.tinylog.Logger;

/**
 * One human seat's link between Forge's human controller and a browser. Forge calls
 * {@link #send} for state and prompts and {@link #sendAndWait} for questions that block the game
 * until answered. Everything goes to the browser as JSON (docs/game-protocol.md); answers come
 * back through {@link #answer}.
 */
public final class BrowserSeat implements IRemote {

    private final ObjectMapper json;
    private final ViewJson views;
    private final Consumer<String> sink;
    /** Outgoing messages in order, off the game thread. */
    private final ExecutorService out = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "seat-out");
        t.setDaemon(true);
        return t;
    });
    private final Map<Integer, Pending> pending = new ConcurrentHashMap<>();
    private final AtomicInteger askIds = new AtomicInteger();
    private volatile ProtocolGuiGame gui;
    private volatile PlayerView me;
    private volatile String promptMessage = "";
    private volatile String lastState;
    private volatile boolean closed;

    /** A question waiting for the browser, with how to turn its answer into Forge's value. */
    private record Pending(CompletableFuture<Object> answer, List<?> options, GuiGameEvent ev) {
    }

    public BrowserSeat(ObjectMapper json, Consumer<String> sink) {
        this.json = json;
        this.views = new ViewJson(json);
        this.sink = sink;
    }

    void attach(ProtocolGuiGame gui, Map<String, Map<String, String>> tokenArtByPlayer) {
        this.gui = gui;
        views.setTokenArt(owner -> owner == null ? null : tokenArtByPlayer.get(owner.getName()));
    }

    public PlayerView player() {
        return me;
    }

    // ---- Forge -> browser ----

    @Override
    @SuppressWarnings("unchecked")
    public void send(NetEvent event) {
        if (closed || !(event instanceof GuiGameEvent ev)) {
            return;
        }
        Object[] a = ev.getObjects();
        switch (ev.getMethod()) {
            case openView -> {
                Collection<PlayerView> mine = (Collection<PlayerView>) a[0];
                me = mine.isEmpty() ? null : mine.iterator().next();
                pushState();
            }
            case setGameView, applyDelta -> pushState();
            case showPromptMessage -> promptMessage = a[1] == null ? "" : String.valueOf(a[1]);
            case updateButtons -> {
                if (a[0] != null && !a[0].equals(me)) {
                    return;
                }
                pushState();
                ObjectNode o = msg("prompt");
                o.put("message", promptMessage);
                o.set("ok", button((String) a[1], (Boolean) a[3]));
                o.set("cancel", button((String) a[2], (Boolean) a[4]));
                emit(o);
            }
            case awaitNextInput -> emit(msg("waiting"));
            case finishGame, afterGameEnd -> {
                pushState();
                emit(msg("over"));
            }
            default -> { }
        }
    }

    private ObjectNode button(String label, Boolean enabled) {
        ObjectNode b = json.createObjectNode();
        b.put("label", label == null ? "" : label);
        b.put("enabled", Boolean.TRUE.equals(enabled) && label != null && !label.isEmpty());
        return b;
    }

    /** Sends this player's view of the game, if it changed. Runs on the game thread for a consistent snapshot. */
    private void pushState() {
        IGuiGame g = gui;
        GameView gv = g == null ? null : g.getGameView();
        if (gv == null || me == null) {
            return;
        }
        String state;
        try {
            ObjectNode o = msg("state");
            o.set("view", views.game(gv, me));
            state = json.writeValueAsString(o);
        } catch (Exception e) {
            Logger.warn(e, "Couldn't build the game view");
            return;
        }
        if (!state.equals(lastState)) {
            lastState = state;
            emitRaw(state);
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public Object sendAndWait(IdentifiableNetEvent event) {
        GuiGameEvent ev = (GuiGameEvent) event;
        Object[] a = ev.getObjects();
        GameView gv = gui == null ? null : gui.getGameView();
        ObjectNode o = msg("ask");
        List<?> options;
        String label = null;
        int min = 1;
        int max = 1;
        switch (ev.getMethod()) {
            case getChoices -> {
                o.put("message", str(a[0]));
                min = (Integer) a[1];
                max = (Integer) a[2];
                if (max < 0) {
                    o.put("kind", "info"); // Forge's reveal: a list to look at, nothing to pick
                    min = 0;
                    max = 0;
                }
                options = (List<?>) a[3];
                FSerializableFunction<Object, String> display = (FSerializableFunction<Object, String>) a[5];
                o.set("options", options(gv, options, display));
                ArrayNode sel = o.putArray("selected");
                if (a[4] != null) {
                    for (Object s : (Collection<?>) a[4]) {
                        int i = options.indexOf(s);
                        if (i >= 0) {
                            sel.add(i);
                        }
                    }
                }
            }
            case getAbilityToPlay -> {
                options = (List<?>) a[1];
                if (options.size() == 1) {
                    return options.get(0); // you clicked the card to do the only thing it can do
                }
                o.put("message", "Choose an ability");
                min = 0;
                o.set("options", options(gv, options, null));
            }
            case chooseSingleEntityForEffect -> {
                o.put("message", str(a[0]));
                options = (List<?>) a[1];
                min = Boolean.TRUE.equals(a[3]) ? 0 : 1;
                o.set("options", options(gv, options, null));
            }
            case chooseEntitiesForEffect -> {
                o.put("message", str(a[0]));
                options = (List<?>) a[1];
                min = (Integer) a[2];
                max = (Integer) a[3];
                o.set("options", options(gv, options, null));
            }
            case confirm -> {
                o.put("message", str(a[1]));
                List<String> opts = a[3] == null ? List.of("Yes", "No") : (List<String>) a[3];
                options = opts;
                o.set("options", options(gv, opts, null));
                if (a[0] instanceof CardView c && gv != null) {
                    o.set("card", views.card(gv, c, me));
                }
                o.putArray("selected").add(Boolean.TRUE.equals(a[2]) ? 0 : 1);
            }
            case showConfirmDialog -> {
                o.put("title", str(a[1]));
                o.put("message", str(a[0]));
                options = List.of(a[2] == null ? "Yes" : str(a[2]), a[3] == null ? "No" : str(a[3]));
                o.set("options", options(gv, options, null));
                o.putArray("selected").add(Boolean.TRUE.equals(a[4]) ? 0 : 1);
            }
            case showOptionDialog -> {
                o.put("title", str(a[1]));
                o.put("message", str(a[0]));
                options = (List<?>) a[3];
                o.set("options", options(gv, options, null));
                o.putArray("selected").add((Integer) a[4]);
            }
            case showInputDialog -> {
                o.put("title", str(a[1]));
                o.put("message", str(a[0]));
                if (a[4] != null) {
                    options = (List<?>) a[4];
                    o.set("options", options(gv, options, null));
                } else {
                    options = null;
                    o.put("kind", "text");
                    o.put("initial", str(a[3]));
                    o.put("numeric", Boolean.TRUE.equals(a[5]));
                }
            }
            default -> {
                // Not asked in the browser yet: Forge's default for this question.
                return defaultAnswer(ev);
            }
        }
        if (closed) {
            return defaultAnswer(ev);
        }
        if (!o.has("kind")) {
            o.put("kind", "choose");
        }
        o.put("min", min);
        o.put("max", max);
        int id = askIds.incrementAndGet();
        o.put("id", id);
        Pending p = new Pending(new CompletableFuture<>(), options, ev);
        pending.put(id, p);
        pushState();
        emit(o);
        try {
            return p.answer().get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return defaultAnswer(ev);
        } catch (ExecutionException e) {
            return defaultAnswer(ev);
        } finally {
            pending.remove(id);
        }
    }

    private ArrayNode options(GameView gv, List<?> items, FSerializableFunction<Object, String> display) {
        ArrayNode a = json.createArrayNode();
        for (Object item : items) {
            ObjectNode o = json.createObjectNode();
            if (item instanceof CardView c) {
                boolean seen = c.canBeShownTo(me) && (!c.isFaceDown() || c.canFaceDownBeShownTo(me));
                o.put("label", seen ? c.getCurrentState().getName() : "Hidden card");
                o.put("cardId", c.getId());
                if (gv != null) {
                    o.set("card", views.card(gv, c, me));
                }
            } else if (item instanceof PlayerView p) {
                o.put("label", p.getName());
                o.put("playerId", ViewJson.id(p));
            } else if (item instanceof GameEntityView e) {
                o.put("label", e.getName());
            } else {
                o.put("label", display != null ? display.apply(item) : String.valueOf(item));
            }
            a.add(o);
        }
        return a;
    }

    // ---- browser -> Forge ----

    /** The browser answered question {@code id}: {@code choice} is a list of option indexes, or {@code text}. */
    public void answer(int id, JsonNode choice, String text) {
        Pending p = pending.get(id);
        if (p == null) {
            return;
        }
        List<Integer> picked = new ArrayList<>();
        if (choice != null && choice.isArray()) {
            for (JsonNode n : choice) {
                int i = n.asInt(-1);
                if (p.options() != null && i >= 0 && i < p.options().size() && !picked.contains(i)) {
                    picked.add(i);
                }
            }
        }
        List<?> opts = p.options();
        Object value = switch (p.ev().getMethod()) {
            case getChoices, chooseEntitiesForEffect -> picked.stream().map(opts::get).toList();
            case getAbilityToPlay, chooseSingleEntityForEffect -> picked.isEmpty() ? null : opts.get(picked.get(0));
            case confirm, showConfirmDialog -> picked.isEmpty() ? null : picked.get(0) == 0;
            case showOptionDialog -> picked.isEmpty() ? null : picked.get(0);
            case showInputDialog -> opts == null ? text : picked.isEmpty() ? null : String.valueOf(opts.get(picked.get(0)));
            default -> null;
        };
        p.answer().complete(value);
    }

    /** What Forge gets when there's no browser answer (closed seat, or a question the browser can't ask yet). */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Object defaultAnswer(GuiGameEvent ev) {
        Object[] a = ev.getObjects();
        return switch (ev.getMethod()) {
            case getChoices -> {
                List<?> choices = (List<?>) a[3];
                int min = (Integer) a[1];
                yield new ArrayList<>(choices.subList(0, Math.min(min, choices.size())));
            }
            case chooseEntitiesForEffect -> {
                List<?> choices = (List<?>) a[1];
                yield new ArrayList<>(choices.subList(0, Math.min((Integer) a[2], choices.size())));
            }
            case chooseSingleEntityForEffect -> Boolean.TRUE.equals(a[3]) || ((List<?>) a[1]).isEmpty() ? null : ((List<?>) a[1]).get(0);
            case confirm -> a[2];
            case showConfirmDialog -> a[4];
            case showOptionDialog -> a[4];
            case showInputDialog -> a[3];
            case order -> {
                List all = new ArrayList((List<?>) a[5]);
                all.addAll((List<?>) a[4]);
                yield new IGuiGame.OrderResult(all, false);
            }
            case manipulateCardList -> {
                List<CardView> cards = new ArrayList<>();
                ((Iterable<CardView>) a[1]).forEach(cards::add);
                yield cards;
            }
            case assignGenericAmount -> {
                Map<Object, Integer> targets = (Map<Object, Integer>) a[1];
                Map<Object, Integer> result = new java.util.LinkedHashMap<>();
                int left = (Integer) a[2];
                boolean atLeastOne = Boolean.TRUE.equals(a[3]);
                for (Object t : targets.keySet()) {
                    result.put(t, atLeastOne ? 1 : 0);
                    left -= atLeastOne ? 1 : 0;
                }
                if (!result.isEmpty()) {
                    Object first = result.keySet().iterator().next();
                    result.put(first, result.get(first) + Math.max(0, left));
                }
                yield result;
            }
            default -> null; // assignCombatDamage: Forge assigns it itself
        };
    }

    /** The browser left: release every waiting question so the game thread never hangs. */
    public void close() {
        closed = true;
        pending.values().forEach(p -> p.answer().completeExceptionally(new IllegalStateException("seat closed")));
        out.shutdown();
    }

    // ---- plumbing ----

    private ObjectNode msg(String type) {
        ObjectNode o = json.createObjectNode();
        o.put("t", type);
        return o;
    }

    private void emit(ObjectNode o) {
        try {
            emitRaw(json.writeValueAsString(o));
        } catch (Exception e) {
            Logger.warn(e, "Couldn't encode a message");
        }
    }

    private void emitRaw(String s) {
        if (closed) {
            return;
        }
        try {
            out.execute(() -> {
                try {
                    sink.accept(s);
                } catch (RuntimeException e) {
                    Logger.debug(e, "Send to browser failed");
                }
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            // closed meanwhile
        }
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
