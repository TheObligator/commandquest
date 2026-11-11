package forge.web.engine;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.GameType;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import forge.player.PlayerControllerHuman;

/**
 * A browser player's controller: Forge's human controller with the mulligan done as Commander
 * plays it.
 * <ul>
 *   <li><b>The first mulligan is free</b> in every Commander game. Forge only makes it free with
 *       3+ players or in Brawl, so a 1v1 Commander game would cost a card.</li>
 *   <li><b>Cards go to the bottom when you keep</b> (London mulligan, CR 103.5): after a mulligan
 *       you see the new seven and decide again; only the hand you keep has cards put back. Forge
 *       asks for them straight after each mulligan, before you've decided to keep.</li>
 * </ul>
 */
public class WebPlayerController extends PlayerControllerHuman {

    public WebPlayerController(Game game, Player p, LobbyPlayer lp) {
        super(game, p, lp);
    }

    /** How many cards keeping this hand costs, given Forge's count. */
    static int cardsToBottom(Game g, int forgeCount) {
        boolean forgeFree = g.getPlayers().size() > 2 || g.getRules().hasAppliedVariant(GameType.Brawl);
        boolean commander = g.getRules().hasAppliedVariant(GameType.Commander);
        return Math.max(0, commander && !forgeFree ? forgeCount - 1 : forgeCount);
    }

    /** Called by Forge after each mulligan's draw. Defers the choice to {@link #mulliganKeepHand}. */
    @Override
    public CardCollectionView tuckCardsViaMulligan(CardCollectionView hand, int cardsToReturn) {
        int n = cardsToBottom(getGame(), cardsToReturn);
        // So many mulligans that nothing is left: Forge won't ask whether to keep, so put the hand back now.
        return n >= hand.size() ? new CardCollection(hand) : new CardCollection();
    }

    @Override
    public boolean mulliganKeepHand(Player mulliganingPlayer, int cardsToReturn) {
        boolean keep = super.mulliganKeepHand(mulliganingPlayer, cardsToReturn);
        if (keep) {
            CardCollectionView hand = player.getCardsIn(ZoneType.Hand);
            int n = Math.min(cardsToBottom(getGame(), cardsToReturn), hand.size());
            if (n > 0) {
                for (Card c : super.tuckCardsViaMulligan(hand, n)) {
                    getGame().getAction().moveToLibrary(c, -1, null);
                }
            }
        }
        return keep;
    }
}
