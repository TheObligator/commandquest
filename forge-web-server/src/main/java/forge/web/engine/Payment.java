package forge.web.engine;

import forge.game.Game;
import forge.game.GameLogEntryType;
import forge.game.card.Card;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.gamemodes.match.input.Input;
import forge.gamemodes.match.input.InputPayMana;
import forge.interfaces.IGameController;
import forge.card.mana.ManaCostShard;
import forge.player.PlayerControllerHuman;
import java.util.ArrayList;
import java.util.List;

/**
 * Paying a mana cost from the browser. While Forge waits for you to pay (its InputPayMana), the
 * prompt carries what you're paying for, so the browser can offer Auto-pay (Forge's own auto
 * payment, which taps single-color sources such as basics before dual and any-color ones and keeps
 * the colors your hand needs), Cancel, and in free-play games "for free".
 */
public final class Payment {

    private Payment() {
    }

    /** What you're paying for right now, or null when Forge isn't waiting for your mana. */
    public record Info(String cost, String card, int cardId, String kind) {
    }

    /** Forge's current input for this seat, if it's a mana payment. */
    public static InputPayMana input(IGameController ctl) {
        if (ctl instanceof PlayerControllerHuman h) {
            Input in = h.getInputProxy().getInput();
            if (in instanceof InputPayMana pay && !pay.isPaid()) {
                return pay;
            }
        }
        return null;
    }

    /** The spell or ability {@code me} is paying mana for, with its unpaid cost; null if none. */
    public static Info info(IGameController ctl, Player me) {
        if (me == null || input(ctl) == null) {
            return null;
        }
        SpellAbility sa = me.getPaidForSA();
        ManaCostBeingPaid cost = sa == null ? null : sa.getManaCostBeingPaid();
        if (cost == null || cost.isPaid()) {
            return null;
        }
        Card host = sa.getHostCard();
        String kind = sa.isSpell() ? "spell" : sa.isActivatedAbility() ? "ability" : "effect";
        return new Info(cost.toString(), host == null ? "" : host.getName(), host == null ? 0 : host.getId(), kind);
    }

    /**
     * Free play: pays the rest of the mana cost being paid with nothing (for a card whose "without
     * paying its mana cost" isn't scripted right, say). Other costs (tapping, sacrificing, life)
     * are still asked for. The game log notes it "(by hand)". Run it on Forge's UI thread, like a
     * click. Returns false if Forge isn't waiting for this player's mana.
     */
    public static boolean payFree(IGameController ctl, Game g, Player me) {
        Info info = info(ctl, me);
        if (info == null) {
            return false;
        }
        ManaCostBeingPaid cost = me.getPaidForSA().getManaCostBeingPaid();
        for (int guard = 0; guard < 20 && !cost.isPaid(); guard++) {
            List<ManaCostShard> shards = new ArrayList<>();
            cost.getDistinctShards().forEach(shards::add);
            for (ManaCostShard shard : shards) {
                cost.decreaseShard(shard, cost.getUnpaidShards(shard));
            }
        }
        if (!cost.isPaid()) {
            return false;
        }
        String what = switch (info.kind()) {
            case "spell" -> "cast " + info.card() + " without paying its mana cost";
            case "ability" -> "activated " + info.card() + "'s ability without paying its mana cost";
            default -> "paid " + info.cost() + " for " + info.card() + " with no mana";
        };
        g.getGameLog().add(GameLogEntryType.INFORMATION, me.getName() + " " + what + " (by hand)");
        // The cost is now paid: Forge's Auto button finds nothing left to tap and finishes the payment.
        ctl.selectButtonOk();
        return true;
    }
}
