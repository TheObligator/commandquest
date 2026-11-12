package forge.web.engine;

import forge.game.Game;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.gamemodes.match.YieldUpdate;
import java.util.List;

/** The browser's auto-pass buttons as Forge yields (docs/stops.md). */
public final class AutoPass {

    private AutoPass() {
    }

    /**
     * The yield for an auto-pass mode, chosen now by {@code me}: END_OF_TURN, BEFORE_MY_TURN (until
     * the end step of the player before you), UNTIL_MY_TURN (until your next turn starts) or
     * ACTION_OR_END_STEP. Null for an unknown mode. Read the game on its own thread or Forge's UI thread.
     */
    public static YieldUpdate update(Game g, PlayerView me, String mode) {
        Player active = g.getPhaseHandler().getPlayerTurn();
        Player mine = g.getPlayer(me.getId());
        return switch (mode) {
            case "END_OF_TURN" -> new YieldUpdate.SetAutoPassUntilEndOfTurn(me, true);
            case "ACTION_OR_END_STEP" -> new YieldUpdate.SetMarker(active.getView(), PhaseType.END_OF_TURN, false);
            case "BEFORE_MY_TURN" -> {
                List<Player> order = g.getPlayers();
                int i = order.indexOf(mine);
                Player before = order.get((i - 1 + order.size()) % order.size());
                yield new YieldUpdate.SetMarker(before.getView(), PhaseType.END_OF_TURN, false);
            }
            // Until your next upkeep (the first step with priority); from there your own stops decide
            // again. Chosen on your own turn, Forge waits a full round: next turn's upkeep.
            case "UNTIL_MY_TURN" -> new YieldUpdate.SetMarker(me, PhaseType.UPKEEP, active == mine);
            default -> null;
        };
    }
}
