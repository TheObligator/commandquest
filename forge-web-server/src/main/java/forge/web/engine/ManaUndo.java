package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.mana.Mana;
import forge.game.mana.ManaPool;
import forge.game.mana.ManaRefundService;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.zone.MagicStack;
import java.util.ArrayList;
import java.util.List;

/**
 * Taking back a tap for mana: clicking a permanent you tapped for mana untaps it and takes the mana
 * back out of your pool, as long as that mana hasn't been spent. Forge keeps the mana abilities it
 * can still undo ({@link MagicStack#filterUndoStackByHost}); this undoes the one from that card,
 * the way {@link MagicStack#undo()} undoes the latest. Game thread only.
 */
public final class ManaUndo {
    private ManaUndo() {
    }

    /** The mana ability of {@code card} that {@code me} can take back now, or null. */
    public static SpellAbility undoable(Game g, Player me, Card card) {
        MagicStack stack = g.getStack();
        if (card == null || me == null || !card.isTapped() || card.getController() != me || !stack.canUndo(me)) {
            return null;
        }
        SpellAbility last = null;
        for (SpellAbility sa : stack.filterUndoStackByHost(card)) {
            if (sa.isManaAbility() && sa.isUndoable() && sa.getActivatingPlayer() == me) {
                last = sa;
            }
        }
        // Its mana must all still be in the pool (not spent on anything).
        return last != null && stillFloating(me.getManaPool(), last.getManaPart()) ? last : null;
    }

    /** Is all the mana this ability made last time still in the pool? (What {@link ManaPool#accountFor} checks, without taking it.) */
    private static boolean stillFloating(ManaPool pool, AbilityManaPart part) {
        if (part == null || part.getLastManaProduced().isEmpty()) {
            return false;
        }
        List<Mana> floating = new ArrayList<>();
        pool.forEach(floating::add);
        for (Mana m : part.getLastManaProduced()) {
            if (!floating.remove(m)) {
                return false;
            }
        }
        return true;
    }

    /** Untaps {@code card} and takes its mana back, if it can. */
    public static boolean untap(Game g, Player me, Card card) {
        SpellAbility sa = undoable(g, me, card);
        if (sa == null || !sa.undo()) {
            return false;
        }
        g.getStack().clearUndoStack(sa);
        new ManaRefundService(sa).refundManaPaid();
        return true;
    }

    /** Marks your permanents you can untap that way ({@code undoMana}), in a view from {@link ViewJson#game}. */
    static void annotate(Game g, Player me, ObjectNode view) {
        if (g == null || me == null || !g.getStack().canUndo(me) || g.getPhaseHandler().getPriorityPlayer() != me) {
            return;
        }
        for (JsonNode p : view.path("players")) {
            for (JsonNode c : p.path("battlefield")) {
                if (c.path("tapped").asBoolean() && undoable(g, me, g.findById(c.path("id").asInt())) != null) {
                    ((ObjectNode) c).put("undoMana", true);
                }
            }
        }
    }
}
