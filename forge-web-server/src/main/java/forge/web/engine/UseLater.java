package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import forge.game.Game;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.phase.PhaseHandler;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * "Use later" (docs/use-later.md): activated abilities a player has put off to a step, e.g. a fetch
 * land for the end step before their turn. When the step comes and the stack is empty,
 * {@link WebPlayerController} uses the ability for them, or stops them there to decide. A card that
 * would be lost first stops them too, so they can still use it in response.
 */
public final class UseLater {

    static final int MAX_ENTRIES = 50;
    static final int MAX_LABEL = 2000;

    /** When to use it. {@code STEP}: a step of someone's turn ({@link Spec#phase}, {@link Spec#whose}). */
    public enum When { BEFORE_MY_TURN, MY_UPKEEP, NEXT_END, STEP }

    /** Whose turn, for {@link When#STEP}; anything else is a player's id. */
    static final String ME = "ME";
    static final String OPPONENTS = "OPP";

    /**
     * {@code ask}: stop there instead of using it. {@code everyTurn}: each time the step comes, not
     * just once. {@code everyCopy}: any copy of the card you have (each time, too).
     */
    public record Spec(When when, PhaseType phase, String whose, boolean ask, boolean everyTurn, boolean everyCopy) {
        public Spec {
            everyTurn |= everyCopy;
        }

        boolean once() {
            return !everyTurn;
        }

        /** From the browser or a saved deck; null when it makes no sense. */
        public static Spec of(JsonNode n) {
            try {
                When when = When.valueOf(n.path("when").asText(""));
                PhaseType phase = null;
                String whose = null;
                if (when == When.STEP) {
                    phase = PhaseType.valueOf(n.path("phase").asText(""));
                    whose = n.path("whose").asText("");
                    if (NO_PRIORITY.contains(phase) || !whose.matches(ME + "|" + OPPONENTS + "|\\d{1,9}")) {
                        return null;
                    }
                }
                return new Spec(when, phase, whose, n.path("ask").asBoolean(false),
                        n.path("everyTurn").asBoolean(false), n.path("everyCopy").asBoolean(false));
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
    }

    /** Steps nobody gets priority in, so nothing can be used there. */
    private static final Set<PhaseType> NO_PRIORITY = EnumSet.of(PhaseType.UNTAP, PhaseType.CLEANUP);

    private static final ZoneType[] ZONES = {
        ZoneType.Battlefield, ZoneType.Hand, ZoneType.Graveyard, ZoneType.Exile, ZoneType.Command,
    };

    private static final class Entry {
        final int id;
        /** The card, or -1 for every copy of it. */
        final int cardId;
        final ZoneType zone;
        final String card;
        final String label;
        final Spec spec;
        /** Where the game was when it was set: that moment itself isn't "the next" one. */
        final int setTurn;
        final PhaseType setPhase;
        boolean sawAnotherTurn;
        /** The cards already dealt with in the step {@link #doneKey}. */
        final Set<Integer> done = new HashSet<>();
        String doneKey = "";
        /** Stack items the player has already been stopped for. */
        final Set<Integer> warned = new HashSet<>();
        /** The player is being asked about it now: why, and (for a threat) that it's only a warning. */
        String due;
        boolean threat;
        /** The card that's about. */
        int dueCard;

        Entry(int id, int cardId, ZoneType zone, String card, String label, Spec spec, int setTurn, PhaseType setPhase) {
            this.id = id;
            this.cardId = cardId;
            this.zone = zone;
            this.card = card;
            this.label = label;
            this.spec = spec;
            this.setTurn = setTurn;
            this.setPhase = setPhase;
        }
    }

    /** What to do now: use {@code ability}, or {@code stop} the player; {@code notice} tells them. */
    public record Next(SpellAbility ability, boolean stop, String notice) {
        static final Next NOTHING = new Next(null, false, null);
    }

    private final List<Entry> entries = new ArrayList<>();
    private int nextId = 1;

    // ---- which abilities ----

    /** Can this ability be put off? Activated abilities that aren't mana or loyalty abilities. */
    public static boolean applies(SpellAbility sa) {
        return sa.isActivatedAbility() && !sa.isManaAbility() && !sa.isPwAbility();
    }

    static String label(SpellAbility sa) {
        return sa.getView().getDescription();
    }

    /** The ability of {@code card} with this text, if {@code me} can use it right now; else null. Game thread. */
    static SpellAbility usable(Card card, String label, Player me) {
        for (SpellAbility sa : card.getAllPossibleAbilities(me, true)) {
            if (applies(sa) && label.equals(label(sa)) && Explain.hasTargets(sa, me) && Explain.affordable(sa, me)) {
                return sa;
            }
        }
        return null;
    }

    // ---- setting it ----

    /** Puts an ability off. Returns why it can't be, or null. */
    public synchronized String set(Game g, Player me, Card card, String label, Spec spec) {
        Zone zone = card == null ? null : g.getZoneOf(card);
        if (zone == null || spec == null || label == null || label.isBlank() || label.length() > MAX_LABEL
                || card.getAllPossibleAbilities(me, false).stream().noneMatch(sa -> applies(sa) && label.equals(label(sa)))) {
            return "That can't be used later.";
        }
        entries.removeIf(e -> e.label.equals(label) && (e.cardId == card.getId() || (spec.everyCopy() && e.card.equals(card.getName()))));
        if (entries.size() >= MAX_ENTRIES) {
            return "That's as many as can wait at once.";
        }
        PhaseHandler ph = g.getPhaseHandler();
        entries.add(new Entry(nextId++, spec.everyCopy() ? -1 : card.getId(), zone.getZoneType(), card.getName(), label, spec,
                ph.getTurn(), ph.getPhase()));
        return null;
    }

    public synchronized void cancel(int id) {
        entries.removeIf(e -> e.id == id);
    }

    /** The player leaves it for now: no longer asked about. */
    public synchronized void leave(int id) {
        for (Entry e : List.copyOf(entries)) {
            if (e.id == id) {
                settle(e);
            }
        }
    }

    /** What's saved with the player's deck: {@code [{card, text, when, phase?, whose?, ask?}]}, each for every copy. */
    public synchronized void seed(JsonNode saved) {
        if (!saved.isArray()) {
            return;
        }
        for (JsonNode n : saved) {
            Spec s = Spec.of(n);
            String text = n.path("text").asText("");
            String card = n.path("card").asText("");
            if (s != null && !text.isBlank() && !card.isBlank() && text.length() <= MAX_LABEL && entries.size() < MAX_ENTRIES) {
                entries.add(new Entry(nextId++, -1, null, card, text, new Spec(s.when(), s.phase(), s.whose(), s.ask(), true, true), -1, null));
            }
        }
    }

    // ---- the game thread: the player is about to get priority ----

    /** What to do as {@code me} gets priority. */
    public synchronized Next next(Game g, Player me) {
        if (entries.isEmpty()) {
            return Next.NOTHING;
        }
        PhaseHandler ph = g.getPhaseHandler();
        boolean mine = ph.isPlayerTurn(me);
        entries.removeIf(e -> e.cardId >= 0 && !there(g, e));
        if (!mine) {
            entries.forEach(e -> e.sawAnotherTurn = true);
        }
        if (!g.getStack().isEmpty()) {
            return threat(g, me);
        }
        String key = ph.getTurn() + "/" + ph.getPhase();
        StringBuilder couldnt = new StringBuilder();
        boolean stop = false;
        for (Entry e : List.copyOf(entries)) {
            if (e.threat) {
                e.due = null;       // what threatened it is gone
                e.threat = false;
            }
            if (missed(e, mine, ph)) {
                if (e.due == null) {
                    e.due = "The end step before your turn didn't come.";
                    e.dueCard = e.cardId;
                    stop = true;
                }
                continue;
            }
            if (!now(e, g, me)) {
                if (e.due != null) {
                    settle(e);      // asked about in a step that's over
                }
                continue;
            }
            if (!key.equals(e.doneKey)) {
                e.doneKey = key;
                e.done.clear();
            }
            for (Card card : cards(e, g, me)) {
                if (!e.done.add(card.getId())) {
                    continue;
                }
                SpellAbility sa = usable(card, e.label, me);
                if (sa == null) {
                    if (e.spec.once()) {
                        entries.remove(e);
                        couldnt.append(couldnt.isEmpty() ? "" : " ").append("Couldn't use ").append(card.getName()).append(" now.");
                    }
                    continue;
                }
                if (e.spec.ask()) {
                    e.due = step(ph, me) + ".";
                    e.dueCard = card.getId();
                    stop = true;
                    continue;
                }
                if (e.spec.once()) {
                    entries.remove(e);
                }
                return new Next(sa, false, null);
            }
        }
        return new Next(null, stop || !couldnt.isEmpty(), couldnt.isEmpty() ? null : couldnt.toString());
    }

    /** The player passed priority: what they were asked about, they left. */
    public synchronized void passed() {
        for (Entry e : List.copyOf(entries)) {
            settle(e);
        }
    }

    private void settle(Entry e) {
        if (e.due == null) {
            return;
        }
        boolean warning = e.threat;
        e.due = null;
        e.threat = false;
        if (!warning && e.spec.once()) {
            entries.remove(e);
        }
    }

    /** The player used this ability: it isn't waiting any more. */
    public synchronized void used(int cardId, String label) {
        entries.removeIf(e -> e.cardId == cardId && e.label.equals(label) && e.spec.once());
        entries.forEach(e -> {
            if (e.label.equals(label) && e.due != null) {
                e.due = null;
                e.threat = false;
            }
        });
    }

    /** The player is being asked about one of them. */
    public synchronized boolean asking() {
        return entries.stream().anyMatch(e -> e.due != null);
    }

    /** The cards waiting to be used, for Auto-pay to leave alone. */
    public synchronized Set<Integer> waitingCards() {
        Set<Integer> out = new HashSet<>();
        entries.forEach(e -> {
            if (e.cardId >= 0) {
                out.add(e.cardId);
            }
        });
        return out;
    }

    /** The abilities waiting on one card each (for Auto-pay to keep mana for). Game or forge-ui thread. */
    public synchronized List<SpellAbility> waiting(Game g, Player me) {
        List<SpellAbility> out = new ArrayList<>();
        for (Entry e : entries) {
            Card card = e.cardId < 0 ? null : g.findById(e.cardId);
            if (card == null || !there(g, e)) {
                continue;
            }
            card.getAllPossibleAbilities(me, false).stream()
                    .filter(sa -> applies(sa) && e.label.equals(label(sa))).findFirst().ifPresent(out::add);
        }
        return out;
    }

    private static boolean there(Game g, Entry e) {
        Card c = g.findById(e.cardId);
        Zone z = c == null ? null : g.getZoneOf(c);
        return z != null && z.getZoneType() == e.zone;
    }

    /** The cards it's about now: that one, or your copies. */
    private static List<Card> cards(Entry e, Game g, Player me) {
        if (e.cardId >= 0) {
            Card c = g.findById(e.cardId);
            return c == null ? List.of() : List.of(c);
        }
        List<Card> out = new ArrayList<>();
        for (ZoneType z : ZONES) {
            for (Card c : me.getCardsIn(z).threadSafeIterable()) {
                if (c.getName().equals(e.card)) {
                    out.add(c);
                }
            }
        }
        return out;
    }

    /** Is this the moment it waits for? */
    private static boolean now(Entry e, Game g, Player me) {
        PhaseHandler ph = g.getPhaseHandler();
        PhaseType phase = ph.getPhase();
        if (ph.getTurn() == e.setTurn && phase == e.setPhase) {
            return false;   // set in this very step: it's for the next one
        }
        boolean mine = ph.isPlayerTurn(me);
        return switch (e.spec.when()) {
            case BEFORE_MY_TURN -> phase == PhaseType.END_OF_TURN && !mine && ph.getNextTurn() == me;
            case MY_UPKEEP -> phase == PhaseType.UPKEEP && mine;
            case NEXT_END -> phase == PhaseType.END_OF_TURN;
            case STEP -> phase == e.spec.phase() && switch (e.spec.whose()) {
                case ME -> mine;
                case OPPONENTS -> !mine;
                default -> e.spec.whose().equals(String.valueOf(ph.getPlayerTurn().getId()));
            };
        };
    }

    /** It waited for the end step before the player's turn, and their turn came without one (the turn was ended). */
    private static boolean missed(Entry e, boolean mine, PhaseHandler ph) {
        return e.spec.when() == When.BEFORE_MY_TURN && e.spec.once() && mine && e.sawAnotherTurn && ph.getTurn() > e.setTurn;
    }

    /** With something on the stack: would the card be lost to the top item? Stops the player once for each. */
    private Next threat(Game g, Player me) {
        SpellAbilityStackInstance top = g.getStack().peek();
        boolean stop = false;
        for (Entry e : entries) {
            for (Card c : cards(e, g, me)) {
                if (c.isInPlay() && !e.warned.contains(top.getId()) && loses(top.getSpellAbility(), c) && usable(c, e.label, me) != null) {
                    e.warned.add(top.getId());
                    e.due = top.getSpellAbility().getHostCard().getName() + " is about to affect it.";
                    e.threat = true;
                    e.dueCard = c.getId();
                    stop = true;
                    break;
                }
            }
        }
        return new Next(null, stop, null);
    }

    private static final Set<ApiType> TAKES_TARGET = EnumSet.of(ApiType.Destroy, ApiType.ChangeZone, ApiType.GainControl,
            ApiType.DealDamage, ApiType.Debuff, ApiType.Animate, ApiType.SetState, ApiType.Phases, ApiType.Tap, ApiType.TapOrUntap,
            ApiType.ExchangeControl);
    private static final Set<ApiType> TAKES_ALL = EnumSet.of(ApiType.DestroyAll, ApiType.ChangeZoneAll, ApiType.SacrificeAll,
            ApiType.DamageAll, ApiType.TapAll, ApiType.AnimateAll);

    /** Could this spell or ability take {@code card} away, or stop it being used (by targeting it, or with everything like it)? */
    static boolean loses(SpellAbility spell, Card card) {
        for (SpellAbility sa = spell; sa != null; sa = sa.getSubAbility()) {
            try {
                if (TAKES_TARGET.contains(sa.getApi())) {
                    SpellAbility targeting = sa.usesTargeting() ? sa : sa.getRootAbility();
                    if (targeting.usesTargeting() && targeting.getTargets().contains(card)) {
                        return true;
                    }
                } else if (TAKES_ALL.contains(sa.getApi())) {
                    String valid = sa.getParamOrDefault("ValidCards", sa.getParamOrDefault("ChangeType", "Card"));
                    if (card.isValid(valid.split(","), sa.getActivatingPlayer(), sa.getHostCard(), sa)) {
                        return true;
                    }
                }
            } catch (RuntimeException ex) {
                // An effect we can't read: no warning, as without this.
            }
        }
        return false;
    }

    // ---- for the browser ----

    private static String step(PhaseHandler ph, Player me) {
        String whose = ph.isPlayerTurn(me) ? "Your" : ph.getPlayerTurn().getName() + "'s";
        return whose + " " + name(ph.getPhase());
    }

    private static String name(PhaseType p) {
        return p == PhaseType.END_OF_TURN ? "end step" : p.nameForUi.toLowerCase(java.util.Locale.ROOT);
    }

    /** When it's for, in words. */
    private static String when(Entry e, Game g, Player me) {
        Spec s = e.spec;
        return switch (s.when()) {
            case BEFORE_MY_TURN -> "End step before your turn";
            case MY_UPKEEP -> s.once() ? "Your next upkeep" : "Your upkeep";
            case NEXT_END -> s.once() ? "The next end step" : "Every end step";
            case STEP -> {
                Player p = s.whose().equals(ME) || s.whose().equals(OPPONENTS) ? null : g.getPlayer(Integer.parseInt(s.whose()));
                String whose = s.whose().equals(ME) ? "Your" : s.whose().equals(OPPONENTS) ? s.once() ? "An opponent's" : "Each opponent's"
                        : p == null ? "Their" : p.getName() + "'s";
                yield whose + " " + name(s.phase());
            }
        };
    }

    /**
     * For the player's own view: {@code [{id, card, cardId?, label, when, phase?, whose?, ask, everyTurn,
     * everyCopy, text, due?, dueCard?, threat?}]} ({@code text}: when, in words; {@code due}: they're asked about it now).
     */
    synchronized ArrayNode json(ObjectMapper json, Game g, Player me) {
        ArrayNode out = json.createArrayNode();
        for (Entry e : entries) {
            if (e.cardId >= 0 && !there(g, e)) {
                continue;
            }
            var o = out.addObject();
            o.put("id", e.id);
            o.put("card", e.card);
            if (e.cardId >= 0) {
                o.put("cardId", e.cardId);
            }
            o.put("label", e.label);
            o.put("when", e.spec.when().name());
            if (e.spec.when() == When.STEP) {
                o.put("phase", e.spec.phase().name());
                o.put("whose", e.spec.whose());
            }
            o.put("ask", e.spec.ask());
            o.put("everyTurn", e.spec.everyTurn());
            o.put("everyCopy", e.spec.everyCopy());
            o.put("text", when(e, g, me));
            if (e.due != null) {
                o.put("due", e.due);
                o.put("dueCard", e.dueCard);
                o.put("threat", e.threat);
            }
        }
        return out;
    }
}
