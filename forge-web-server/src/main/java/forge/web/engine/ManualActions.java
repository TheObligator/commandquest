package forge.web.engine;

import forge.game.Game;
import forge.game.GameLogEntryType;
import forge.game.ability.AbilityFactory;
import forge.game.ability.AbilityKey;
import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Manual overrides from a card's right-click menu: things players do by hand at a paper table
 * (tap a land, turn a card face down, move a card to another zone, make a token copy, reveal a
 * card). They skip the rules, so the game log notes each one "(by hand)". Each runs on Forge's
 * game thread, like Forge's own developer tools.
 */
public final class ManualActions {

    /** Forge's keyword for "doesn't untap during its controller's next untap step" (removed after that step). */
    public static final String NO_UNTAP = "This card doesn't untap during your next untap step.";

    /** Cards that never untap by themselves: {@link #keepLocked} puts {@link #NO_UNTAP} back after each untap step. */
    private final Set<Integer> neverUntap = ConcurrentHashMap.newKeySet();

    /** Does {@code me} get to do {@code action} to this card by hand? Your own cards only. */
    public static boolean allowed(Card card, Player me) {
        return card.isInPlay() ? card.getController() == me : card.getOwner() == me;
    }

    /**
     * Runs a manual action. {@code to}: the players to reveal to (for "reveal"). Returns false if
     * the action is unknown or doesn't apply to this card where it is.
     */
    public boolean run(Game g, Player me, Card card, String action, List<Player> to, Runnable after) {
        boolean inPlay = card.isInPlay();
        ZoneType zone = g.getZoneOf(card) == null ? null : g.getZoneOf(card).getZoneType();
        Runnable change = switch (action) {
            case "tap" -> inPlay && !card.isTapped() ? () -> {
                card.tap(null, me);
                log(g, me, "tapped " + card.getName());
            } : null;
            case "untap" -> inPlay && card.isTapped() ? () -> {
                card.untap();
                log(g, me, "untapped " + card.getName());
            } : null;
            case "faceDown" -> inPlay && !card.isFaceDown() ? () -> {
                String name = card.getName();
                if (card.turnFaceDown(true)) {
                    log(g, me, "turned " + name + " face down");
                }
            } : null;
            case "faceUp" -> inPlay && card.isFaceDown() ? () -> {
                if (card.turnFaceUp(null)) {
                    log(g, me, "turned " + card.getName() + " face up");
                }
            } : null;
            case "skipUntap" -> inPlay ? () -> {
                lock(g, card);
                log(g, me, "set " + card.getName() + " not to untap during its next untap step");
            } : null;
            case "neverUntap" -> inPlay ? () -> {
                neverUntap.add(card.getId());
                lock(g, card);
                log(g, me, "set " + card.getName() + " never to untap by itself");
            } : null;
            case "untapNormally" -> inPlay ? () -> {
                neverUntap.remove(card.getId());
                card.removeHiddenExtrinsicKeyword(NO_UNTAP);
                log(g, me, "let " + card.getName() + " untap normally again");
            } : null;
            case "tokenCopy" -> inPlay ? () -> {
                SpellAbility sa = AbilityFactory.getAbility("DB$ CopyPermanent | Defined$ Self", card);
                sa.setActivatingPlayer(me);
                AbilityUtils.resolve(sa);
                log(g, me, "created a token copy of " + card.getName());
            } : null;
            case "toBattlefield" -> zone != ZoneType.Battlefield && card.isPermanent() ? () -> move(g, me, card, ZoneType.Battlefield, 0, "put %s onto the battlefield") : null;
            case "toHand" -> zone != ZoneType.Hand ? () -> move(g, me, card, ZoneType.Hand, 0,
                    zone == ZoneType.Battlefield ? "returned %s to hand" : "put %s into their hand") : null;
            case "toGraveyard" -> zone != ZoneType.Graveyard ? () -> move(g, me, card, ZoneType.Graveyard, 0, "put %s into the graveyard") : null;
            case "toExile" -> zone != ZoneType.Exile ? () -> move(g, me, card, ZoneType.Exile, 0, "exiled %s") : null;
            case "toCommand" -> zone != ZoneType.Command ? () -> move(g, me, card, ZoneType.Command, 0, "put %s into the command zone") : null;
            case "toLibraryTop" -> () -> move(g, me, card, ZoneType.Library, 0, "put %s on top of the library");
            case "toLibraryBottom" -> () -> move(g, me, card, ZoneType.Library, -1, "put %s on the bottom of the library");
            case "reveal" -> to != null && !to.isEmpty() ? () -> {
                List<String> names = new ArrayList<>();
                to.forEach(p -> names.add(p.getName()));
                log(g, me, "revealed " + card.getName() + " to " + String.join(", ", names));
                g.getAction().revealTo(new CardCollection(card), to, me.getName() + " reveals", true);
            } : null;
            default -> null;
        };
        if (change == null) {
            return false;
        }
        g.getAction().invoke(() -> {
            try {
                change.run();
            } finally {
                after.run();
            }
        });
        return true;
    }

    /**
     * A manual action on your own library: {@code draw}, {@code mill} (to the graveyard),
     * {@code exile} (face up) the top {@code n} cards, {@code revealTop} to {@code to}, or
     * {@code shuffle}. Returns false if it doesn't apply (an empty library, say).
     */
    public boolean library(Game g, Player me, String action, int n, List<Player> to, Runnable after) {
        int count = Math.max(1, Math.min(n, 99));
        int size = me.getCardsIn(ZoneType.Library).size();
        Runnable change = switch (action) {
            case "draw" -> size > 0 ? () -> {
                int drawn = me.drawCards(Math.min(count, size)).size();
                log(g, me, "drew " + cards(drawn));
            } : null;
            case "mill", "exile" -> size > 0 ? () -> {
                List<Card> top = new ArrayList<>(me.getCardsIn(ZoneType.Library).subList(0, Math.min(count, size)));
                List<String> names = new ArrayList<>();
                for (Card c : top) {
                    Card moved = action.equals("mill")
                            ? g.getAction().moveToGraveyard(c, null, AbilityKey.newMap())
                            : g.getAction().moveTo(ZoneType.Exile, c, null, AbilityKey.newMap());
                    if (moved != null) {
                        names.add(moved.getName());
                    }
                }
                String what = action.equals("mill") ? "milled " + cards(names.size()) : "exiled the top " + (names.size() == 1 ? "card" : names.size() + " cards") + " of their library";
                log(g, me, what + ": " + String.join(", ", names));
            } : null;
            case "revealTop" -> size > 0 && to != null && !to.isEmpty() ? () -> {
                Card top = me.getCardsIn(ZoneType.Library).get(0);
                log(g, me, "revealed the top card of their library: " + top.getName());
                g.getAction().revealTo(new CardCollection(top), to, me.getName() + " reveals the top of their library", true);
            } : null;
            case "shuffle" -> () -> {
                me.shuffle(null);
                log(g, me, "shuffled their library");
            };
            default -> null;
        };
        if (change == null) {
            return false;
        }
        g.getAction().invoke(() -> {
            try {
                change.run();
            } finally {
                after.run();
            }
        });
        return true;
    }

    /** Notes in the log that {@code me} searched their library ({@code top} 0) or looked at its top cards. */
    public static void logLook(Game g, Player me, int top) {
        log(g, me, top <= 0 ? "searched their library" : "looked at the top " + cards(top) + " of their library");
    }

    private static String cards(int n) {
        return n == 1 ? "a card" : n + " cards";
    }

    private static void move(Game g, Player me, Card card, ZoneType to, int libPosition, String what) {
        ZoneType from = g.getZoneOf(card) == null ? null : g.getZoneOf(card).getZoneType();
        boolean hidden = (from == ZoneType.Hand || from == ZoneType.Library) && (to == ZoneType.Hand || to == ZoneType.Library);
        String name = hidden ? "a card" : card.isFaceDown() && card.isInPlay() ? "a face-down card" : card.getName();
        Card moved;
        if (to == ZoneType.Library) {
            moved = g.getAction().moveToLibrary(card, libPosition, null, AbilityKey.newMap());
        } else if (to == ZoneType.Battlefield) {
            moved = g.getAction().moveToPlay(card, me, null, AbilityKey.newMap());
        } else {
            moved = g.getAction().moveTo(to, card, null, AbilityKey.newMap());
        }
        if (moved != null) {
            g.getGameLog().add(GameLogEntryType.ZONE_CHANGE, me.getName() + " " + String.format(what, name).replace("the library", "their library") + " (by hand)");
        }
    }

    private static void lock(Game g, Card card) {
        if (!card.hasKeyword(NO_UNTAP)) {
            card.addHiddenExtrinsicKeywords(g.getNextTimestamp(), 0, List.of(NO_UNTAP));
        }
    }

    /** Puts "doesn't untap" back on cards that never untap by themselves (Forge removes it each untap step). */
    public void keepLocked(Game g) {
        if (neverUntap.isEmpty()) {
            return;
        }
        for (Integer id : neverUntap) {
            Card c = g.findById(id);
            if (c == null || !c.isInPlay()) {
                neverUntap.remove(id);
            } else if (!c.hasKeyword(NO_UNTAP)) {
                lock(g, c);
            }
        }
    }

    /** "never", "next" or null: how a permanent is kept from untapping by hand. */
    public String untapLock(Card c) {
        if (neverUntap.contains(c.getId())) {
            return "never";
        }
        return c.hasKeyword(NO_UNTAP) ? "next" : null;
    }

    private static void log(Game g, Player me, String what) {
        g.getGameLog().add(GameLogEntryType.INFORMATION, me.getName() + " " + what + " (by hand)");
    }
}
