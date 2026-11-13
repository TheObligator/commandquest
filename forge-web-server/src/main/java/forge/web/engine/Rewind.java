package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.common.eventbus.AllowConcurrentEvents;
import com.google.common.eventbus.Subscribe;
import forge.game.Game;
import forge.game.GameLogEntry;
import forge.game.GameLogEntryType;
import forge.game.card.Card;
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
            String priorityPlayer, CombatState combat) {
        boolean sameStep(int t, PhaseType p) {
            return turn == t && phase == p;
        }
    }

    /** Somewhere a player may rewind to now: the point, the level that allows it, and what to show. */
    public record Option(int point, int level, String label, int turn, String phase, String player, boolean stepStart,
            String kind) {
    }

    private final class Request {
        final Player by;
        final Option target;
        /** For attackers / blockers: the declaration to click back in once it's asked again (null: none). */
        final Plan plan;
        final Set<Player> waiting = new LinkedHashSet<>();
        boolean approved;

        Request(Player by, Option target, Plan plan) {
            this.by = by;
            this.target = target;
            this.plan = plan;
        }
    }

    /**
     * A combat declaration to put back: {@code attackers} pairs are (attacker id, defender id, 1 if the defender is a
     * player), blockers pairs (blocker id, attacker id). {@code declarer} makes it.
     */
    record Plan(Player declarer, boolean attackers, List<int[]> pairs) {
    }

    /** After a combat rewind: the declaration waiting to be clicked back in. */
    private volatile Plan replan;
    private boolean watching;

    private final Game game;
    private final int level;
    private final GameMemento.Recorder recorder = new GameMemento.Recorder();
    private final List<Point> points = new ArrayList<>();   // oldest first
    private int nextId = 1;
    /** Something happened since the newest point. */
    private volatile boolean dirty = true;
    /** Between the start and end events of a restore: its own events aren't changes. */
    private volatile boolean restoring;
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

    // AllowConcurrentEvents: Guava would otherwise lock this object for every event, and a game ending on another
    // thread (Game.setGameOver holds the game's lock while it fires events) would deadlock with the game thread
    // here (which calls the synchronized Game.isGameOver). This class does its own locking.
    @Subscribe
    @AllowConcurrentEvents
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
        watchInputs();
        Plan stale = replan;
        if (stale != null) {
            PhaseType now = game.getPhaseHandler().getPhase();
            PhaseType declared = stale.attackers() ? PhaseType.COMBAT_DECLARE_ATTACKERS : PhaseType.COMBAT_DECLARE_BLOCKERS;
            if (now != null && !now.isBefore(declared)) {
                replan = null;   // the declaration came and went (or never came): forget it
            }
        }
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
                        name(ph.getPlayerTurn()), name(ph.getPriorityPlayer()), CombatState.of(ph.getCombat())));
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
                if (target.combat() != null) {
                    target.combat().restore(game);
                }
                replan = req.plan;
                game.getGameLog().truncateTo(target.logSize());
                game.getGameLog().add(GameLogEntryType.INFORMATION,
                        REWOUND + logLabel(req.target) + " (asked by " + name(req.by) + ").");
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

    /**
     * Who attacks whom and who blocks what. Forge keeps these in lazily built maps that {@link GameMemento} can't
     * look inside, so a rewind would leave the later attacks and blocks in place; each point keeps its own copy.
     * {@code attacks}: (attacker id, defender id, 1 if a player). {@code blocks}: (attacker id, blocker id).
     * {@code blocked}: (attacker id, 1 if its band is blocked, 0 if not), for bands where that was decided.
     */
    record CombatState(List<int[]> attacks, List<int[]> blocks, List<int[]> blocked) {
        static CombatState of(forge.game.combat.Combat c) {
            if (c == null) {
                return null;
            }
            List<int[]> attacks = new ArrayList<>();
            List<int[]> blocks = new ArrayList<>();
            List<int[]> blocked = new ArrayList<>();
            for (Card a : c.getAttackers()) {
                forge.game.GameEntity d = c.getDefenderByAttacker(a);
                if (d != null) {
                    attacks.add(new int[] {a.getId(), d.getId(), d instanceof Player ? 1 : 0});
                }
                for (Card b : c.getBlockers(a)) {
                    blocks.add(new int[] {a.getId(), b.getId()});
                }
                var band = c.getBandOfAttacker(a);
                if (band != null && band.isBlocked() != null) {
                    blocked.add(new int[] {a.getId(), band.isBlocked() ? 1 : 0});
                }
            }
            return new CombatState(attacks, blocks, blocked);
        }

        /**
         * Combat's lists of who attacks and blocks, its damage orders and its "last known" copies of combatants. Forge's
         * own way out of combat (removeFromCombat) leaves empty bands and those copies behind, which would make a
         * creature look like it's still attacking; so they're emptied outright and the saved state is added back.
         */
        private static final String[] COMBAT_LISTS = {"attackedByBands", "blockedBands", "attackersOrderedForDamageAssignment",
                "blockersOrderedForDamageAssignment", "lkiCache"};

        /** Makes the game's current combat say this again. */
        void restore(Game game) {
            forge.game.combat.Combat c = game.getPhaseHandler().getCombat();
            if (c == null) {
                return;
            }
            List<Card> touched = new ArrayList<>(c.getAttackers());
            touched.addAll(c.getAllBlockers());
            for (String name : COMBAT_LISTS) {
                try {
                    java.lang.reflect.Field f = forge.game.combat.Combat.class.getDeclaredField(name);
                    f.setAccessible(true);
                    Object list = ((com.google.common.base.Supplier<?>) f.get(c)).get();
                    if (list instanceof com.google.common.collect.Multimap<?, ?> m) {
                        m.clear();
                    } else if (list instanceof java.util.Map<?, ?> m) {
                        m.clear();
                    } else if (list instanceof java.util.Collection<?> col) {
                        col.clear();
                    }
                } catch (ReflectiveOperationException | RuntimeException e) {
                    Logger.warn(e, "Couldn't reset combat's {}", name);
                }
            }
            for (int[] x : attacks) {
                Card a = game.findById(x[0]);
                forge.game.GameEntity d = x[2] == 1 ? game.getPlayer(x[1]) : game.findById(x[1]);
                if (a != null && d != null) {
                    c.addAttacker(a, d);
                }
            }
            for (int[] x : blocks) {
                Card a = game.findById(x[0]);
                Card b = game.findById(x[1]);
                if (a != null && b != null && c.isAttacking(a)) {
                    c.addBlocker(a, b);
                }
            }
            for (int[] x : blocked) {
                Card a = game.findById(x[0]);
                var band = a == null ? null : c.getBandOfAttacker(a);
                if (band != null) {
                    band.setBlocked(x[1] == 1);
                }
            }
            touched.addAll(c.getAttackers());
            touched.addAll(c.getAllBlockers());
            for (Card t : touched) {
                t.updateAttackingForView();
                t.updateBlockingForView();
            }
        }
    }

    /** Watches each person's prompts, to click a declaration back in after a combat rewind. */
    private void watchInputs() {
        if (watching) {
            return;
        }
        watching = true;
        for (Player p : game.getPlayers()) {
            if (p.getController() instanceof PlayerControllerHuman h) {
                h.getInputQueue().addObserver((o, arg) -> onInput(p, h));
            }
        }
    }

    /** A prompt changed for {@code p}: if it's the declaration we're waiting for, click it back in. */
    private void onInput(Player p, PlayerControllerHuman h) {
        Plan plan = replan;
        if (plan == null || plan.declarer() != p) {
            return;
        }
        forge.gamemodes.match.input.Input in = h.getInputQueue().getInput();
        boolean match = plan.attackers() ? in instanceof forge.gamemodes.match.input.InputAttack
                : in instanceof forge.gamemodes.match.input.InputBlock;
        if (!match) {
            return;
        }
        replan = null;
        // Click once the game thread is waiting for the answer, as a person's clicks would: until then it's still
        // setting up the prompt (and syncing views) and the clicks would race it.
        Thread gameThread = Thread.currentThread();
        Thread waiter = new Thread(() -> {
            long until = System.currentTimeMillis() + 3000;
            while (gameThread.getState() != Thread.State.WAITING && gameThread.getState() != Thread.State.TIMED_WAITING
                    && System.currentTimeMillis() < until) {
                Thread.onSpinWait();
                try {
                    Thread.sleep(5);
                } catch (InterruptedException e) {
                    return;
                }
            }
            FThreads.invokeInEdtLater(() -> replay(plan, in));
        }, "rewind-replan");
        waiter.setDaemon(true);
        waiter.start();
    }

    /** Clicks a declaration back into its prompt (on Forge's UI thread). */
    private void replay(Plan plan, forge.gamemodes.match.input.Input in) {
        {   // (Forge ignores clicks on a prompt that's already over)
            for (int[] pair : plan.pairs()) {
                Card first = game.findById(pair[0]);
                if (plan.attackers()) {
                    if (pair[2] == 1) {
                        Player d = game.getPlayer(pair[1]);
                        if (d != null) {
                            in.selectPlayer(d, null);
                        }
                    } else {
                        Card d = game.findById(pair[1]);
                        if (d != null) {
                            in.selectCard(d, null, null);
                        }
                    }
                    if (first != null) {
                        var c = game.getPhaseHandler().getCombat();
                        if (c == null || !c.isAttacking(first)) {   // a click on an attacker takes it back
                            in.selectCard(first, null, null);
                        }
                    }
                } else {
                    Card attacker = game.findById(pair[1]);
                    var c = game.getPhaseHandler().getCombat();
                    if (attacker != null && first != null && (c == null || !c.isBlocking(first, attacker))) {
                        in.selectCard(attacker, null, null);   // which attacker the next click blocks
                        in.selectCard(first, null, null);      // (a click on a blocker of it takes the block back)
                    }
                }
            }
        }
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
        return request(by, point, TIMELINE);
    }

    /** {@code kind}: {@link #TIMELINE}, {@link #ATTACKERS} or {@link #BLOCKERS}. */
    public String request(Player by, int point, String kind) {
        synchronized (this) {
            String why = cantAsk(by);
            if (why != null) {
                return why;
            }
            Option target = options().stream().filter(o -> o.point() == point && o.kind().equals(kind)).findFirst().orElse(null);
            if (target == null) {
                return "You can't rewind to there.";
            }
            // Declaring again starts from what was declared: only the changes need making.
            Plan plan = kind.equals(ATTACKERS) ? attackPlan(null, false) : kind.equals(BLOCKERS) ? blockPlan(by, null, false) : null;
            return ask(by, target, plan);
        }
    }

    /**
     * {@code by} wants this creature of theirs in or out of the attack (or the blocks) declared this combat: a rewind
     * to just before they were declared, with the same declaration clicked back in, plus or minus this creature. Until
     * combat damage.
     */
    public String requestChange(Player by, int cardId) {
        synchronized (this) {
            String why = cantAsk(by);
            if (why != null) {
                return why;
            }
            Card card = game.findById(cardId);
            var combat = game.getPhaseHandler().getCombat();
            if (card == null || combat == null || card.getController() != by || !card.isCreature()
                    || !card.isInZone(forge.game.zone.ZoneType.Battlefield)) {
                return "That can't be changed now.";
            }
            boolean attacking = combat.getAttackingPlayer() == by;
            String kind = attacking ? ATTACKERS : BLOCKERS;
            Option target = options().stream().filter(o -> o.kind().equals(kind)).findFirst().orElse(null);
            if (target == null) {
                return attacking ? "Attackers can only be changed until combat damage." : "Blockers can only be changed in the declare blockers step.";
            }
            Plan plan = attacking ? attackPlan(card, true) : blockPlan(by, card, true);
            if (plan == null) {
                return "There's nothing for it to block.";
            }
            boolean in = attacking ? combat.isAttacking(card) : combat.isBlocking(card);
            String label = (attacking ? in ? "Stop attacking with " : "Attack with " : in ? "Stop blocking with " : "Block with ")
                    + card.getName() + (in ? "" : " too");
            return ask(by, new Option(target.point(), target.level(), label, target.turn(), target.phase(), target.player(),
                    false, kind), plan);
        }
    }

    private String cantAsk(Player by) {
        if (level == 0) {
            return "Rewinding is off in this game.";
        }
        if (by == null || by.hasLost() || game.isGameOver()) {
            return "You can't rewind now.";
        }
        if (pending != null) {
            return name(pending.by) + " already asked to rewind.";
        }
        return null;
    }

    /** This combat's attacks, with {@code toggle} added or taken out. */
    private Plan attackPlan(Card toggle, boolean change) {
        var combat = game.getPhaseHandler().getCombat();
        if (combat == null) {
            return null;
        }
        List<int[]> pairs = new ArrayList<>();
        java.util.Map<forge.game.GameEntity, Integer> often = new java.util.HashMap<>();
        boolean removed = false;
        for (Card a : combat.getAttackers()) {
            forge.game.GameEntity d = combat.getDefenderByAttacker(a);
            if (d == null) {
                continue;
            }
            if (change && a == toggle) {
                removed = true;
                continue;
            }
            often.merge(d, 1, Integer::sum);
            pairs.add(new int[] {a.getId(), d.getId(), d instanceof Player ? 1 : 0});
        }
        if (change && !removed) {
            // the defender most of the others attack, else the first one there is
            forge.game.GameEntity d = often.entrySet().stream().max(java.util.Map.Entry.comparingByValue())
                    .map(java.util.Map.Entry::getKey).orElse(combat.getDefenders().isEmpty() ? null : combat.getDefenders().get(0));
            if (d == null) {
                return null;
            }
            pairs.add(new int[] {toggle.getId(), d.getId(), d instanceof Player ? 1 : 0});
        }
        return new Plan(combat.getAttackingPlayer(), true, pairs);
    }

    /** {@code by}'s blocks this combat, with {@code toggle} added (to an attacker coming at them) or taken out. */
    private Plan blockPlan(Player by, Card toggle, boolean change) {
        var combat = game.getPhaseHandler().getCombat();
        if (combat == null) {
            return null;
        }
        List<int[]> pairs = new ArrayList<>();
        boolean removed = false;
        for (Card a : combat.getAttackers()) {
            for (Card b : combat.getBlockers(a)) {
                if (b.getController() != by) {
                    continue;
                }
                if (change && b == toggle) {
                    removed = true;
                    continue;
                }
                pairs.add(new int[] {b.getId(), a.getId()});
            }
        }
        if (change && !removed) {
            Card attacker = combat.getAttackersOf(by).stream().findFirst()
                    .orElse(combat.getAttackers().isEmpty() ? null : combat.getAttackers().get(0));
            if (attacker == null) {
                return null;
            }
            pairs.add(new int[] {toggle.getId(), attacker.getId()});
        }
        return new Plan(by, false, pairs);
    }

    /** Opens a request (or does it at once, alone at the table). Holding this object's lock. */
    private String ask(Player by, Option target, Plan plan) {
        boolean kick;
        {
            Request r = new Request(by, target, plan);
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
        FThreads.invokeInEdtLater(changed);   // not under this lock: refreshing reads the view
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
            out.add(new Option(p.id(), needs, label, p.turn(), stepName(p), p.turnPlayer(), start, TIMELINE));
        }
        combat(out, turn, phase);
        return out;
    }

    /** Option kinds: a moment on the timeline, or declaring attackers or blockers again. */
    public static final String TIMELINE = "timeline", ATTACKERS = "attackers", BLOCKERS = "blockers";

    /**
     * Until combat damage, attackers and then blockers can be declared again, whatever the host's level (as long as
     * rewinding is on): back to the last moment before they were declared, the end of the step before.
     */
    private void combat(List<Option> out, int turn, PhaseType phase) {
        if (phase != PhaseType.COMBAT_DECLARE_ATTACKERS && phase != PhaseType.COMBAT_DECLARE_BLOCKERS) {
            return;
        }
        Point beforeAttacks = lastIn(turn, PhaseType.COMBAT_BEGIN);
        if (beforeAttacks != null) {
            out.add(new Option(beforeAttacks.id(), 1, "Change attackers", turn, stepName(beforeAttacks),
                    beforeAttacks.turnPlayer(), false, ATTACKERS));
        }
        Point beforeBlocks = phase == PhaseType.COMBAT_DECLARE_BLOCKERS ? lastIn(turn, PhaseType.COMBAT_DECLARE_ATTACKERS) : null;
        if (beforeBlocks != null) {
            out.add(new Option(beforeBlocks.id(), 1, "Change blockers", turn, stepName(beforeBlocks),
                    beforeBlocks.turnPlayer(), false, BLOCKERS));
        }
    }

    /** The newest point of that step of that turn. */
    private Point lastIn(int turn, PhaseType phase) {
        for (int i = points.size() - 1; i >= 0; i--) {
            Point p = points.get(i);
            if (p.sameStep(turn, phase)) {
                return p;
            }
            if (p.turn() < turn) {
                break;
            }
        }
        return null;
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

    /** "Before: X" → "before X", "Start of …" → "the start of …", combat → "declare … again". */
    private static String logLabel(Option o) {
        if (!o.kind().equals(TIMELINE)) {
            return "declare " + o.kind() + " again";
        }
        String label = o.label();
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
            x.put("kind", opt.kind());
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
