package forge.web.engine;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.GameType;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardView;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import forge.player.PlayerControllerHuman;
import java.util.ArrayList;
import java.util.List;
import org.apache.commons.lang3.tuple.ImmutablePair;

/**
 * A browser player's controller: Forge's human controller with the mulligan done as Commander
 * plays it.
 * <ul>
 *   <li><b>The first mulligan is free</b> in every Commander game. Forge only makes it free with
 *       3+ players or in Brawl, so a 1v1 Commander game would cost a card.</li>
 *   <li><b>Cards go to the bottom when you keep</b> (London mulligan, CR 103.5): after a mulligan
 *       you see the new seven and decide again; only the hand you keep has cards put back. Forge
 *       asks for them straight after each mulligan, before you've decided to keep.</li>
 *   <li><b>Scry and surveil in one window</b>: the cards, a pile for each place they can go, and
 *       the order. Forge asks in two steps (which go to the bottom, then the order of the rest).</li>
 * </ul>
 */
public class WebPlayerController extends PlayerControllerHuman {

    private final BrowserSeat seat;

    public WebPlayerController(Game game, Player p, LobbyPlayer lp, BrowserSeat seat) {
        super(game, p, lp);
        this.seat = seat;
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(CardCollection topN) {
        if (seat == null) {
            return super.arrangeForScry(topN);
        }
        getGame().getUndoManager().barrier("Scry");
        return topOr(topN, "Scry " + topN.size(), "Bottom of library", true,
                "Choose which cards go on the bottom, and the order of each pile.");
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(CardCollection topN) {
        if (seat == null) {
            return super.arrangeForSurveil(topN);
        }
        getGame().getUndoManager().barrier("Surveil");
        return topOr(topN, "Surveil " + topN.size(), "Graveyard", false,
                "Choose which cards go into your graveyard, and the order of the rest.");
    }

    /**
     * One arrange question: {@code topN} start on top of your library; each can go to {@code other}
     * instead. Returns (top, other), top first; null for an empty pile, as Forge expects.
     */
    private ImmutablePair<CardCollection, CardCollection> topOr(CardCollection topN, String title, String other, boolean otherOrdered, String message) {
        tempShowCards(topN);
        try {
            List<CardView> views = new ArrayList<>();
            topN.forEach(c -> views.add(c.getView()));
            List<List<CardView>> piles = seat.arrange(title, message, views,
                    List.of(new BrowserSeat.Pile("Top of library", true), new BrowserSeat.Pile(other, otherOrdered)),
                    List.of(views, List.of()));
            return ImmutablePair.of(cards(topN, piles.get(0)), cards(topN, piles.get(1)));
        } finally {
            endTempShowCards();
        }
    }

    private static CardCollection cards(CardCollection from, List<CardView> views) {
        if (views.isEmpty()) {
            return null;
        }
        CardCollection out = new CardCollection();
        for (CardView v : views) {
            for (Card c : from) {
                if (c.getId() == v.getId()) {
                    out.add(c);
                }
            }
        }
        return out;
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
