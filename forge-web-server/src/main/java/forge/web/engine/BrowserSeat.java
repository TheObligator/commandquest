package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.game.GameEntityView;
import forge.game.Game;
import forge.game.GameView;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import java.util.HashSet;
import java.util.Set;
import forge.game.card.CardView;
import forge.game.player.PlayerView;
import forge.game.spellability.StackItemView;
import forge.interfaces.IGameController;
import forge.game.spellability.SpellAbilityView;
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
    private volatile java.util.function.Supplier<Game> game = () -> null;
    private final ManualActions manual = new ManualActions();
    private volatile PlayerView me;
    private volatile String promptMessage = "";
    /** The prompt last sent (null while waiting), to resend when its text arrives after its buttons. */
    private volatile ObjectNode lastPrompt;
    /** What Forge's current prompt lets you click (Forge's setSelection), for the table's highlights. */
    private volatile forge.gamemodes.match.Selection selection = forge.gamemodes.match.Selection.NONE;
    /** Cards Forge is showing you right now (e.g. an opponent revealing their hand), until it hides them. */
    private volatile List<CardView> revealed = List.of();
    private volatile String lastState;
    private volatile boolean closed;
    /** Free play (chosen when the game starts): manual overrides and paying mana costs with nothing. */
    private volatile boolean freePlay = true;
    /** An ability picked from the browser's card menu: answers Forge's "which ability?" for that click. */
    private volatile Preferred preferred;

    private record Preferred(int id, String label) {
    }

    /** A question waiting for the browser, with how to turn its answer into Forge's value. */
    private record Pending(CompletableFuture<Object> answer, List<?> options, GuiGameEvent ev) {
    }

    public BrowserSeat(ObjectMapper json, Consumer<String> sink) {
        this.json = json;
        this.views = new ViewJson(json);
        this.sink = sink;
    }

    void attach(ProtocolGuiGame gui, Map<String, Map<String, String>> tokenArtByPlayer, java.util.function.Supplier<Game> game) {
        this.gui = gui;
        this.game = game;
        views.setTokenArt(owner -> owner == null ? null : tokenArtByPlayer.get(owner.getName()));
    }

    public PlayerView player() {
        return me;
    }

    /** A card of yours shown face up to you (your library, while you search it). */
    public ObjectNode revealedCard(CardView c) {
        IGuiGame g = gui;
        GameView gv = g == null ? null : g.getGameView();
        return views.card(gv, c, me, true);
    }

    public boolean freePlay() {
        return freePlay;
    }

    public void setFreePlay(boolean on) {
        freePlay = on;
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
            case showPromptMessage -> {
                if (a[0] != null && !a[0].equals(me)) {
                    return;
                }
                String text = a[1] == null ? "" : String.valueOf(a[1]);
                boolean changed = !text.equals(promptMessage);
                promptMessage = text;
                // Forge often sets a prompt's buttons before its text (yes/no questions, mulligans):
                // resend the prompt so its buttons don't show with the previous question.
                ObjectNode last = lastPrompt;
                if (changed && last != null) {
                    ObjectNode o = last.deepCopy();
                    o.put("message", text);
                    lastPrompt = o;
                    emit(o);
                }
            }
            case updateButtons -> {
                if (a[0] != null && !a[0].equals(me)) {
                    return;
                }
                pushState();
                ObjectNode o = msg("prompt");
                o.put("message", promptMessage);
                o.set("ok", button((String) a[1], (Boolean) a[3]));
                o.set("cancel", button((String) a[2], (Boolean) a[4]));
                payment(o);
                lastPrompt = o;
                emit(o);
            }
            case showRevealedCards -> {
                List<CardView> shown = new ArrayList<>();
                if (a[0] instanceof Iterable<?> it) {
                    it.forEach(c -> {
                        if (c instanceof CardView cv) {
                            shown.add(cv);
                        }
                    });
                }
                revealed = shown;
                pushState();
            }
            case hideRevealedCards -> {
                revealed = List.of();
                pushState();
            }
            case setSelection -> {
                selection = a[0] instanceof forge.gamemodes.match.Selection s ? s : forge.gamemodes.match.Selection.NONE;
                pushState();
            }
            case awaitNextInput -> {
                lastPrompt = null;
                emit(msg("waiting"));
            }
            case finishGame, afterGameEnd -> {
                lastPrompt = null; // nothing to answer any more (Forge then clears the prompt text)
                pushState();
                emit(msg("over"));
            }
            default -> { }
        }
    }

    /**
     * While you pay mana for a spell or ability, the prompt says what for ({@code pay}: cost, card,
     * cardId, kind spell/ability/effect, and {@code free} when this game allows paying nothing).
     */
    private void payment(ObjectNode prompt) {
        try {
            Game g = game.get();
            Player p = g == null || me == null ? null : g.getPlayer(me.getId());
            Payment.Info info = p == null || gui == null ? null : Payment.info(gui.getGameController(me), p);
            if (info == null) {
                return;
            }
            ObjectNode pay = prompt.putObject("pay");
            pay.put("cost", info.cost());
            pay.put("card", info.card());
            pay.put("cardId", info.cardId());
            pay.put("kind", info.kind());
            pay.put("free", freePlay);
            ArrayNode sources = pay.putArray("sources");
            info.sources().forEach(sources::add);
        } catch (RuntimeException e) {
            Logger.debug(e, "Couldn't describe the payment");
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
            Game live = game.get();
            if (live != null) {
                manual.keepLocked(live);
            }
            ObjectNode view = views.game(gv, me);
            view.set("playable", playable());
            view.put("freePlay", freePlay);
            if (!revealed.isEmpty()) {
                ArrayNode shown = view.putArray("revealed");
                revealed.forEach(c -> shown.add(views.card(gv, c, me, true))); // Forge chose to show you these
            }
            ObjectNode sel = selectionJson(gv, selection);
            if (sel != null) {
                view.set("selection", sel);
            }
            untapLocks(live, view);
            yields(gv, view);
            o.set("view", view);
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

    /**
     * Your cards you could use right now (cast, play, activate: not mana abilities), for the
     * table's "playable" glow. Empty unless you have priority.
     */
    private ArrayNode playable() {
        ArrayNode ids = json.createArrayNode();
        try {
            Game g = game.get();
            Player p = g == null || me == null ? null : g.getPlayer(me.getId());
            if (p == null || g.getPhaseHandler().getPriorityPlayer() != p || g.isGameOver()) {
                return ids;
            }
            Set<Integer> seen = new HashSet<>();
            for (Card c : p.getCardsIn(PLAYABLE_ZONES)) {
                if (seen.add(c.getId()) && c.getAllPossibleAbilities(p, true).stream().anyMatch(sa -> !sa.isManaAbility() && Explain.hasTargets(sa, p))) {
                    ids.add(c.getId());
                }
            }
            for (Card c : g.getCardsIn(ZoneType.Exile)) { // cards others exiled that you may play
                if (c.getOwner() != p && seen.add(c.getId()) && !c.mayPlay(p).isEmpty()
                        && c.getAllPossibleAbilities(p, true).stream().anyMatch(sa -> !sa.isManaAbility() && Explain.hasTargets(sa, p))) {
                    ids.add(c.getId());
                }
            }
        } catch (RuntimeException e) {
            Logger.debug(e, "Couldn't list playable cards");
        }
        return ids;
    }

    /**
     * Adds your yield settings to each ability on the stack: {@code yieldKey} (Forge's key for
     * "this ability of this card"), {@code autoYield}, and for your optional ("may") triggers
     * {@code optional} and {@code decision} (ASK, ACCEPT or DECLINE).
     */
    private void yields(GameView gv, ObjectNode view) {
        IGameController ctl = gui == null ? null : gui.getGameController(me);
        if (ctl == null) {
            return;
        }
        view.put("autoYieldsOff", ctl.getYieldController().getDisableAutoYields());
        // An auto-pass (until end of turn, or until a step) is still going; Forge ends it when it gets there or something needs you.
        view.put("autoPassing", ctl.getYieldController().isYieldActive());
        if (gv.getStack() == null) {
            return;
        }
        Map<Integer, StackItemView> byId = new java.util.HashMap<>();
        gv.getStack().forEach(s -> byId.put(s.getId(), s));
        for (JsonNode n : view.path("stack")) {
            StackItemView s = byId.get(n.path("id").asInt());
            if (s == null || !s.isAbility() || s.getKey() == null || s.getKey().isEmpty()) {
                continue;
            }
            ObjectNode o = (ObjectNode) n;
            o.put("yieldKey", s.getKey());
            o.put("autoYield", ctl.shouldAutoYield(s.getKey()));
            if (s.isOptionalTrigger() && me.equals(s.getActivatingPlayer())) {
                o.put("optional", true);
                o.put("decision", String.valueOf(ctl.getTriggerDecision(s.getKey())));
            }
        }
    }

    public ManualActions manual() {
        return manual;
    }

    /**
     * Forge's selection as ids: {@code cards} you may pick, {@code players} and {@code stack} items
     * you may target, what's {@code chosen} so far, and {@code actionable} cards (while paying mana:
     * the sources that can pay). Null when there's nothing to mark.
     */
    private ObjectNode selectionJson(GameView gv, forge.gamemodes.match.Selection s) {
        if (s == null || (s.cards().isEmpty() && s.targets().isEmpty() && s.chosen().isEmpty() && s.actionable().isEmpty())) {
            return null;
        }
        ObjectNode o = json.createObjectNode();
        ArrayNode cards = o.putArray("cards");
        ArrayNode players = o.putArray("players");
        ArrayNode stack = o.putArray("stack");
        s.cards().forEach(c -> cards.add(c.getId()));
        // Cards offered from places the table doesn't show (your library while you search it, an
        // opponent's hand…): their faces, so the prompt can list them. Forge offers them, so you may see them.
        ArrayNode offer = o.putArray("offer");
        for (CardView c : s.cards()) {
            ZoneType z = c.getZone();
            boolean onTable = z == ZoneType.Battlefield || z == ZoneType.Graveyard || z == ZoneType.Exile || z == ZoneType.Command
                    || z == ZoneType.Stack || (z == ZoneType.Hand && me != null && me.equals(c.getController() != null ? c.getController() : c.getOwner()));
            if (!onTable) {
                offer.add(views.card(gv, c, me, true));
            }
        }
        // The other cards you're looking at there right now (Harald's top five: the ones you can't
        // take), so the prompt can show them too, not clickable.
        ArrayNode alsoSeen = o.putArray("seen");
        if (!offer.isEmpty()) {
            java.util.Set<Integer> offered = new java.util.HashSet<>();
            s.cards().forEach(c -> offered.add(c.getId()));
            Game g = game.get();
            java.util.Set<String> zonesDone = new java.util.HashSet<>();
            for (CardView c : s.cards()) {
                if (g == null || c.getZone() != ZoneType.Library || c.getOwner() == null
                        || !zonesDone.add(c.getOwner().getId() + "/" + c.getZone())) {
                    continue;
                }
                Player owner = g.getPlayer(c.getOwner().getId());
                if (owner == null) {
                    continue;
                }
                for (Card lc : owner.getCardsIn(ZoneType.Library)) {
                    CardView v = lc.getView();
                    if (!offered.contains(v.getId()) && v.canBeShownTo(me)) {
                        alsoSeen.add(views.card(gv, v, me));
                    }
                }
            }
            if (alsoSeen.size() > 15) {
                alsoSeen.removeAll(); // a whole library on show: the offered cards are enough
            }
        }
        for (Object t : s.targets()) {
            if (t instanceof CardView c) {
                cards.add(c.getId());
            } else if (t instanceof PlayerView p) {
                players.add(ViewJson.id(p));
            } else if (t instanceof StackItemView si) {
                stack.add(si.getId());
            }
        }
        ArrayNode chosen = o.putArray("chosen");
        for (Object t : s.chosen()) {
            if (t instanceof CardView c) {
                chosen.add(c.getId());
            } else if (t instanceof PlayerView p) {
                chosen.add(ViewJson.id(p));
            }
        }
        ArrayNode actionable = o.putArray("actionable");
        new java.util.LinkedHashSet<>(s.actionable()).forEach(c -> actionable.add(c.getId()));
        return o;
    }

    /** Marks permanents kept from untapping by hand: {@code untapLock} "next" or "never". */
    private void untapLocks(Game g, ObjectNode view) {
        if (g == null) {
            return;
        }
        for (JsonNode p : view.path("players")) {
            for (JsonNode c : p.path("battlefield")) {
                Card card = g.findById(c.path("id").asInt());
                String lock = card == null ? null : manual.untapLock(card);
                if (lock != null) {
                    ((ObjectNode) c).put("untapLock", lock);
                }
            }
        }
    }

    /** Sends the view again (e.g. after a yield setting changed, which isn't a game event). */
    public void refresh() {
        lastState = null;
        pushState();
    }

    private static final List<ZoneType> PLAYABLE_ZONES =
            List.of(ZoneType.Hand, ZoneType.Battlefield, ZoneType.Command, ZoneType.Graveyard, ZoneType.Exile);

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
                Object chosen = preferredOf(options);
                if (chosen != null) {
                    return chosen;
                }
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
            case order -> {
                // Put cards (or triggers, costs…) in order: the ones already ordered first, then the rest.
                // remainingMin..remainingMax of them may be left out (usually none).
                o.put("kind", "order");
                o.put("title", str(a[0]));
                o.put("message", str(a[0]));
                o.put("top", str(a[1]));
                List<Object> all = new ArrayList<>();
                if (a[5] != null) {
                    all.addAll((List<?>) a[5]);
                }
                all.addAll((List<?>) a[4]);
                options = all;
                o.set("options", options(gv, all, null));
                min = Math.max(0, all.size() - (Integer) a[3]);
                max = Math.max(0, all.size() - (Integer) a[2]);
                if (a[6] instanceof CardView c && gv != null) {
                    o.set("card", views.card(gv, c, me));
                }
            }
            case manipulateCardList -> {
                // Scry and the like: the cards you may move (options), each to the top or the bottom
                // of your library (toTop / toBottom say which are allowed), in an order.
                o.put("kind", "arrange");
                o.put("message", str(a[0]));
                List<Object> manip = new ArrayList<>();
                ((Iterable<?>) a[2]).forEach(manip::add);
                options = manip;
                o.set("options", options(gv, manip, null));
                o.put("toTop", Boolean.TRUE.equals(a[3]));
                o.put("toBottom", Boolean.TRUE.equals(a[4]));
                min = manip.size();
                max = manip.size();
            }
            case assignGenericAmount -> {
                // Divide an amount (damage, counters…) among targets: answered with one number per option.
                o.put("kind", "distribute");
                Map<Object, Integer> targets = (Map<Object, Integer>) a[1];
                options = new ArrayList<>(targets.keySet());
                o.set("options", options(gv, options, null));
                o.put("amount", (Integer) a[2]);
                o.put("atLeastOne", Boolean.TRUE.equals(a[3]));
                String what = a[4] == null ? "" : str(a[4]);
                o.put("message", "Divide " + a[2] + (what.isEmpty() ? "" : " " + what) + (a[0] instanceof CardView src ? " from " + src.getCurrentState().getName() : ""));
                if (a[0] instanceof CardView src && gv != null) {
                    o.set("card", views.card(gv, src, me));
                }
                min = 0;
                max = options.size();
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
                o.put("label", label(display != null ? display.apply(item) : String.valueOf(item)));
            }
            a.add(o);
        }
        return a;
    }

    private static final java.util.Set<String> COLOR_NAMES = java.util.Set.of("WHITE", "BLUE", "BLACK", "RED", "GREEN", "COLORLESS");

    /** Forge's color choices come as "BLACK": show "Black". */
    static String label(String s) {
        return s != null && COLOR_NAMES.contains(s) ? s.charAt(0) + s.substring(1).toLowerCase(java.util.Locale.ROOT) : s;
    }

    // ---- browser -> Forge ----

    /**
     * The next "which ability?" question picks this one (by id, else by its text: some abilities,
     * like alternative costs, are rebuilt with a new id each time Forge lists them). Null clears it.
     */
    public void prefer(Integer abilityId, String label) {
        preferred = abilityId == null ? null : new Preferred(abilityId, label);
    }

    private Object preferredOf(List<?> options) {
        Preferred p = preferred;
        if (p == null) {
            return null;
        }
        for (Object o : options) {
            if (o instanceof SpellAbilityView sa && sa.getId() == p.id()) {
                return o;
            }
        }
        for (Object o : options) {
            if (o instanceof SpellAbilityView sa && p.label() != null && p.label().equals(sa.getDescription())) {
                return o;
            }
        }
        return null;
    }

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
        if (p.ev().getMethod() == forge.gamemodes.net.ProtocolMethod.assignGenericAmount) {
            p.answer().complete(distribution(p, choice));
            return;
        }
        if (p.ev().getMethod() == forge.gamemodes.net.ProtocolMethod.manipulateCardList) {
            p.answer().complete(arrangement(p, choice));
            return;
        }
        Object value = switch (p.ev().getMethod()) {
            case getChoices, chooseEntitiesForEffect -> picked.stream().map(opts::get).toList();
            case getAbilityToPlay, chooseSingleEntityForEffect -> picked.isEmpty() ? null : opts.get(picked.get(0));
            case confirm, showConfirmDialog -> picked.isEmpty() ? null : picked.get(0) == 0;
            case showOptionDialog -> picked.isEmpty() ? null : picked.get(0);
            case showInputDialog -> opts == null ? text : picked.isEmpty() ? null : String.valueOf(opts.get(picked.get(0)));
            case order -> orderResult(p, picked);
            default -> null;
        };
        p.answer().complete(value);
    }

    /** An order answer: the picked options in order, if the count fits; else Forge's default. */
    private static Object orderResult(Pending p, List<Integer> picked) {
        Object[] a = p.ev().getObjects();
        int total = p.options().size();
        int left = total - picked.size();
        if (left < (Integer) a[2] || left > (Integer) a[3]) {
            return defaultAnswer(p.ev());
        }
        return new IGuiGame.OrderResult<>(picked.stream().map(i -> (Object) p.options().get(i)).toList(), false);
    }

    /**
     * An arrange answer: option indexes for the top (first = top), then -1, then the ones for the
     * bottom (last = bottom). Forge gets the whole list: top cards, the rest as they were, bottom
     * cards. Every movable card exactly once, in an allowed place; else Forge's default.
     */
    private static Object arrangement(Pending p, JsonNode choice) {
        Object[] a = p.ev().getObjects();
        List<?> manip = p.options();
        List<Object> top = new ArrayList<>();
        List<Object> bottom = new ArrayList<>();
        java.util.Set<Integer> seen = new java.util.HashSet<>();
        boolean toBottom = false;
        if (choice != null && choice.isArray()) {
            for (JsonNode n : choice) {
                int i = n.asInt(-2);
                if (i == -1) {
                    toBottom = true;
                    continue;
                }
                if (i < 0 || i >= manip.size() || !seen.add(i)) {
                    return defaultAnswer(p.ev());
                }
                (toBottom ? bottom : top).add(manip.get(i));
            }
        }
        if (seen.size() != manip.size() || (!top.isEmpty() && !Boolean.TRUE.equals(a[3])) || (!bottom.isEmpty() && !Boolean.TRUE.equals(a[4]))) {
            return defaultAnswer(p.ev());
        }
        List<Object> result = new ArrayList<>(top);
        ((Iterable<?>) a[1]).forEach(c -> {
            if (!manip.contains(c)) {
                result.add(c);
            }
        });
        result.addAll(bottom);
        return result;
    }

    /** A divide answer: one number per option, adding up to the amount (each at least 1 if asked); else Forge's default. */
    private static Object distribution(Pending p, JsonNode choice) {
        Object[] a = p.ev().getObjects();
        int amount = (Integer) a[2];
        boolean atLeastOne = Boolean.TRUE.equals(a[3]);
        List<?> opts = p.options();
        Map<Object, Integer> result = new java.util.LinkedHashMap<>();
        int sum = 0;
        for (int i = 0; i < opts.size(); i++) {
            int n = choice != null && choice.isArray() ? choice.path(i).asInt(-1) : -1;
            if (n < (atLeastOne ? 1 : 0) || n > amount) {
                return defaultAnswer(p.ev());
            }
            result.put(opts.get(i), n);
            sum += n;
        }
        return sum == amount ? result : defaultAnswer(p.ev());
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
                List<Object> cards = new ArrayList<>();
                ((Iterable<?>) a[1]).forEach(cards::add);
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

    /** Answers every open question with Forge's default (e.g. before conceding, which can't happen while Forge waits on one). */
    public void answerOpenWithDefaults() {
        pending.values().forEach(p -> p.answer().complete(defaultAnswer(p.ev())));
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
