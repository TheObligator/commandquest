package forge.web.engine;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.GameType;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.player.PlayerControllerHuman;
import java.util.List;
import java.util.function.Consumer;

/**
 * A browser player's controller: Forge's human controller with the mulligan done as Commander
 * plays it.
 * <ul>
 *   <li><b>The first mulligan is free</b> in every Commander game. Forge only makes it free with
 *       3+ players or in Brawl, so a 1v1 Commander game would cost a card.</li>
 *   <li><b>Cards go to the bottom when you keep</b> (London mulligan, CR 103.5): after a mulligan
 *       you see the new seven and decide again; only the hand you keep has cards put back. Forge
 *       asks for them straight after each mulligan, before you've decided to keep.</li>
 *   <li><b>An automatic upkeep stop</b> when you can use an upkeep-only ability ({@link UpkeepStop}).</li>
 * </ul>
 */
public class WebPlayerController extends PlayerControllerHuman {

    /** Tells the player's browser something (a {@code notice}); may be null. */
    private final Consumer<String> notice;
    /** The card {@link UpkeepStop} found when this player last got priority, or null. */
    private volatile Card upkeepCard;
    /** Turn on which the player was last told about an automatic upkeep stop. */
    private int toldOnTurn = -1;

    public WebPlayerController(Game game, Player p, LobbyPlayer lp, Consumer<String> notice) {
        super(game, p, lp);
        this.notice = notice;
    }

    /** Runs on the game thread each time this player gets priority, before Forge decides whether to skip. */
    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        Card found = null;
        try {
            found = UpkeepStop.reason(getGame(), player);
        } catch (RuntimeException e) {
            // Never let the check break the game: without it you simply get your normal stops.
        }
        upkeepCard = found;
        return super.chooseSpellAbilityToPlay();
    }

    @Override
    public boolean isUiSetToSkipPhase(PlayerView turnPlayer, PhaseType phase) {
        boolean skip = super.isUiSetToSkipPhase(turnPlayer, phase);
        Card card = upkeepCard;
        if (!skip || phase != PhaseType.UPKEEP || card == null) {
            return skip;
        }
        int turn = getGame().getPhaseHandler().getTurn();
        if (notice != null && toldOnTurn != turn) {
            toldOnTurn = turn;
            notice.accept("Stopped in upkeep: " + card.getName() + " has an ability you can only use now.");
        }
        return false;
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
