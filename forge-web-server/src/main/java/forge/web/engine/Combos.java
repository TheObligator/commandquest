package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.input.Input;
import forge.gamemodes.match.input.InputLockUI;
import forge.gamemodes.match.input.InputPassPriority;
import forge.gamemodes.match.input.InputPayMana;
import forge.gui.FThreads;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.tinylog.Logger;

/**
 * One player's combos in this game (docs/combos.md): recorded by playing them once, then run again as
 * many times as asked. A recording is what the player did (clicks, passes, answers), each with what the
 * game was asking at the time. Running one does the same things through the same controls, so the rules
 * apply and everyone gets priority as usual; as soon as the game asks something else, or doesn't let it
 * happen, the run stops and the player carries on from there.
 */
public final class Combos {

    public static final int MAX_COMBOS = 20;
    public static final int MAX_STEPS = 200;
    public static final int MAX_LOOPS = 1000;
    static final int MAX_NAME = 60;
    /** A run gives up on a step that the game, waiting on this player, doesn't ask for in this long. */
    static final long PATIENCE_MS = 2000;

    /** What a recording can hold; a run ignores these from the browser while it plays. */
    public static final Set<String> MOVES = Set.of("ok", "cancel", "card", "ability", "player", "answer", "payPool", "tapForMana");

    /** A card as recorded: found again by id, or (a token made anew each time) by its name and controller. */
    private record CardRef(int id, String name, int controller, ZoneType zone) {
        static CardRef of(Game g, Card c) {
            Zone z = c == null ? null : g.getZoneOf(c);
            return z == null ? null : new CardRef(c.getId(), c.getName(), c.getController().getId(), z.getZoneType());
        }

        Card find(Game g, Set<Integer> not) {
            Card same = g.findById(id);
            Zone z = same == null ? null : g.getZoneOf(same);
            if (z != null && z.getZoneType() == zone && !not.contains(id)) {
                return same;
            }
            Player p = g.getPlayer(controller);
            if (p == null) {
                return null;
            }
            for (Card c : p.getCardsIn(zone).threadSafeIterable()) {
                if (c.getName().equals(name) && !c.isTapped() && !not.contains(c.getId())) {
                    return c;
                }
            }
            for (Card c : p.getCardsIn(zone).threadSafeIterable()) {
                if (c.getName().equals(name) && !not.contains(c.getId())) {
                    return c;
                }
            }
            return null;
        }
    }

    /** {@code asked}: what the game was asking ({@link #asking}). {@code move}: the browser's message. */
    private record Step(String asked, String kind, JsonNode move, CardRef card, List<CardRef> more, String text) {
    }

    private static final class Combo {
        final int id;
        String name;
        final List<Step> steps;
        final List<String> gains;
        /** It ends where it started, so it can be repeated. */
        final boolean loops;
        /** The browser's id for the known combo it was recorded as, or null. */
        final String ref;

        Combo(int id, String name, List<Step> steps, List<String> gains, boolean loops, String ref) {
            this.id = id;
            this.name = name;
            this.steps = steps;
            this.gains = gains;
            this.loops = loops;
            this.ref = ref;
        }
    }

    /** What the table has to do around a run: hold rewinding and recording, show everyone the result. */
    public interface Table {
        void started();

        void ended();

        /** Changes when someone asks to rewind, or a rewind happens: a run stops. */
        int rewinds();
    }

    private final BrowserSeat seat;
    private final ObjectMapper json;
    private volatile Table table = new Table() {
        @Override public void started() { }

        @Override public void ended() { }

        @Override public int rewinds() {
            return 0;
        }
    };

    private final List<Combo> combos = new ArrayList<>();
    private int nextId = 1;
    /** What's being recorded, or null. */
    private List<Step> recording;
    private ComboState recordedFrom;
    private String startedAsking;
    private int startedRewinds;
    private volatile Run run;

    Combos(BrowserSeat seat, ObjectMapper json) {
        this.seat = seat;
        this.json = json;
    }

    void setTable(Table t) {
        table = t;
    }

    /** A run is playing. */
    public boolean running() {
        return run != null;
    }

    public synchronized boolean recording() {
        return recording != null;
    }

    /** Recording or running: every pass is the player's own, nothing is skipped for them. */
    boolean active() {
        return running() || recording();
    }

    // ---- what the game is asking ----

    /** Ids and numbers change from one time round to the next ("Goblin (123)", "{3}"…), the question doesn't. */
    static String plain(String s) {
        return s == null ? "" : s.replaceAll("\\(\\d+\\)", "").replaceAll("\\d+", "#").replaceAll("\\s+", " ").trim();
    }

    /** What this player is being asked now, as recordings compare it; null when it's not their move. */
    private String asking() {
        ObjectNode ask = seat.openAsk();
        if (ask != null) {
            return "ask " + ask.path("kind").asText() + ": " + plain(ask.path("title").asText()) + " / " + plain(ask.path("message").asText());
        }
        WebPlayerController c = seat.webController();
        Input input = c == null ? null : c.getInputQueue().getInput();
        if (input == null || input instanceof InputLockUI || seat.shownInput() != input) {
            return null;
        }
        if (input instanceof InputPassPriority) {
            StringBuilder b = new StringBuilder("priority");
            for (SpellAbilityStackInstance si : c.getGame().getStack()) {
                b.append(" | ").append(si.getSourceCard() == null ? "" : si.getSourceCard().getName()).append(" of ")
                        .append(si.getActivatingPlayer() == null ? "?" : si.getActivatingPlayer().getId());
            }
            return b.toString();
        }
        String message = seat.promptMessage();
        return input.getClass().getSimpleName() + ": " + plain(input instanceof InputPayMana ? message.split("\n")[0] : message);
    }

    // ---- recording ----

    /** Starts recording. Returns why it can't, or null. Forge's UI thread. */
    public synchronized String record() {
        String asked = asking();
        if (recording != null || run != null) {
            return "Already at it.";
        }
        if (asked == null || !asked.startsWith("priority")) {
            return "Start recording when you have priority.";
        }
        recording = new ArrayList<>();
        startedAsking = asked;
        startedRewinds = table.rewinds();
        recordedFrom = ComboState.of(seat.webController().getGame(), seat.webController().getPlayer());
        return null;
    }

    public synchronized void cancelRecording() {
        recording = null;
        recordedFrom = null;
    }

    /** The player is about to do {@code move} (a browser message in {@link #MOVES}); noted when recording. */
    public synchronized void note(JsonNode move) {
        if (recording == null) {
            return;
        }
        String asked = asking();
        WebPlayerController c = seat.webController();
        Game g = c == null ? null : c.getGame();
        String kind = move.path("t").asText();
        if (g == null || asked == null || !MOVES.contains(kind) || rewound()) {
            return;
        }
        if (recording.size() >= MAX_STEPS) {
            cancelRecording();
            seat.notice("That's too long to record.");
            return;
        }
        Card card = kind.equals("card") || kind.equals("ability") ? g.findById(move.path("id").asInt(-1)) : null;
        List<CardRef> more = new ArrayList<>();
        JsonNode kept = move;
        if (kind.equals("tapForMana")) {
            for (JsonNode p : move.path("picks")) {
                more.add(CardRef.of(g, g.findById(p.path("card").asInt(-1))));
                more.add(CardRef.of(g, g.findById(p.path("source").asInt(-1))));
            }
        } else if (kind.equals("answer")) {
            ObjectNode ask = seat.openAsk();
            if (ask == null || ask.path("id").asInt() != move.path("id").asInt()) {
                return;
            }
            ObjectNode a = move.deepCopy();
            a.set("ask", ask.deepCopy());
            kept = a;
        }
        recording.add(new Step(asked, kind, kept, card == null ? null : CardRef.of(g, card), more, describe(kind, kept, card, asked, g)));
    }

    /** A step in words. */
    private String describe(String kind, JsonNode move, Card card, String asked, Game g) {
        boolean priority = asked.startsWith("priority");
        return switch (kind) {
            case "ok" -> priority ? (asked.equals("priority") ? "Pass to the next step" : "Pass priority")
                    : asked.startsWith("InputPayMana") ? "Auto-pay" : "OK";
            case "cancel" -> "Cancel";
            case "card", "ability" -> card == null ? "Choose a card"
                    : priority ? move.has("label") ? card.getName() + ": " + effect(move.path("label").asText()) : "Use " + card.getName()
                    : asked.startsWith("InputPayMana") ? "Pay with " + card.getName() : "Choose " + card.getName();
            case "player" -> {
                Player p = g.getPlayer(move.path("id").asInt(-1));
                yield "Choose " + (p == null ? "a player" : p.getName());
            }
            case "answer" -> "Answer: " + String.join(", ", labels(move));
            case "payPool" -> "Pay from the pool";
            default -> "Tap for mana";
        };
    }

    /** An ability's text without its cost, shortened. */
    private static String effect(String label) {
        int at = label.indexOf(": ");
        String s = (at < 0 ? label : label.substring(at + 2)).split("\n")[0];
        return s.length() <= 60 ? s : s.substring(0, 58).stripTrailing() + "…";
    }

    private static List<String> labels(JsonNode move) {
        List<String> out = new ArrayList<>();
        JsonNode options = move.path("ask").path("options");
        for (JsonNode i : move.path("choice")) {
            if (options.has(i.asInt(-1))) {
                out.add(options.get(i.asInt()).path("label").asText());
            }
        }
        if (out.isEmpty()) {
            out.add(move.path("text").asText("none"));
        }
        return out;
    }

    /** A rewind since recording started undid what was recorded: it's dropped. */
    private boolean rewound() {
        if (table.rewinds() == startedRewinds) {
            return false;
        }
        cancelRecording();
        seat.notice("The game was rewound, so the recording was dropped.");
        return true;
    }

    /** Keeps what was recorded as a combo. Returns why it can't, or null. Forge's UI thread. */
    public String keep(String name) {
        return keep(name, null);
    }

    /** {@code ref}: the browser's id for the known combo (Commander Spellbook's) it was recorded as, or null. */
    public synchronized String keep(String name, String ref) {
        if (recording == null) {
            return "Nothing is being recorded.";
        }
        if (rewound()) {
            return null;
        }
        String asked = asking();
        if (asked == null || !asked.startsWith("priority")) {
            return "Finish what you're doing first: stop recording when you have priority.";
        }
        List<Step> steps = recording;
        ComboState from = recordedFrom;
        if (steps.isEmpty()) {
            cancelRecording();
            return "Nothing was recorded.";
        }
        if (combos.size() >= MAX_COMBOS) {
            return "That's as many combos as you can have in a game.";
        }
        ComboState to = ComboState.of(seat.webController().getGame(), seat.webController().getPlayer());
        boolean loops = asked.equals(startedAsking) && from.step().equals(to.step()) && from.ready(to);
        combos.add(new Combo(nextId, name(name, "Combo " + nextId), List.copyOf(steps), from.changes(to), loops,
                ref == null || ref.isBlank() || ref.length() > 128 ? null : ref));
        nextId++;
        cancelRecording();
        return null;
    }

    private static String name(String s, String otherwise) {
        String n = s == null ? "" : s.strip();
        return n.isEmpty() ? otherwise : n.length() > MAX_NAME ? n.substring(0, MAX_NAME) : n;
    }

    public synchronized void rename(int id, String name) {
        combos.stream().filter(c -> c.id == id).forEach(c -> c.name = name(name, c.name));
    }

    public synchronized void remove(int id) {
        if (run == null || run.combo.id != id) {
            combos.removeIf(c -> c.id == id);
        }
    }

    // ---- running ----

    /** Runs a combo {@code times} (0: until stopped). Returns why it can't, or null. */
    public synchronized String run(int id, int times) {
        Combo combo = combos.stream().filter(c -> c.id == id).findFirst().orElse(null);
        if (combo == null || recording != null || run != null) {
            return recording != null ? "Stop recording first." : "It can't run now.";
        }
        if (!combo.loops && times != 1) {
            return "It doesn't end where it started, so it can only run once at a time.";
        }
        if (!combo.steps.get(0).asked().equals(asking())) {
            return "It can't start here: the game has to be where the recording started (you have priority, "
                    + (combo.steps.get(0).asked().equals("priority") ? "with nothing on the stack)." : "with the same on the stack).");
        }
        Run r = new Run(combo, times <= 0 ? MAX_LOOPS : Math.min(times, MAX_LOOPS), times <= 0);
        seat.waiting();
        run = r;
        table.started();
        Thread t = new Thread(r, "combo");
        t.setDaemon(true);
        t.start();
        return null;
    }

    /** Stops a run; the player carries on from wherever it is. */
    public void stop() {
        Run r = run;
        if (r != null) {
            r.stopped = true;
        }
    }

    /** One run, on its own thread: waits for the game to ask, and does the next step. */
    private final class Run implements Runnable {
        final Combo combo;
        final int times;
        final boolean untilStopped;
        volatile boolean stopped;
        volatile int loop;
        private int finished;
        /** Why a step couldn't be done (set on Forge's UI thread). */
        private volatile String failed;
        /** Cards already chosen for the prompt on screen (the next click should choose another one). */
        private final Set<Integer> chosen = new HashSet<>();
        private Input chosenFor;

        Run(Combo combo, int times, boolean untilStopped) {
            this.combo = combo;
            this.times = times;
            this.untilStopped = untilStopped;
        }

        @Override
        public void run() {
            int rewinds = table.rewinds();
            String why = null;
            long started = System.nanoTime();
            try {
                for (loop = 1; loop <= times && why == null; loop++) {
                    for (Step s : combo.steps) {
                        why = step(s, rewinds);
                        if (why != null) {
                            break;
                        }
                    }
                    if (why == null) {
                        finished++;
                    }
                }
                if (why == null) {
                    settle();
                }
            } catch (RuntimeException | InterruptedException e) {
                Logger.warn(e, "A combo run failed");
                why = "something went wrong";
            } finally {
                int done = why == null ? times : finished;
                Logger.info("Combo '{}': {} of {} loops in {} ms{}", combo.name, done, untilStopped ? "any" : times,
                        (System.nanoTime() - started) / 1_000_000, why == null ? "" : ", " + why);
                seat.notice(combo.name + ": ran " + done + (done == 1 ? " time" : " times")
                        + (why == null || why.isEmpty() ? "." : ", then stopped: " + why + "."));
                // On the thread the player's own moves go through: building the view works out what they can pay for.
                FThreads.invokeInEdtLater(() -> {
                    run = null;
                    table.ended();
                    seat.replay();
                });
            }
        }

        /** Does one step once the game asks for it. Returns why it couldn't ("" when the player stopped it), or null. */
        private String step(Step s, int rewinds) throws InterruptedException {
            long waitingSince = 0;
            while (true) {
                if (stopped) {
                    return "";
                }
                WebPlayerController c = seat.webController();
                if (c == null || seat.closed() || GameSession.isOver(c.getGame()) || c.getPlayer().hasLost()) {
                    return "the game is over";
                }
                if (table.rewinds() != rewinds) {
                    return "someone asked to rewind";
                }
                String asked = asking();
                if (s.asked().equals(asked)) {
                    break;
                }
                // Not our move: others may take all the time they need.
                if (asked == null) {
                    waitingSince = 0;
                } else if (waitingSince == 0) {
                    waitingSince = System.nanoTime();
                } else if (System.nanoTime() - waitingSince > PATIENCE_MS * 1_000_000) {
                    return asked.startsWith("priority | ") && !s.asked().startsWith(asked) ? "something else is on the stack" : "the game asks something else";
                }
                Thread.sleep(1);
            }
            return act(s);
        }

        private String act(Step s) throws InterruptedException {
            WebPlayerController c = seat.webController();
            Game g = c.getGame();
            if (s.kind().equals("answer")) {
                ObjectNode ask = seat.openAsk();
                JsonNode choice = ask == null ? null : choice(s.move(), ask);
                if (choice == null) {
                    return "the choices are different";
                }
                int id = ask.path("id").asInt();
                seat.answer(id, choice, s.move().path("text").asText(null));
                return until(() -> seat.openAsk() == null || seat.openAsk().path("id").asInt() != id) ? null : "the game didn't take the answer";
            }
            Input input = c.getInputQueue().getInput();
            if (input != chosenFor) {
                chosenFor = input;
                chosen.clear();
            }
            boolean priority = input instanceof InputPassPriority;
            boolean[] done = new boolean[1];
            failed = null;
            Card card = null;
            List<ManaTaps.Pick> picks = new ArrayList<>();
            if (s.kind().equals("card") || s.kind().equals("ability")) {
                card = s.card() == null ? null : s.card().find(g, chosen);
                if (card == null) {
                    return (s.card() == null ? "a card" : s.card().name()) + " isn't there";
                }
                chosen.add(card.getId());
            } else if (s.kind().equals("tapForMana")) {
                int i = 0;
                Set<Integer> tapped = new HashSet<>();
                for (JsonNode p : s.move().path("picks")) {
                    Card of = s.more().get(i) == null ? null : s.more().get(i).find(g, tapped);
                    Card source = s.more().get(i + 1) == null ? null : s.more().get(i + 1).id() == s.more().get(i).id() ? of : s.more().get(i + 1).find(g, Set.of());
                    i += 2;
                    if (of == null || source == null) {
                        return "a card to tap isn't there";
                    }
                    tapped.add(of.getId());
                    picks.add(new ManaTaps.Pick(of.getId(), source.getId(), p.path("ability").asInt(-1), p.path("choice").asText("")));
                }
            }
            Card on = card;
            Runnable move = () -> {
                if (c.getInputQueue().getInput() != input) {
                    failed = "the game moved on";
                    return;
                }
                switch (s.kind()) {
                    case "ok" -> Payment.ok(c, c.getPlayer());
                    case "cancel" -> c.selectButtonCancel();
                    case "player" -> {
                        Player p = g.getPlayer(s.move().path("id").asInt(-1));
                        if (p == null || p.hasLost()) {
                            failed = "that player is gone";
                        } else {
                            c.selectPlayer(p.getView(), null);
                        }
                    }
                    case "payPool" -> Payment.payPool(c, c.getPlayer(), s.move().path("color").asText(""));
                    default -> {
                        if (priority && Explain.noTargets(on, c.getPlayer(), s.move().has("label") ? -1 : null, s.move().path("label").asText(null))) {
                            failed = on.getName() + " has nothing to target";
                            return;
                        }
                        if (s.kind().equals("ability")) {
                            seat.prefer(-1, s.move().path("label").asText(null));
                        }
                        try {
                            if (!c.selectCard(on.getView(), null, null)) {
                                failed = on.getName() + " can't be used now";
                            }
                        } finally {
                            seat.prefer(null, null);
                        }
                    }
                }
            };
            Runnable guarded = () -> {
                try {
                    move.run();
                } catch (RuntimeException e) {
                    Logger.warn(e, "A combo step failed");
                    failed = "a step failed";
                } finally {
                    synchronized (done) {
                        done[0] = true;
                    }
                }
            };
            if (s.kind().equals("tapForMana")) {
                g.getAction().invoke(() -> {
                    if (ManaTaps.tap(g, c.getPlayer(), picks) < picks.size()) {
                        failed = "a card couldn't be tapped for mana";
                    }
                    synchronized (done) {
                        done[0] = true;
                    }
                });
            } else {
                FThreads.invokeInEdtLater(guarded);
            }
            // The click itself may ask something (which ability?), which is the next step.
            if (!until(() -> isDone(done) || seat.openAsk() != null)) {
                return "the game didn't react";
            }
            if (failed != null) {
                return failed;
            }
            if (seat.openAsk() != null || s.kind().equals("tapForMana")) {
                return null;
            }
            if (priority) {
                return until(() -> c.getInputQueue().getInput() != input || seat.openAsk() != null) ? failed : "the game didn't react";
            }
            if (input instanceof InputPayMana pay) {
                // A source being tapped, or Auto-pay going through them all: done when it's paid or waits for more.
                long end = System.nanoTime() + (s.kind().equals("ok") ? 400_000_000L : 60_000_000L);
                until(() -> c.getInputQueue().getInput() != input || seat.openAsk() != null
                        || (!pay.isActivatingManaAbility() && System.nanoTime() > end));
            }
            return failed;
        }

        private boolean isDone(boolean[] done) {
            synchronized (done) {
                return done[0];
            }
        }

        /** The last step's effects are over: the game asks for the next thing. */
        private void settle() throws InterruptedException {
            until(() -> asking() != null);
        }

        private boolean until(java.util.function.BooleanSupplier cond) throws InterruptedException {
            long end = System.nanoTime() + PATIENCE_MS * 1_000_000;
            while (!cond.getAsBoolean()) {
                if (System.nanoTime() > end) {
                    return false;
                }
                Thread.sleep(1);
            }
            return true;
        }

        /** The recorded answer for this question: the same options picked by what they say; null when they aren't there. */
        private JsonNode choice(JsonNode move, ObjectNode ask) {
            JsonNode was = move.path("ask").path("options");
            JsonNode now = ask.path("options");
            ArrayNode out = json.createArrayNode();
            if (!"choose".equals(ask.path("kind").asText()) && !"info".equals(ask.path("kind").asText())) {
                // Orders, splits and scrys are by position: the options have to be the same.
                if (was.size() != now.size()) {
                    return null;
                }
                for (int i = 0; i < was.size(); i++) {
                    if (!plain(was.get(i).path("label").asText()).equals(plain(now.get(i).path("label").asText()))) {
                        return null;
                    }
                }
                move.path("choice").forEach(out::add);
                return out;
            }
            Set<Integer> used = new HashSet<>();
            for (JsonNode i : move.path("choice")) {
                JsonNode option = was.get(i.asInt(-1));
                int at = option == null ? -1 : find(option, now, used);
                if (at < 0) {
                    return null;
                }
                used.add(at);
                out.add(at);
            }
            return out;
        }

        private int find(JsonNode option, JsonNode now, Set<Integer> used) {
            for (int i = 0; i < now.size(); i++) {
                if (!used.contains(i) && option.has("cardId") && option.path("cardId").asInt() == now.get(i).path("cardId").asInt(-1)) {
                    return i;
                }
            }
            for (int i = 0; i < now.size(); i++) {
                if (!used.contains(i) && plain(option.path("label").asText()).equals(plain(now.get(i).path("label").asText()))) {
                    return i;
                }
            }
            return -1;
        }
    }

    // ---- for the browser ----

    /**
     * For the player's own view: {@code {recording?: [step], running?: {id, loop, times?}, list: [{id, name, steps, gains, loops, ref?}]}},
     * or null when there's nothing.
     */
    synchronized ObjectNode json() {
        Run r = run;
        if (combos.isEmpty() && recording == null && r == null) {
            return null;
        }
        ObjectNode o = json.createObjectNode();
        if (recording != null) {
            ArrayNode steps = o.putArray("recording");
            recording.forEach(s -> steps.add(s.text()));
        }
        if (r != null) {
            ObjectNode n = o.putObject("running");
            n.put("id", r.combo.id);
            n.put("loop", Math.min(r.loop, r.times));
            if (!r.untilStopped) {
                n.put("times", r.times);
            }
        }
        ArrayNode list = o.putArray("list");
        for (Combo c : combos) {
            ObjectNode n = list.addObject();
            n.put("id", c.id);
            n.put("name", c.name);
            ArrayNode steps = n.putArray("steps");
            c.steps.forEach(s -> steps.add(s.text()));
            ArrayNode gains = n.putArray("gains");
            c.gains.forEach(gains::add);
            n.put("loops", c.loops);
            if (c.ref != null) {
                n.put("ref", c.ref);
            }
        }
        return o;
    }
}
