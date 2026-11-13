package forge.web.engine;

import forge.card.MagicColor;
import forge.game.Game;
import forge.game.GameLogEntryType;
import forge.game.ability.AbilityUtils;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardLists;
import forge.game.cost.Cost;
import forge.game.cost.CostPart;
import forge.game.cost.CostPayLife;
import forge.game.cost.CostPayment;
import forge.game.cost.CostTap;
import forge.game.cost.CostTapType;
import forge.game.cost.PaymentDecision;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.Trigger;
import forge.game.trigger.TriggerType;
import forge.game.zone.ZoneType;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Tapping several permanents for mana at once, with the colors you pick (docs/game-protocol.md,
 * {@code manaOptions} / {@code tapForMana}). Each card can be tapped for one of its own mana
 * abilities whose only cost is {T}, or as the cost of another permanent's "Tap an untapped
 * artifact you control: Add {U}" (Urza, High Lord Artificer; Springleaf Drum's kind without the
 * {T} on itself). Each is activated as Forge's own mana ability: the cost is paid, the color
 * chosen, and it goes through the stack's mana-ability path, so triggers like "whenever you tap a
 * land for mana" happen. A card's own ability may also cost life (Mana Confluence, Horizon
 * Canopy), and what each pick costs you is reported: life paid or lost, and damage dealt to you by
 * the ability (pain lands, Ancient Tomb) or by a "whenever this becomes tapped" trigger (City of
 * Brass). Mana abilities with other costs (mana, sacrifice) or special choices are left out; tap
 * those cards one at a time.
 */
public final class ManaTaps {

    private ManaTaps() {
    }

    /**
     * One way to tap {@code card} for mana: {@code source}'s mana ability number {@code ability}
     * (in {@link Card#getManaAbilities()}), choosing {@code choice} (Forge's express choice, e.g.
     * "U" or "G G"; empty when there's nothing to choose). {@code mana}: what it adds, as symbols
     * ("WW", "C"). {@code via}: the other card whose ability this is, or null for the card's own.
     * {@code damage}: damage it deals you; {@code life}: life you pay or lose.
     */
    public record Pick(int card, int source, int ability, String choice, String mana, String via, int damage, int life) {
        public Pick(int card, int source, int ability, String choice) {
            this(card, source, ability, choice, "", null, 0, 0);
        }
    }

    private static final String[] WUBRG = {"W", "U", "B", "R", "G"};

    /** The ways each card can be tapped for mana right now, by card id (cards with none are left out). Game thread. */
    public static Map<Integer, List<Pick>> options(Game g, Player me, List<Card> cards) {
        Map<Integer, List<Pick>> out = new LinkedHashMap<>();
        List<Card> sources = new ArrayList<>(me.getCardsIn(ZoneType.Battlefield));
        for (Card card : cards) {
            if (!card.isInPlay() || card.getController() != me || card.isTapped() || !card.canTap()) {
                continue;
            }
            List<Pick> picks = new ArrayList<>();
            // Its own "{T}: Add …" abilities.
            List<SpellAbility> own = new ArrayList<>(card.getManaAbilities());
            for (int i = 0; i < own.size(); i++) {
                SpellAbility sa = own.get(i);
                if (ownCost(sa) && usable(sa, me)) {
                    addPicks(picks, card, card, i, sa, null);
                }
            }
            // Another permanent's "Tap an untapped <type> you control: Add …", paid by tapping this card.
            for (Card source : sources) {
                if (source == card) {
                    continue;
                }
                List<SpellAbility> theirs = new ArrayList<>(source.getManaAbilities());
                for (int i = 0; i < theirs.size(); i++) {
                    SpellAbility sa = theirs.get(i);
                    if (onlyCost(sa, CostTapType.class) && usable(sa, me) && paysWith(sa, card, me)) {
                        addPicks(picks, card, source, i, sa, source.getName());
                    }
                }
            }
            if (!picks.isEmpty()) {
                out.put(card.getId(), picks);
            }
        }
        return out;
    }

    /** Is the ability's cost {T}, perhaps with life to pay ("{T}, Pay 1 life: Add …")? */
    private static boolean ownCost(SpellAbility sa) {
        Cost cost = sa.getPayCosts();
        if (cost == null) {
            return false;
        }
        int taps = 0;
        for (CostPart part : cost.getCostParts()) {
            if (part instanceof CostTap) {
                taps++;
            } else if (!(part instanceof CostPayLife)) {
                return false;
            }
        }
        return taps == 1;
    }

    /** Is the ability's whole cost a single part of this kind (and, for tapping others, one card)? */
    private static boolean onlyCost(SpellAbility sa, Class<? extends CostPart> kind) {
        Cost cost = sa.getPayCosts();
        if (cost == null || cost.getCostParts().size() != 1 || !kind.isInstance(cost.getCostParts().get(0))) {
            return false;
        }
        CostPart part = cost.getCostParts().get(0);
        return !(part instanceof CostTapType t) || (t.getAbilityAmount(sa) == 1 && !t.getType().contains("sharesCreatureTypeWith")
                && !t.getType().contains("withTotalPowerGE") && !t.getType().equals("OriginalHost"));
    }

    private static boolean usable(SpellAbility sa, Player me) {
        sa.setActivatingPlayer(me);
        AbilityManaPart mp = sa.getManaPart();
        if (mp == null || mp.isSpecialMana() || sa.getApi() == ApiType.ManaReflected || sa.hasParam("Each")
                || (mp.isComboMana() && mp.getOrigProduced().contains("Different"))) {
            return false;
        }
        return sa.canPlay() && CostPayment.canPayAdditionalCosts(sa.getPayCosts(), sa, false);
    }

    /** Can tapping {@code card} pay {@code sa}'s "tap an untapped …" cost? */
    private static boolean paysWith(SpellAbility sa, Card card, Player me) {
        CostTapType part = (CostTapType) sa.getPayCosts().getCostParts().get(0);
        return !CardLists.getValidCards(new CardCollection(card), part.getType().split(";"), me, sa.getHostCard(), sa).isEmpty();
    }

    private static void addPicks(List<Pick> picks, Card card, Card source, int index, SpellAbility sa, String via) {
        AbilityManaPart mp = sa.getManaPart();
        int amount = Math.max(0, sa.amountOfManaGenerated(false));
        if (amount == 0) {
            return;
        }
        int[] harm = harm(sa, card);
        if (mp.isComboMana() || mp.isAnyMana()) {
            String[] colors = mp.isComboMana() ? mp.getComboColors(sa).split(" ") : WUBRG;
            for (String c : colors) {
                if (c.isBlank()) {
                    continue;
                }
                String one = MagicColor.toShortString(MagicColor.fromName(c));
                // Combo: one choice per mana ("G G"); any: one color, Forge repeats it.
                String choice = mp.isComboMana() ? String.join(" ", java.util.Collections.nCopies(amount, one)) : one;
                picks.add(new Pick(card.getId(), source.getId(), index, choice, one.repeat(amount), via, harm[0], harm[1]));
            }
            return;
        }
        String produced = mp.mana(sa);
        StringBuilder mana = new StringBuilder();
        for (int i = 0; i < amount; i++) {
            for (String s : produced.split(" ")) {
                mana.append(s.matches("\\d+") ? "C".repeat(Integer.parseInt(s)) : s);
            }
        }
        picks.add(new Pick(card.getId(), source.getId(), index, "", mana.toString(), via, harm[0], harm[1]));
    }

    /**
     * What tapping {@code card} with {@code sa} costs you: {damage, life}. Life paid in the cost, and
     * damage dealt to you or life you lose in the ability itself (pain lands) or in the card's own
     * "whenever this becomes tapped" trigger (City of Brass).
     */
    static int[] harm(SpellAbility sa, Card card) {
        int[] out = new int[2];
        for (CostPart part : sa.getPayCosts().getCostParts()) {
            if (part instanceof CostPayLife) {
                out[1] += part.getAbilityAmount(sa);
            }
        }
        addHarm(out, sa);
        for (Trigger t : card.getTriggers()) {
            if ((t.getMode() == TriggerType.Taps || t.getMode() == TriggerType.TapsForMana) && "Card.Self".equals(t.getParam("ValidCard"))
                    && !t.hasParam("Activator")) {
                SpellAbility ex = t.ensureAbility();
                if (ex != null) {
                    addHarm(out, ex);
                }
            }
        }
        return out;
    }

    private static void addHarm(int[] out, SpellAbility first) {
        for (SpellAbility s = first; s != null; s = s.getSubAbility()) {
            String who = s.getParam("Defined");
            if (s.hasParam("ConditionCheckSVar") || s.hasParam("Condition")) {
                continue;
            }
            Card host = s.getHostCard();
            if (s.getApi() == ApiType.DealDamage && "You".equals(who) && s.hasParam("NumDmg")) {
                out[0] += Math.max(0, AbilityUtils.calculateAmount(host, s.getParam("NumDmg"), s));
            } else if (s.getApi() == ApiType.LoseLife && (who == null || "You".equals(who)) && s.hasParam("LifeAmount")) {
                out[1] += Math.max(0, AbilityUtils.calculateAmount(host, s.getParam("LifeAmount"), s));
            }
        }
    }

    /**
     * Taps the cards for mana as picked. Each pick must still be one of {@link #options}; others are
     * skipped. Returns how many were used. Game thread.
     */
    public static int tap(Game g, Player me, List<Pick> wanted) {
        List<String> names = new ArrayList<>();
        StringBuilder mana = new StringBuilder();
        int[] hurt = new int[2];
        for (Pick w : wanted) {
            Card card = g.findById(w.card());
            if (card == null) {
                continue;
            }
            List<Pick> now = options(g, me, List.of(card)).getOrDefault(card.getId(), List.of());
            Pick pick = now.stream().filter(p -> p.source() == w.source() && p.ability() == w.ability() && p.choice().equals(w.choice()))
                    .findFirst().orElse(null);
            Card source = pick == null ? null : g.findById(pick.source());
            if (source == null) {
                continue;
            }
            SpellAbility sa = new ArrayList<>(source.getManaAbilities()).get(pick.ability());
            sa.setActivatingPlayer(me);
            for (CostPart part : sa.getPayCosts().getCostParts()) {
                PaymentDecision how = part instanceof CostTapType ? PaymentDecision.card(card)
                        : part instanceof CostPayLife ? PaymentDecision.number(part.getAbilityAmount(sa)) : null;
                part.payAsDecided(me, how, sa, false);
            }
            if (!pick.choice().isEmpty()) {
                sa.getManaPart().setExpressChoice(pick.choice());
            }
            g.getStack().add(sa); // a mana ability resolves right away
            names.add(pick.via() == null ? card.getName() : card.getName() + " (for " + pick.via() + ")");
            mana.append(pick.mana());
            hurt[0] += pick.damage();
            hurt[1] += pick.life();
        }
        if (!names.isEmpty()) {
            g.getAction().checkStaticAbilities();
            g.getGameLog().add(GameLogEntryType.MANA, me.getName() + " tapped " + String.join(", ", names) + " for " + symbols(mana.toString())
                    + (hurt[1] > 0 ? ", paying " + hurt[1] + " life" : "") + (hurt[0] > 0 ? ", taking " + hurt[0] + " damage" : ""));
        }
        return names.size();
    }

    /** "WWU" → "{W}{W}{U}". */
    static String symbols(String mana) {
        StringBuilder sb = new StringBuilder();
        for (char ch : mana.toCharArray()) {
            sb.append('{').append(ch).append('}');
        }
        return sb.toString();
    }

}
