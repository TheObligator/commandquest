package forge.web.engine;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.phase.PhaseHandler;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;

/**
 * Why clicking a card did nothing, in plain words. Forge itself just ignores a click on a card
 * that can't be used, which looks like the site is broken (e.g. clicking a land in your upkeep).
 */
public final class Explain {

    private Explain() {
    }

    /** Why {@code p} can't do anything with {@code card} right now. Read on Forge's UI thread. */
    public static String whyNot(Game g, Player p, Card card, boolean priorityInput) {
        CardView cv = card.getView();
        boolean seen = cv.canBeShownTo(p.getView()) && (!cv.isFaceDown() || cv.canFaceDownBeShownTo(p.getView()));
        String name = seen ? cv.getCurrentState().getName() : "that card";
        PhaseHandler ph = g.getPhaseHandler();
        if (!priorityInput) {
            return "You can't choose " + name + " for this. Follow the prompt on the left, or Cancel.";
        }
        if (ph.getPriorityPlayer() != p) {
            return "You don't have priority right now. Wait until the game stops for you.";
        }
        Zone zone = g.getZoneOf(card);
        ZoneType z = zone == null ? null : zone.getZoneType();
        PhaseType phase = ph.getPhase();
        String step = phase == null ? "this step" : phase.nameForUi;
        boolean myTurn = ph.isPlayerTurn(p);
        boolean stackEmpty = g.getStack().isEmpty();
        if (z == ZoneType.Hand && card.isLand()) {
            if (!myTurn) {
                return "You can only play a land on your own turn. It's " + ph.getPlayerTurn().getName() + "'s turn.";
            }
            if (phase == null || !phase.isMain()) {
                return "You can only play a land in a main phase. It's your " + step + " now: press OK to move on.";
            }
            if (!stackEmpty) {
                return "You can only play a land while the stack is empty.";
            }
            if (!p.canPlayLand(card, false, null)) {
                return "You've already played a land this turn.";
            }
            return "You can't play " + name + " right now.";
        }
        if (z == ZoneType.Hand) {
            if (!card.isInstant() && !p.canCastSorcery()) {
                if (!myTurn) {
                    return name + " can only be cast on your own turn (it isn't an instant and has no flash).";
                }
                if (phase == null || !phase.isMain()) {
                    return name + " can only be cast in a main phase. It's your " + step + " now: press OK to move on.";
                }
                if (!stackEmpty) {
                    return name + " can only be cast while the stack is empty.";
                }
            }
            return "You can't cast " + name + " right now.";
        }
        if (card.getController() != p && card.getOwner() != p) {
            return "There's nothing you can do with " + name + " right now.";
        }
        if (z == ZoneType.Battlefield) {
            return name + " has no ability you can use right now" + (card.isTapped() ? " (it's tapped)." : ".");
        }
        return "There's nothing you can do with " + name + " right now.";
    }
}
