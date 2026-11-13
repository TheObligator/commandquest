package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.common.eventbus.Subscribe;
import forge.game.Game;
import forge.game.GameLogEntry;
import forge.game.GameLogEntryType;
import forge.game.event.GameEvent;
import forge.game.event.GameEventCardStatsChanged;
import forge.game.event.GameEventPlayerPriority;
import forge.game.event.GameEventPlayerStatsChanged;
import forge.game.event.GameEventSnapshotRestored;
import forge.game.phase.PhaseHandler;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.undo.GameMemento;
import forge.gamemodes.match.YieldUpdate;
import forge.gamemodes.match.input.InputPassPriority;
import forge.gui.FThreads;
import forge.player.PlayerControllerHuman;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.tinylog.Logger;

/**
 * Rewinding the game (docs/rewind.md). The host picks how far back players may ask to go, from 0 (off) to 4:
 * <ol>
 * <li>undo the last action,</li>
 * <li>back to the start of this step or phase,</li>
 * <li>back to any step or phase earlier this turn,</li>
 * <li>back into the previous turn (a whole turn).</li>
 * </ol>
 * The game is saved (Forge's {@link GameMemento}, which keeps only what changed) each time a player is about to get
 * priority, and put back at that same point: rewinding happens on the game thread when the next player is about to
 * get priority, so Forge carries on as if that earlier priority had just come round. When other people are playing,
 * every one of them has to agree first; AI seats always agree.
 */
public final class Rewind {

    public static final int MAX_LEVEL = 4;
    /** How the game log line about a rewind starts. */
    static final String REWOUND = "Rewound to ";
    /** Saved points kept at most, and the heap their history may pin (oldest dropped first). */
    private static final int MAX_POINTS = 800;
    private static final long MAX_BYTES = Math.min(512L << 20, Runtime.getRuntime().maxMemory() / 6);

    /** A saved moment: a player was about to get priority. */
    private record Point(int id, GameMemento memento, int logSize, int turn, PhaseType phase, String turnPlayer,
            String priorityPlayer) {
        boolean sameStep(int t, PhaseType p) {
            return turn == t && phase == p;
        }
    }

    /** Somewhere a player may rewind to now: the point, the level that allows it, and what to show. */
    public record Option(int point, int level, String label, int turn, String phase, String player, boolean stepStart) {
    }

    private final class Request {
        final Player by;
        final Option target;
        final Set<Player> waiting = new LinkedHashSet<>();
        boolean approved;

        Request(Player by, Option target) {
            this.by = by;
            this.target = target;
        }
    }

    private final Game game;
    private final int level;
    private final GameMemento.Recorder recorder = new GameMemento.Recorder();
    private final List<Point> points = new ArrayList<>();   // oldest first
    private int nextId = 1;
    /** Something happened since the newest point. */
    private boolean dirty = true;
    /** Between the start and end events of a restore: its own events aren't changes. */
    private boolean restoring;
    private int lostPlayers;
    private Request pending;
    /** The last thing that happened to a request, for everyone to see once (e.g. "Bob declined"). */
    private String note;
    private int noteId;
    private Runnable changed = () -> { };

    public Rewind(Game game, int level) {
        this.game = game;
        this.level = Math.max(0, Math.min(MAX_LEVEL, level));
    }

    public int level() {
        return level;
    }

    /** Called (on any thread) when something players see about rewinding changed outside a game event. */
    public void onChange(Runnable r) {
        changed = r == null ? () -> { } : r;
    }

    // ---- the game thread ----

    @Subscribe
    public void onEvent(GameEvent ev) {
        if (level == 0) {
            return;
        }
        if (ev instanceof GameEventSnapshotRestored r) {
            restoring = r.start();
            if (!r.start()) {
                dirty = false;
            }
            return;
        }
        if (restoring) {
            return;
        }
        if (ev instanceof GameEventPlayerPriority) {
            onPriority();
        } else {
            dirty = true;
        }
    }

    /** A player is about to get priority: rewind now if that was agreed, else save this moment if it's new. */
    private void onPriority() {
        Request go;
        synchronized (this) {
            go = pending != null && pending.approved ? pending : null;
        }
        if (go != null) {
            execute(go);
            return;
        }
        if (game.isGameOver()) {
            return;
        }
        PhaseHandler ph = game.getPhaseHandler();
        synchronized (this) {
            Point last = points.isEmpty() ? null : points.get(points.size() - 1);
            if (!dirty && last != null && last.sameStep(ph.getTurn(), ph.getPhase())) {
                return;   // only priority moved on: rewinding to the newest point gives the same game
            }
            int lost = (int) game.getRegisteredPlayers().stream().filter(Player::hasLost).count();
            if (lost != lostPlayers) {
                // A player left the game: Forge has told everyone and cleaned up after them. No going back past that.
                lostPlayers = lost;
                points.clear();
                recorder.detach();
                if (pending != null) {
                    say("Rewind cancelled: a player left the game.");
                    pending = null;
                }
            }
            try {
                GameMemento m = recorder.capture(game);
                points.add(new Point(nextId++, m, game.getGameLog().size(), ph.getTurn(), ph.getPhase(),
                        name(ph.getPlayerTurn()), name(ph.getPriorityPlayer())));
                dirty = false;
            } catch (RuntimeException | OutOfMemoryError e) {
                Logger.warn(e, "Couldn't save the game for rewinding");
                points.clear();
                recorder.reset();
                return;
            }
            prune();
        }
    }

    /** Keeps only the points someone could still rewind to, within the size limits. */
    private void prune() {
        int keepFrom = points.size() - 1;
        for (Option o : options()) {
            keepFrom = Math.min(keepFrom, indexOf(o.point()));
        }
        if (level >= 2) {
            // the start of this step: next step it's where "back to the previous step" goes
            int start = stepStart(points.size() - 1);
            keepFrom = Math.min(keepFrom, start);
        }
        if (pending != null) {
            // while people decide, the game goes on: keep where they're deciding about
            int asked = indexOf(pending.target.point());
            if (asked >= 0) {
                keepFrom = Math.min(keepFrom, asked);
            }
        }
        if (keepFrom > 0) {
            points.subList(0, keepFrom).clear();
        }
        while (points.size() > 2 && (points.size() > MAX_POINTS || retainedBytes() > MAX_BYTES)
                && (pending == null || points.get(0).id() != pending.target.point())) {
            points.remove(0);
        }
    }

    private long retainedBytes() {
        long n = recorder.liveBytes();
        for (Point p : points) {
            n += p.memento().retainedBytes();
        }
        return n;
    }

    /** Game thread, at a priority: puts the game back to the agreed point. */
    private void execute(Request req) {
        Point target;
        synchronized (this) {
            pending = null;
            int i = indexOf(req.target.point());
            target = i < 0 ? null : points.get(i);
            if (target == null) {
                say("Rewind cancelled: that point is no longer saved.");
                changed.run();
                return;
            }
        }
        game.fireEvent(new GameEventSnapshotRestored(true));
        boolean ok;
        try {
            ok = target.memento().restore();
        } catch (RuntimeException e) {
            Logger.error(e, "Rewind failed");
            ok = false;
        }
        synchronized (this) {
            if (!ok) {
                // nothing was written: the history is unusable, but the game is as it was
                points.clear();
                recorder.reset();
                say("Rewind failed: the game carries on from here.");
            } else {
                if (!target.memento().problems.isEmpty()) {
                    Logger.warn("Rewind problems: {}", target.memento().problems);
                }
                points.subList(indexOf(target.id()) + 1, points.size()).clear();
                game.getGameLog().truncateTo(target.logSize());
                game.getGameLog().add(GameLogEntryType.INFORMATION,
                        REWOUND + logLabel(req.target.label()) + " (asked by " + name(req.by) + ").");
                say("Rewound: " + req.target.label());
            }
        }
        if (ok) {
            refreshViews();
            for (Player p : game.getPlayers()) {
                // an auto-pass set after that point would skip straight past it again
                if (p.getController() instanceof PlayerControllerHuman h) {
                    h.applyYieldUpdate(new YieldUpdate.ClearMarker(p.getView()));
                    h.applyYieldUpdate(new YieldUpdate.SetAutoPassUntilEndOfTurn(p.getView(), false));
                }
            }
        }
        game.fireEvent(new GameEventSnapshotRestored(false));
        if (ok) {
            PhaseHandler ph = game.getPhaseHandler();
            game.fireEvent(new GameEventPlayerPriority(PlayerView.get(ph.getPlayerTurn()), ph.getPhase(),
                    PlayerView.get(ph.getPriorityPlayer())));
        }
        changed.run();
    }

    private void refreshViews() {
        game.getTriggerHandler().resetActiveTriggers();
        for (Player p : game.getPlayers()) {
            p.updateAllZonesForView();
            p.updateManaForView();
        }
        game.updateStackForView();
        game.updatePhaseForView();
        game.updatePlayerTurnForView();
        game.updateTurnForView();
        game.updateCombatForView();
        game.fireEvent(new GameEventCardStatsChanged(game.getCardsInGame()));
        game.fireEvent(new GameEventPlayerStatsChanged(game.getPlayers()));
    }

    // ---- requests (any thread) ----

    /** {@code by} asks to rewind to {@code point}. Returns why not, or null when asked (or done, alone). */
    public String request(Player by, int point) {
        boolean kick;
        synchronized (this) {
            if (level == 0) {
                return "Rewinding is off in this game.";
            }
            if (by == null || by.hasLost() || game.isGameOver()) {
                return "You can't rewind now.";
            }
            if (pending != null) {
                return name(pending.by) + " already asked to rewind.";
            }
            Option target = options().stream().filter(o -> o.point() == point).findFirst().orElse(null);
            if (target == null) {
                return "You can't rewind to there.";
            }
            Request r = new Request(by, target);
            for (Player p : game.getPlayers()) {
                if (p != by && !p.hasLost() && p.getController() instanceof PlayerControllerHuman) {
                    r.waiting.add(p);
                }
            }
            r.approved = r.waiting.isEmpty();
            pending = r;
            kick = r.approved;
            if (!kick) {
                say(name(by) + " asks to rewind: " + target.label());
            }
        }
        if (kick) {
            kick();
        }
        changed.run();
        return null;
    }

    /** {@code who} answers the open request. */
    public String vote(Player who, boolean yes) {
        boolean kick = false;
        synchronized (this) {
            if (pending == null || pending.approved || !pending.waiting.contains(who)) {
                return "There's nothing to answer.";
            }
            if (!yes) {
                say(name(who) + " declined to rewind.");
                pending = null;
            } else {
                pending.waiting.remove(who);
                if (pending.waiting.isEmpty()) {
                    pending.approved = true;
                    kick = true;
                }
            }
        }
        if (kick) {
            kick();
        }
        changed.run();
        return null;
    }

    /** The asker takes the request back (before it happens). */
    public String cancel(Player who) {
        synchronized (this) {
            if (pending == null || pending.by != who) {
                return "There's nothing to cancel.";
            }
            pending = null;
            say(name(who) + " took back the rewind request.");
        }
        changed.run();
        return null;
    }

    /** A player left (or the game ended): don't keep everyone waiting on them. */
    public void playerLeft(Player p) {
        boolean kick = false;
        synchronized (this) {
            if (pending == null) {
                return;
            }
            if (pending.by == p) {
                pending = null;
            } else if (pending.waiting.remove(p) && pending.waiting.isEmpty()) {
                pending.approved = true;
                kick = true;
            }
        }
        if (kick) {
            kick();
        }
        changed.run();
    }

    /**
     * The rewind was agreed: it happens at the next priority. If a person is sitting at their priority prompt, that's
     * now; end their prompt without an answer, and Forge asks again, which is that next priority.
     */
    private void kick() {
        for (Player p : game.getPlayers()) {
            if (p.getController() instanceof PlayerControllerHuman h
                    && h.getInputQueue().getInput() instanceof InputPassPriority inp) {
                FThreads.invokeInEdtLater(inp::restartPrompt);
            }
        }
    }

    private void say(String text) {
        note = text;
        noteId++;
    }

    // ---- what players see ----

    /**
     * The timeline players may rewind along now, newest first: every saved moment within the host's limit, with the
     * level that allows it and what happened right after it (what rewinding there takes back).
     */
    synchronized List<Option> options() {
        List<Option> out = new ArrayList<>();
        int n = points.size();
        if (level == 0 || n == 0 || game.isGameOver()) {
            return out;
        }
        PhaseHandler ph = game.getPhaseHandler();
        int turn = ph.getTurn();
        PhaseType phase = ph.getPhase();
        // Does the game still look exactly like the newest point? Then that one isn't a rewind.
        boolean atNewest = !dirty && points.get(n - 1).sameStep(turn, phase);
        int newest = atNewest ? n - 2 : n - 1;
        if (newest < 0) {
            return out;
        }
        int thisStep = stepStart(newest);
        List<GameLogEntry> log = game.getGameLog().getAllEntries();
        for (int i = newest; i >= 0; i--) {
            Point p = points.get(i);
            int needs;
            if (i == newest) {
                needs = 1;
            } else if (i >= thisStep || p.sameStep(turn, phase)) {
                needs = 2;
            } else if (p.turn() == turn) {
                needs = 3;
            } else if (p.turn() == turn - 1) {
                needs = 4;
            } else {
                break;   // older than any level reaches
            }
            if (needs > level) {
                break;
            }
            int logEnd = i + 1 < n ? points.get(i + 1).logSize() : log.size();
            String did = action(log, p.logSize(), logEnd);
            boolean start = stepStart(i) == i;
            if (did == null && !start && !out.isEmpty()) {
                continue;   // nothing to show: priority just moved on (the step's start or the action before covers it)
            }
            String label = did != null ? "Before: " + did
                    : start ? "Start of " + where(p, turn)
                    : p.priorityPlayer() + " had priority";
            out.add(new Option(p.id(), needs, label, p.turn(), stepName(p), p.turnPlayer(), start));
        }
        return out;
    }

    /** Index of the first point of the step point {@code i} is in. */
    private int stepStart(int i) {
        Point p = points.get(i);
        while (i > 0 && points.get(i - 1).sameStep(p.turn(), p.phase())) {
            i--;
        }
        return i;
    }

    private int indexOf(int id) {
        for (int i = 0; i < points.size(); i++) {
            if (points.get(i).id() == id) {
                return i;
            }
        }
        return -1;
    }

    /** What the game log says happened between two of its sizes (the first line that isn't about phases or mana). */
    private static String action(List<GameLogEntry> log, int from, int to) {
        for (int i = from; i < Math.min(to, log.size()); i++) {
            GameLogEntry e = log.get(i);
            if (e.type() != GameLogEntryType.PHASE && e.type() != GameLogEntryType.TURN && e.type() != GameLogEntryType.MANA
                    && !(e.type() == GameLogEntryType.INFORMATION && e.message().startsWith(REWOUND))) {
                String m = e.message();
                return m.length() > 90 ? m.substring(0, 87) + "…" : m;
            }
        }
        return null;
    }

    /** "Before: X" → "before X", "Start of …" → "the start of …". */
    private static String logLabel(String label) {
        if (label.startsWith("Before: ")) {
            return "before " + label.substring(8);
        }
        if (label.startsWith("Start of ")) {
            return "the start of " + label.substring(9);
        }
        return "when " + label;
    }

    private static String stepName(Point p) {
        return p.phase() == null ? "?" : p.phase().nameForUi;
    }

    private static String where(Point p, int currentTurn) {
        if (p.turn() == currentTurn) {
            return stepName(p);
        }
        return stepName(p) + " (turn " + p.turn() + ", " + p.turnPlayer() + ")";
    }

    private static String name(Player p) {
        return p == null ? "?" : p.getName();
    }

    /** The {@code rewind} part of {@code me}'s view. */
    public synchronized ObjectNode json(ObjectMapper json, Player me) {
        ObjectNode o = json.createObjectNode();
        o.put("level", level);
        if (level == 0) {
            return o;
        }
        ArrayNode opts = o.putArray("options");
        for (Option opt : options()) {
            ObjectNode x = opts.addObject();
            x.put("point", opt.point());
            x.put("level", opt.level());
            x.put("label", opt.label());
            x.put("turn", opt.turn());
            x.put("phase", opt.phase());
            x.put("player", opt.player());
            x.put("stepStart", opt.stepStart());
        }
        if (pending != null) {
            ObjectNode p = o.putObject("pending");
            p.put("by", name(pending.by));
            p.put("mine", pending.by == me);
            p.put("label", pending.target.label());
            p.put("approved", pending.approved);
            p.put("needsMe", pending.waiting.contains(me));
            ArrayNode w = p.putArray("waitingOn");
            pending.waiting.forEach(x -> w.add(name(x)));
        }
        if (note != null) {
            o.put("note", note);
            o.put("noteId", noteId);
        }
        return o;
    }
}
