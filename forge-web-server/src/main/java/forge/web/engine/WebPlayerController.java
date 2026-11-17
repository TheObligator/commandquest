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
import forge.gamemodes.match.input.InputConfirm;
import forge.gamemodes.match.input.InputSelectEntitiesFromList;
import forge.player.PlayerControllerHuman;
import forge.util.collect.FCollection;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.apache.commons.lang3.tuple.ImmutablePair;
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

    /**
     * "Pass until my turn, through everything" (MTGO's F6): the turn it was chosen on, or -1 when off.
     * Unlike Forge's yields, an opponent casting something doesn't end it; it passes every priority
     * until this player's next turn starts. Decisions only you can make (blockers, choices for your
     * triggers) still ask you.
     */
    private volatile int passingFrom = -1;

    public void setPassUntilMyTurn(boolean on) {
        passingFrom = on ? getGame().getPhaseHandler().getTurn() : -1;
    }

    /** Whether {@link #setPassUntilMyTurn} is still going; it ends when this player's next turn starts. */
    public boolean passingUntilMyTurn() {
        int from = passingFrom;
        if (from < 0) {
            return false;
        }
        var ph = getGame().getPhaseHandler();
        if (ph.getTurn() > from && ph.isPlayerTurn(player)) {
            passingFrom = -1;
            return false;
        }
        return true;
    }

    /** Runs on the game thread each time this player gets priority, before Forge decides whether to skip. */
    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        if (passingUntilMyTurn()) {
            getGui().awaitNextInput();
            return null; // pass
        }
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

    /**
     * Whoever wins the die roll is asked whether to play first: Yes (OK, Space) and they do. No in a
     * two-player game hands it to the opponent; with more players, you then click the seat of the
     * player who goes first, or Cancel to be asked again. (Forge asks "play or draw" in 1v1 and goes
     * straight to a player list in multiplayer.)
     */
    @Override
    public Player chooseStartingPlayer(boolean isFirstGame) {
        List<Player> others = new ArrayList<>(getGame().getPlayersInTurnOrder());
        others.remove(player);
        if (others.isEmpty()) {
            return player;
        }
        String why = isFirstGame ? "You won the die roll." : "You lost the last game, so you choose who starts.";
        while (true) {
            InputConfirm first = new InputConfirm(this, "Do you want to play first?\n" + why, "Yes", "No", true);
            first.showAndWait();
            if (first.getResult()) {
                return player;
            }
            if (others.size() == 1) {
                return others.get(0);
            }
            // Forge formats this message with String.format, so it must not contain a percent sign.
            InputSelectEntitiesFromList<Player> pick = new InputSelectEntitiesFromList<>(this, 1, 1, new FCollection<>(others));
            pick.setMessage("Who plays first?\nClick the player who goes first, or Cancel to go back.");
            pick.setCancelAllowed(true);
            pick.showAndWait();
            Player chosen = pick.hasCancelled() ? null : pick.getFirstSelected();
            if (chosen != null) {
                return chosen;
            }
        }
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

    /** A scry or surveil done by hand: the cards to keep on top (top first) and the ones to put away, by id. */
    public record Arrangement(List<Integer> top, Collection<Integer> away) { }

    /** Set just before a scry or surveil by hand ({@link ManualActions#arrange}); used once, by the next one. */
    private volatile Arrangement arrangement;

    void arrangeNext(Arrangement a) {
        arrangement = a;
    }

    /** The planned split of {@code topN}: cards the plan doesn't name stay on top, after the ones it does. */
    private ImmutablePair<CardCollection, CardCollection> planned(CardCollection topN) {
        Arrangement a = arrangement;
        arrangement = null;
        if (a == null) {
            return null;
        }
        CardCollection top = new CardCollection();
        CardCollection away = new CardCollection();
        for (int id : a.top()) {
            topN.stream().filter(c -> c.getId() == id).findFirst().ifPresent(top::add);
        }
        List<Card> rest = new ArrayList<>(topN);
        rest.removeAll(top);
        for (Card c : rest) {
            (a.away().contains(c.getId()) ? away : top).add(c);
        }
        return ImmutablePair.of(top, away);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(CardCollection topN) {
        ImmutablePair<CardCollection, CardCollection> p = planned(topN);
        return p != null ? p : super.arrangeForScry(topN);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(CardCollection topN) {
        ImmutablePair<CardCollection, CardCollection> p = planned(topN);
        return p != null ? p : super.arrangeForSurveil(topN);
    }
}
