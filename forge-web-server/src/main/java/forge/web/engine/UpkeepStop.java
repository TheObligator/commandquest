package forge.web.engine;

import forge.ai.ComputerUtilMana;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.cost.CostPayment;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import java.util.EnumSet;
import java.util.Set;

/**
 * An automatic upkeep stop: with an empty stack, Forge skips any step you have no stop in, so a
 * card you can only use during your upkeep ("Activate only during your upkeep", e.g. Rock Hydra,
 * or Undead Gladiator from the graveyard) would never get the chance. If you can use such an
 * ability right now and pay for it, the game stops in upkeep for you anyway.
 */
public final class UpkeepStop {

    private static final Set<PhaseType> UPKEEP_ONLY = EnumSet.of(PhaseType.UPKEEP);
    private static final ZoneType[] ZONES = {
        ZoneType.Battlefield, ZoneType.Hand, ZoneType.Graveyard, ZoneType.Exile, ZoneType.Command,
    };

    private UpkeepStop() {
    }

    /**
     * The card that has an upkeep-only ability {@code p} can use now, or null. Call on the game
     * thread: checking whether an ability can be used touches the game.
     */
    public static Card reason(Game g, Player p) {
        if (g.getPhaseHandler().getPhase() != PhaseType.UPKEEP || !g.getStack().isEmpty()) {
            return null;
        }
        for (ZoneType zone : ZONES) {
            for (Card c : p.getCardsIn(zone).threadSafeIterable()) {
                for (SpellAbility sa : c.getAllPossibleAbilities(p, true)) {
                    if (!sa.isManaAbility() && UPKEEP_ONLY.equals(sa.getRestrictions().getPhases()) && affordable(sa, p)) {
                        return c;
                    }
                }
            }
        }
        return null;
    }

    /** Can {@code p} pay for it now (mana from untapped sources, and any other costs)? */
    private static boolean affordable(SpellAbility sa, Player p) {
        return CostPayment.canPayAdditionalCosts(sa.getPayCosts(), sa, false, p)
                && ComputerUtilMana.canPayManaCost(sa, p, 0, false);
    }
}
