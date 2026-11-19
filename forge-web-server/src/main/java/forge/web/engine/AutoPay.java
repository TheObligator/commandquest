package forge.web.engine;

import forge.card.MagicColor;
import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCostShard;
import forge.game.card.Card;
import forge.game.cost.CostPart;
import forge.game.cost.CostTap;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.input.InputPayMana;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.tinylog.Logger;

/**
 * The Auto-pay button: pays a mana cost the way a careful player taps lands. Among your untapped
 * sources that just tap for one mana (no damage, sacrifice or life), it picks the cheapest set:
 * sources that can make fewer colors first (basics before dual and any-color lands, a mana rock
 * before a filter land), creatures last, and what's left untapped should still cast as many of the
 * spells in your hand as it can (keep a Plains up for the Swords to Plowshares). It taps them
 * through Forge's own payment, in an order where each tap's color is unambiguous. When it can't plan a payment (hybrid or Phyrexian
 * costs, floating mana, only sources with drawbacks left), Forge's own auto-payment does it.
 */
public final class AutoPay {

    private AutoPay() {
    }

    /** One untapped source: the colors it can make for this payment, each with the ability that does it. */
    record Source(Card card, Map<Byte, SpellAbility> byColor, int penalty, boolean anyColor) {
    }

    /** A tap: this source's ability, making {@code color} (0 for generic). */
    record Tap(Source source, SpellAbility ability, byte color) {
    }

    private static final byte[] COLORS = {MagicColor.WHITE, MagicColor.BLUE, MagicColor.BLACK, MagicColor.RED, MagicColor.GREEN};

    /** Pays what {@code me} is paying now; {@code fallback} is Forge's auto-pay. Call on Forge's UI thread. */
    public static void run(IGameController ctl, Player me, Runnable fallback) {
        InputPayMana input = Payment.input(ctl);
        SpellAbility paidFor = me == null ? null : me.getPaidForSA();
        ManaCostBeingPaid cost = paidFor == null ? null : paidFor.getManaCostBeingPaid();
        List<Tap> plan = null;
        try {
            if (input != null && cost != null && me.getManaPool().isEmpty() && !paidFor.tracksManaSpent()) {
                plan = plan(sources(me, paidFor), shards(cost), hand(me, paidFor));
            }
        } catch (RuntimeException e) {
            Logger.debug(e, "Couldn't plan the payment");
        }
        if (plan == null) {
            fallback.run();
            return;
        }
        List<Tap> taps = plan;
        Thread t = new Thread(() -> execute(input, me, cost, taps, fallback), "auto-pay");
        t.setDaemon(true);
        t.start();
    }

    /** What's left to pay, as single shards (W, U, B, R, G and generic), or null if it has others. */
    static Map<Byte, Integer> shards(ManaCostBeingPaid cost) {
        Map<Byte, Integer> need = new LinkedHashMap<>();
        for (ManaCostShard s : cost.getDistinctShards()) {
            int n = cost.getUnpaidShards(s);
            byte key = switch (s) {
                case WHITE -> MagicColor.WHITE;
                case BLUE -> MagicColor.BLUE;
                case BLACK -> MagicColor.BLACK;
                case RED -> MagicColor.RED;
                case GREEN -> MagicColor.GREEN;
                case GENERIC -> 0;
                default -> -1;
            };
            if (key == -1) {
                return null; // hybrid, Phyrexian, colorless-only, snow, X: Forge's auto-pay
            }
            need.merge(key, n, Integer::sum);
        }
        return need;
    }

    /** Your untapped permanents that tap for exactly one mana with no other cost or effect. */
    static List<Source> sources(Player me, SpellAbility paidFor) {
        List<Source> out = new ArrayList<>();
        for (Card c : me.getCardsIn(ZoneType.Battlefield)) {
            if (c.isTapped() || c.isPhasedOut()) {
                continue;
            }
            Map<Byte, SpellAbility> byColor = new HashMap<>();
            boolean anyColor = false;
            for (SpellAbility ma : InputPayMana.getAllManaAbilities(c, me)) {
                if (!clean(ma, c)) {
                    continue;
                }
                AbilityManaPart mp = ma.getManaPart();
                for (byte color : COLORS) {
                    if (ma.canProduce(MagicColor.toShortString(color)) && ma.isManaAbilityFor(paidFor, color)) {
                        byColor.putIfAbsent(color, ma);
                        anyColor |= mp.isAnyMana();
                    }
                }
                if (ma.canProduce("C") && ma.isManaAbilityFor(paidFor, (byte) ManaAtom.COLORLESS)) {
                    byColor.putIfAbsent((byte) ManaAtom.COLORLESS, ma);
                }
            }
            if (byColor.isEmpty()) {
                continue;
            }
            // every color it could make, its other mana abilities too (a filter land's {W/U}: add {W}{U})
            int colors = 0;
            for (byte color : COLORS) {
                if (byColor.containsKey(color) || InputPayMana.getAllManaAbilities(c, me).stream()
                        .anyMatch(ma -> ma.canProduce(MagicColor.toShortString(color)))) {
                    colors++;
                }
            }
            boolean otherAbilities = c.getSpellAbilities().stream().anyMatch(sa -> !sa.isManaAbility() && sa.isActivatedAbility());
            int penalty = 1 + 2 * colors + (c.isCreature() ? 20 : 0) + (otherAbilities ? 3 : 0) + (anyColor ? 1 : 0);
            out.add(new Source(c, byColor, penalty, anyColor));
        }
        out.sort(Comparator.comparingInt(Source::penalty).thenComparingInt(s -> s.card().getId()));
        return out;
    }

    /** Only {T}, one mana, nothing else happens, and the source can tap now. */
    private static boolean clean(SpellAbility ma, Card c) {
        if (ma.getSubAbility() != null || ma.amountOfManaGenerated(true) != 1 || ma.getManaPart() == null) {
            return false;
        }
        boolean tap = false;
        for (CostPart p : ma.getPayCosts().getCostParts()) {
            if (!(p instanceof CostTap)) {
                return false;
            }
            tap = true;
        }
        return tap && !(c.isCreature() && c.isSick());
    }

    /** A spell in your hand, by what it costs: colored shards (color -> count) and generic. */
    record HandSpell(Map<Byte, Integer> colored, int generic) {
    }

    /**
     * What it's worth (in source penalties) to leave one more spell in hand castable: more than a
     * dual land over a basic, less than tapping a creature.
     */
    static final int KEEP_CASTABLE = 6;

    /** The spells in {@code me}'s hand with plain costs (no hybrid, Phyrexian or X), not the one being paid for. */
    static List<HandSpell> hand(Player me, SpellAbility paidFor) {
        List<HandSpell> out = new ArrayList<>();
        Card paying = paidFor == null ? null : paidFor.getHostCard();
        for (Card c : me.getCardsIn(ZoneType.Hand)) {
            if (c == paying || c.isLand()) {
                continue;
            }
            forge.card.mana.ManaCost mc = c.getManaCost();
            if (mc == null || mc.isNoCost() || mc.hasHybrid() || mc.hasPhyrexian() || mc.countX() > 0) {
                continue;
            }
            Map<Byte, Integer> colored = new LinkedHashMap<>();
            for (byte color : COLORS) {
                ManaCostShard shard = switch (color) {
                    case MagicColor.WHITE -> ManaCostShard.WHITE;
                    case MagicColor.BLUE -> ManaCostShard.BLUE;
                    case MagicColor.BLACK -> ManaCostShard.BLACK;
                    case MagicColor.RED -> ManaCostShard.RED;
                    default -> ManaCostShard.GREEN;
                };
                int n = mc.getShardCount(shard);
                if (n > 0) {
                    colored.put(color, n);
                }
            }
            if (mc.getShardCount(ManaCostShard.COLORLESS) > 0) {
                continue;   // {C}: rare, leave it out
            }
            out.add(new HandSpell(colored, mc.getGenericCost()));
        }
        return out;
    }

    /** Could these sources (the ones not {@code used}) pay for this spell? */
    static boolean canPay(List<Source> sources, boolean[] used, HandSpell spell) {
        List<Byte> colored = new ArrayList<>();
        spell.colored().forEach((col, n) -> {
            for (int i = 0; i < n; i++) {
                colored.add(col);
            }
        });
        int free = 0;
        for (boolean u : used) {
            free += u ? 0 : 1;
        }
        if (colored.size() + spell.generic() > free) {
            return false;
        }
        return match(sources, used.clone(), colored, 0);
    }

    private static boolean match(List<Source> sources, boolean[] used, List<Byte> colored, int i) {
        if (i == colored.size()) {
            return true;
        }
        for (int k = 0; k < sources.size(); k++) {
            if (!used[k] && sources.get(k).byColor().containsKey(colored.get(i))) {
                used[k] = true;
                if (match(sources, used, colored, i + 1)) {
                    return true;
                }
                used[k] = false;
            }
        }
        return false;
    }

    static List<Tap> plan(List<Source> sources, Map<Byte, Integer> need) {
        return plan(sources, need, List.of());
    }

    /**
     * The cheapest taps that pay {@code need} (color -> count, 0 = generic), or null. The cost of a
     * plan is its sources' penalties, plus {@link #KEEP_CASTABLE} for each spell in {@code hand}
     * the sources left untapped couldn't pay for. Colored shards are assigned by search (fewest
     * candidates first), then generic. Any-color sources only pay colored shards (for generic Forge
     * would ask which color).
     */
    static List<Tap> plan(List<Source> sources, Map<Byte, Integer> need, List<HandSpell> hand) {
        if (need == null || need.isEmpty()) {
            return null;
        }
        List<Byte> colored = new ArrayList<>();
        int generic = 0;
        for (Map.Entry<Byte, Integer> e : need.entrySet()) {
            if (e.getKey() == 0) {
                generic += e.getValue();
            } else {
                for (int i = 0; i < e.getValue(); i++) {
                    colored.add(e.getKey());
                }
            }
        }
        if (colored.size() + generic > sources.size()) {
            return null;
        }
        colored.sort(Comparator.comparingLong(col -> sources.stream().filter(s -> s.byColor().containsKey(col)).count()));
        Search s = new Search(sources, colored, generic, hand);
        s.go(0, new boolean[sources.size()], new ArrayList<>(), 0);
        return s.best;
    }

    private static final class Search {
        final List<Source> sources;
        final List<Byte> colored;
        final int generic;
        final List<HandSpell> hand;
        List<Tap> best;
        int bestCost = Integer.MAX_VALUE;
        int nodes;

        Search(List<Source> sources, List<Byte> colored, int generic, List<HandSpell> hand) {
            this.sources = sources;
            this.colored = colored;
            this.generic = generic;
            this.hand = hand;
        }

        /** Generic: the cheapest sources left first, trying other sets too (each set once, in source order). */
        void generic(int from, int left, boolean[] used, List<Tap> taps, int cost) {
            if (++nodes > 50_000 || cost >= bestCost) {
                return;
            }
            if (left == 0) {
                int total = cost;
                for (HandSpell h : hand) {
                    if (!canPay(sources, used, h)) {
                        total += KEEP_CASTABLE;
                    }
                }
                if (total < bestCost) {
                    bestCost = total;
                    best = new ArrayList<>(taps);
                }
                return;
            }
            for (int k = from; k < sources.size(); k++) {
                Source src = sources.get(k); // cheapest first
                if (used[k] || src.anyColor()) {
                    continue;
                }
                SpellAbility ab = src.byColor().getOrDefault((byte) ManaAtom.COLORLESS, src.byColor().values().iterator().next());
                used[k] = true;
                taps.add(new Tap(src, ab, (byte) 0));
                generic(k + 1, left - 1, used, taps, cost + src.penalty());
                taps.remove(taps.size() - 1);
                used[k] = false;
            }
        }

        void go(int i, boolean[] used, List<Tap> taps, int cost) {
            if (++nodes > 50_000 || cost >= bestCost) {
                return;
            }
            if (i == colored.size()) {
                generic(0, generic, used, taps, cost);
                return;
            }
            byte col = colored.get(i);
            for (int k = 0; k < sources.size(); k++) {
                Source src = sources.get(k);
                SpellAbility ab = src.byColor().get(col);
                if (used[k] || ab == null) {
                    continue;
                }
                used[k] = true;
                taps.add(new Tap(src, ab, col));
                go(i + 1, used, taps, cost + src.penalty());
                taps.remove(taps.size() - 1);
                used[k] = false;
            }
        }
    }

    /**
     * Taps the plan through Forge's payment input, one at a time (each waits for the last to
     * finish). A colored tap goes when its color is the only one it could make that's still
     * needed, so Forge picks that color; generic taps go last. Anything unexpected: Forge's
     * auto-pay finishes the payment.
     */
    private static void execute(InputPayMana input, Player me, ManaCostBeingPaid cost, List<Tap> plan, Runnable fallback) {
        List<Tap> left = new ArrayList<>(plan);
        try {
            while (!left.isEmpty() && !input.isPaid() && !cost.isPaid()) {
                Tap next = null;
                byte needed = 0;
                for (byte color : COLORS) {
                    if (cost.needsColor(color, me.getManaPool())) {
                        needed |= color;
                    }
                }
                for (Tap t : left) {
                    if (t.color() != 0 && (makes(t) & needed) == t.color()) {
                        next = t;
                        break;
                    }
                }
                if (next == null && needed == 0) {
                    next = left.stream().filter(t -> t.color() == 0).findFirst().orElse(null);
                }
                if (next == null) {
                    break;
                }
                left.remove(next);
                Tap tap = next;
                boolean[] ok = {false};
                FThreads.invokeInEdtAndWait(() -> ok[0] = input.selectAbility(tap.ability()));
                if (!ok[0]) {
                    break;
                }
                long end = System.currentTimeMillis() + 5000;
                Thread.sleep(30);
                while (input.isActivatingManaAbility() && System.currentTimeMillis() < end) {
                    Thread.sleep(20);
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException e) {
            Logger.warn(e, "Auto-pay stopped");
        }
        if (!input.isPaid() && !cost.isPaid()) {
            FThreads.invokeInEdtLater(fallback); // Forge's auto-pay does the rest
        }
    }

    /** The colors this tap's ability could make (W U B R G mask). */
    private static byte makes(Tap t) {
        byte m = 0;
        for (byte color : COLORS) {
            if (t.ability().canProduce(MagicColor.toShortString(color))) {
                m |= color;
            }
        }
        return m;
    }
}
