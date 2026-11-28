package forge.web.engine;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameType;
import forge.game.ability.ApiType;
import forge.game.cost.CostPart;
import forge.game.cost.CostPayLife;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.Player;
import forge.game.player.PlayerActionConfirmMode;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.input.Input;
import forge.gamemodes.match.input.InputConfirm;
import forge.gamemodes.match.input.InputPassPriority;
import forge.gamemodes.match.input.InputSelectEntitiesFromList;
import forge.gamemodes.match.input.InputSyncronizedBase;
import forge.gui.FThreads;
import forge.player.AutoYieldStore.TriggerDecision;
import forge.player.PlayerControllerHuman;
import forge.util.collect.FCollection;
import forge.util.collect.FCollectionView;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import forge.game.card.CardView;
import forge.util.Localizer;
import forge.util.MessageUtil;
import forge.util.ThreadUtil;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.tinylog.Logger;

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
 *   <li><b>Abilities put off to a step</b> are used there ({@link UseLater}).</li>
 *   <li><b>Revealed cards show in a window you close</b>, without stopping the game. Forge waits
 *       on an OK (with "End Turn" beside it) or a list to dismiss.</li>
 *   <li><b>Scry and surveil in one window</b> with the cards, for any number of cards. Forge asks
 *       about a single card by name, and about several in two steps.</li>
 *   <li><b>Conceding waits for a safe moment</b> ({@link #concede}).</li>
 * </ul>
 */
public class WebPlayerController extends PlayerControllerHuman {

    /** This player's browser; null when there's none (questions then go Forge's way). */
    private final BrowserSeat seat;
    /** This player's auto-yield and always yes / no settings, per ability. */
    private final AbilitySettings abilities;
    /** Abilities this player has put off to a step. */
    private final UseLater later;
    /** The card {@link UpkeepStop} found when this player last got priority, or null. */
    private volatile Card upkeepCard;
    /** Turn on which the player was last told about an automatic upkeep stop. */
    private int toldOnTurn = -1;

    public WebPlayerController(Game game, Player p, LobbyPlayer lp, BrowserSeat seat) {
        super(game, p, lp);
        this.seat = seat;
        this.abilities = seat == null ? new AbilitySettings() : seat.abilities();
        this.later = seat == null ? new UseLater() : seat.later();
    }

    // ---- Auto-yield and always yes / no: ours, with a scope per ability, instead of Forge's ----

    @Override
    public boolean shouldAutoYield(String key) {
        return !getYieldController().getDisableAutoYields() && abilities.autoYield(key);
    }

    @Override
    public void setShouldAutoYield(String key, boolean autoYield, boolean isAbilityScope) {
        abilities.setAutoYield(key, autoYield);
        super.setShouldAutoYield(key, autoYield, isAbilityScope); // passes priority now if it's on top of the stack
    }

    @Override
    public TriggerDecision getTriggerDecision(String key) {
        return getYieldController().getDisableAutoTriggers() ? TriggerDecision.ASK : abilities.decision(key);
    }

    @Override
    public void setTriggerDecision(String key, TriggerDecision decision, boolean isAbilityScope) {
        abilities.setDecision(key, decision);
        super.setTriggerDecision(key, decision, isAbilityScope); // answers it now if Forge is asking
    }

    /** For every copy of the ability, or only this card's. */
    public void setEveryCopy(String key, boolean every) {
        abilities.setEveryCopy(key, every);
    }

    /** What the player always answers to the "you may" of the triggered ability this effect is part of. */
    private TriggerDecision decisionFor(SpellAbility sa) {
        String key = sa != null && AbilitySettings.optional(sa) ? AbilitySettings.key(sa) : null;
        return key == null ? TriggerDecision.ASK : getTriggerDecision(key);
    }

    /**
     * "You may" asked by an effect as it resolves ("You may cast the copies"): always yes / no answers it.
     * Not the other things Forge confirms, like "cancel the search?" or "cancel choosing?", where yes means
     * stopping, or questions with their own two answers.
     */
    @Override
    public boolean confirmAction(SpellAbility sa, PlayerActionConfirmMode mode, String message,
                                 List<String> options, Card cardToShow, Map<String, Object> params) {
        boolean youMay = (mode == null || mode == PlayerActionConfirmMode.Random || mode == PlayerActionConfirmMode.ChangeZoneGeneral)
                && (options == null || options.isEmpty())
                && (message == null || !message.startsWith(CANCEL_SEARCH));
        if (youMay) {
            TriggerDecision d = decisionFor(sa);
            if (d != TriggerDecision.ASK) {
                return d == TriggerDecision.ACCEPT;
            }
        }
        return super.confirmAction(sa, mode, message, options, cardToShow, params);
    }

    /** Forge's "Cancel search? Up to N more cards can be selected.", up to the number. */
    private static final String CANCEL_SEARCH = cancelSearch();

    private static String cancelSearch() {
        String s = Localizer.getInstance().getMessage("lblCancelSearchUpToSelectNumCards", "#");
        int at = s.indexOf('#');
        return at > 0 ? s.substring(0, at) : s;
    }

    /** Always no also skips picking which card to cast ("You may cast the copies"); always yes still lets you pick. */
    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(FCollectionView<T> optionList, DelayedReveal delayedReveal,
            SpellAbility sa, String title, boolean isOptional, Player targetedPlayer, Map<String, Object> params) {
        if (isOptional && delayedReveal == null && sa != null && sa.getApi() == ApiType.Play
                && decisionFor(sa) == TriggerDecision.DECLINE) {
            return null;
        }
        return super.chooseSingleEntityForEffect(optionList, delayedReveal, sa, title, isOptional, targetedPlayer, params);
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

    // ---- Conceding: on the game's own thread, at a safe moment ----

    /** How often a concession that hasn't happened yet frees whatever the game waits on this player for. */
    private static final int SETTLE_MS = 250;
    /** The player is told why they're still in the game after this many of those. */
    private static final int SETTLE_NOTICE = 6;
    /** With nobody to wait for and no priority in this many of those (30 s), the game's thread is stuck or gone. */
    private static final int SETTLE_STUCK = 120;
    /** Out of the game, anything it still asks is freed for this many of those. */
    private static final int SETTLE_AFTER = 40;

    private volatile boolean conceding;
    /** Someone just left as this player was about to get priority: have Forge check the game over first. */
    private boolean askAgain;

    /**
     * Concedes at the next moment someone is about to get priority ({@link GameSession} takes it there, on the game
     * thread). Forge would take the player out of the game right here, on the forge-ui thread, while the game thread
     * may be halfway through something with their cards: it crashed, or looped forever looking for the next player.
     * Until then, everything the game asks this player is answered for them.
     */
    @Override
    public void concede() {
        if (player == null || conceding || player.hasLost() || GameSession.isOver(getGame())) {
            return;
        }
        conceding = true;
        settle(0, 0, 0);
    }

    /** The player has asked to leave and is still in the game. */
    boolean concessionDue() {
        return conceding && !player.hasLost();
    }

    /** See {@link #askAgain}. Game thread. */
    void askAgain() {
        askAgain = true;
    }

    private void settle(int tick, int idle, int after) {
        Game g = getGame();
        if (GameSession.isOver(g)) {
            return;
        }
        answerForThem();
        if (player.hasLost()) {
            after++;
        } else {
            // Nobody else's decision is cut short: only a priority prompt, which is asked again straight away.
            String waitingOn = null;
            for (Player p : g.getRegisteredPlayers()) {
                if (p == player || !(p.getController() instanceof PlayerControllerHuman other)) {
                    continue;
                }
                Input input = other.getInputQueue().getInput();
                if (input instanceof InputPassPriority prompt) {
                    prompt.restartPrompt();
                } else if (input != null || (other instanceof WebPlayerController w && w.seat != null && w.seat.asking())) {
                    waitingOn = p.getName();
                }
            }
            idle = waitingOn == null ? idle + 1 : 0;
            if (idle >= SETTLE_STUCK) {
                Logger.warn("{} conceded and the game hasn't moved for {} s: taking them out of it now", player.getName(), SETTLE_STUCK * SETTLE_MS / 1000);
                super.concede();
                return;
            }
            if (tick == SETTLE_NOTICE && seat != null) {
                seat.notice("Conceding: you're out as soon as " + (waitingOn == null ? "the game finishes what it's doing." : waitingOn + " has chosen."));
            }
        }
        if (after >= SETTLE_AFTER) {
            return;
        }
        int nextIdle = idle;
        int nextAfter = after;
        ThreadUtil.delay(SETTLE_MS, () -> {
            if (seat != null) {
                seat.answerOpenWithDefaults(); // here too: the forge-ui thread may itself be waiting on one
            }
            FThreads.invokeInEdtLater(() -> settle(tick + 1, nextIdle, nextAfter));
        });
    }

    /** Frees whatever the game waits on this player for. */
    private void answerForThem() {
        if (seat != null) {
            seat.answerOpenWithDefaults();
        }
        Input input = getInputQueue().getInput();
        if (input instanceof InputPassPriority prompt) {
            prompt.restartPrompt();
        } else if (input instanceof InputSyncronizedBase waiting) {
            waiting.stop();
        }
    }

    /** Runs on the game thread each time this player gets priority, before Forge decides whether to skip. */
    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        if (askAgain || player.hasLost()) {
            askAgain = false;
            return List.of(); // not a pass: Forge checks the game over and comes back
        }
        if (comboActive()) {
            return super.chooseSpellAbilityToPlay(); // every pass is the player's own
        }
        if (dueNow()) {
            return List.of(auto);
        }
        if (passingUntilMyTurn() || passOwnAbility()) {
            getGui().awaitNextInput();
            later.passed();
            return null; // pass
        }
        Card found = null;
        try {
            found = UpkeepStop.reason(getGame(), player);
        } catch (RuntimeException e) {
            // Never let the check break the game: without it you simply get your normal stops.
        }
        upkeepCard = found;
        List<SpellAbility> chosen = super.chooseSpellAbilityToPlay();
        if (chosen == null) {
            stopHere = false;
            later.passed();
        }
        return chosen;
    }

    /** The browser seat this controller answers for (null in some tests). */
    public BrowserSeat seat() {
        return seat;
    }

    // ---- Combos: while recording or running one, nothing is skipped or answered for the player ----

    private boolean comboActive() {
        return seat != null && seat.combos().active();
    }

    @Override
    public boolean isMacroActive() {
        return comboActive() || super.isMacroActive();
    }

    // ---- Use later: an ability put off to this step ----

    /** The ability being used for the player, or just used. */
    private volatile SpellAbility auto;
    /** True while {@link #auto} is being put on the stack: its costs are paid without asking. */
    private boolean playingAuto;
    /** The stack item of an ability used for the player, which they then pass on as they would have; -1: none. */
    private int passOn = -1;
    /** Give the player priority here even without a stop (until they pass). */
    private volatile boolean stopHere;
    /** Paying life for an ability used for the player asks first when it would leave them with less than this. */
    static final int KEEP_LIFE = 5;

    public UseLater later() {
        return later;
    }

    /** An ability put off until now is to be used ({@link #auto}). Also ends auto-passing when the player has to decide about one. */
    private boolean dueNow() {
        UseLater.Next next;
        try {
            next = later.next(getGame(), player);
        } catch (RuntimeException e) {
            Logger.warn(e, "Couldn't check the abilities put off until later");
            return false;
        }
        if (next.ability() != null) {
            auto = next.ability();
            return true;
        }
        if (next.stop()) {
            stopForPlayer();
        }
        if (next.notice() != null && seat != null) {
            seat.notice(next.notice());
        }
        return false;
    }

    private void stopForPlayer() {
        stopHere = true;
        passingFrom = -1;
        getYieldController().applyInterrupt();
        if (seat != null) {
            seat.refresh();
        }
    }

    /** The ability just used for the player is on top of the stack: pass on it, once. */
    private boolean passOwnAbility() {
        int id = passOn;
        passOn = -1;
        var top = getGame().getStack().peek();
        return id >= 0 && top != null && top.getId() == id;
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility chosenSa) {
        boolean forPlayer = chosenSa == auto;
        String label = UseLater.applies(chosenSa) ? UseLater.label(chosenSa) : null;
        Card host = chosenSa.getHostCard();
        boolean played;
        playingAuto = forPlayer;
        try {
            played = super.playChosenSpellAbility(chosenSa);
        } finally {
            playingAuto = false;
            auto = null;
        }
        if (played && label != null) {
            later.used(host.getId(), label);
        }
        if (forPlayer) {
            var top = getGame().getStack().peek();
            if (!played) {
                stopForPlayer(); // they backed out (of choosing a target, say): it's theirs to decide
            } else if (top != null && top.getActivatingPlayer() == player && top.getSourceCard() != null && top.getSourceCard().getId() == host.getId()) {
                passOn = top.getId();
            }
        }
        return played;
    }

    /** Costs of an ability used for the player: they said to use it, so no "do you want to sacrifice it?". */
    @Override
    public boolean confirmPayment(CostPart part, String question, SpellAbility sa) {
        if (playingAuto && auto != null && sa.getHostCard() == auto.getHostCard()
                && !(part instanceof CostPayLife && player.getLife() - part.getAbilityAmount(sa) < KEEP_LIFE)) {
            return true;
        }
        return super.confirmPayment(part, question, sa);
    }

    @Override
    public boolean isUiSetToSkipPhase(PlayerView turnPlayer, PhaseType phase) {
        if (comboActive()) {
            return false;
        }
        boolean skip = super.isUiSetToSkipPhase(turnPlayer, phase);
        if (skip && stopHere) {
            return false;
        }
        Card card = upkeepCard;
        if (!skip || phase != PhaseType.UPKEEP || card == null) {
            return skip;
        }
        int turn = getGame().getPhaseHandler().getTurn();
        if (seat != null && toldOnTurn != turn) {
            toldOnTurn = turn;
            seat.notice("Stopped in upkeep: " + card.getName() + " has an ability you can only use now.");
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
        while (!conceding) {
            InputConfirm first = new InputConfirm(this, "Do you want to play first?\n" + why, "Yes", "No", true);
            first.showAndWait();
            if (conceding || first.getResult()) {
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
        return player; // they concede once the game gets going
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
        boolean keep = !conceding && super.mulliganKeepHand(mulliganingPlayer, cardsToReturn);
        if (conceding) {
            return true; // they concede once the game gets going
        }
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
        if (p != null || seat == null) {
            return p != null ? p : super.arrangeForScry(topN);
        }
        getGame().getUndoManager().barrier("Scry");
        return topOrAway(topN, "Scry " + topN.size(), "bottom");
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(CardCollection topN) {
        ImmutablePair<CardCollection, CardCollection> p = planned(topN);
        if (p != null || seat == null) {
            return p != null ? p : super.arrangeForSurveil(topN);
        }
        getGame().getUndoManager().barrier("Surveil");
        return topOrAway(topN, "Surveil " + topN.size(), "graveyard");
    }

    /**
     * Asks in one window where each of {@code topN} goes: on top of the library (in an order) or
     * {@code away} ("bottom" or "graveyard"). Returns (top, away), top card first; null for an
     * empty pile. Without an answer (the browser left), everything stays on top as it was.
     */
    private ImmutablePair<CardCollection, CardCollection> topOrAway(CardCollection topN, String title, String away) {
        tempShowCards(topN);
        try {
            List<CardView> views = new ArrayList<>();
            topN.forEach(c -> views.add(c.getView()));
            List<List<Integer>> piles = seat.arrangeTop(title, views, away);
            if (piles == null) {
                return ImmutablePair.of(new CardCollection(topN), null);
            }
            CardCollection top = new CardCollection();
            CardCollection rest = new CardCollection();
            piles.get(0).forEach(i -> top.add(topN.get(i)));
            piles.get(1).forEach(i -> rest.add(topN.get(i)));
            return ImmutablePair.of(top.isEmpty() ? null : top, rest.isEmpty() ? null : rest);
        } finally {
            endTempShowCards();
        }
    }

    /**
     * Cards revealed to this player (an opponent's hand, a card someone revealed, a library you
     * searched and found nothing in): a window the player closes, while the game goes on.
     */
    @Override
    protected void reveal(CardCollectionView cards, ZoneType zone, PlayerView owner, String message, boolean addSuffix) {
        if (seat == null) {
            super.reveal(cards, zone, owner, message, addSuffix);
            return;
        }
        getGame().getUndoManager().barrier("Information revealed");
        Localizer loc = Localizer.getInstance();
        String zoneName = zone.getTranslatedName().toLowerCase();
        if (StringUtils.isBlank(message)) {
            message = loc.getMessage("lblLookCardInPlayerZone", "{player's}", zoneName);
        } else if (addSuffix) {
            message += " " + loc.getMessage("lblPlayerZone", "{player's}", zoneName);
        }
        String title = MessageUtil.formatMessage(message, getLocalPlayerView(), owner);
        List<CardView> views = new ArrayList<>();
        cards.forEach(c -> views.add(c.getView()));
        String note = views.isEmpty()
                ? MessageUtil.formatMessage(loc.getMessage("lblThereNoCardInPlayerZone", "{player's}", zoneName), getLocalPlayerView(), owner)
                : null;
        seat.showCards(title, views, note);
    }
}
