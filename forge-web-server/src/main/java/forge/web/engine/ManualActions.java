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
import forge.game.combat.Combat;
import forge.game.event.GameEventCombatChanged;
import forge.game.phase.PhaseType;
import forge.game.zone.ZoneType;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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

    /**
     * Until-end-of-turn effects by hand, {@code eot:<key>}: what the log says it gave the card,
     * and the Forge ability that does it (Pump lasts until end of turn by default). Plus
     * {@code eot:pt:<±a>:<±d>} for +a/+d.
     */
    static final Map<String, String[]> EOT = new LinkedHashMap<>();
    private static final String UNBLOCKABLE_SVAR = "WebUnblockable";
    private static final Pattern EOT_PT = Pattern.compile("^pt:([+-]\\d{1,2}):([+-]\\d{1,2})$");

    static {
        String[][] keywords = {
            {"flying", "Flying"}, {"firstStrike", "First Strike"}, {"doubleStrike", "Double Strike"},
            {"trample", "Trample"}, {"haste", "Haste"}, {"vigilance", "Vigilance"}, {"lifelink", "Lifelink"},
            {"deathtouch", "Deathtouch"}, {"menace", "Menace"}, {"reach", "Reach"},
            {"indestructible", "Indestructible"}, {"hexproof", "Hexproof"}, {"shroud", "Shroud"},
            {"protWhite", "Protection from white"}, {"protBlue", "Protection from blue"},
            {"protBlack", "Protection from black"}, {"protRed", "Protection from red"},
            {"protGreen", "Protection from green"}, {"protEverything", "Protection from everything"},
        };
        for (String[] k : keywords) {
            EOT.put(k[0], new String[] {k[1].toLowerCase(java.util.Locale.ROOT), "DB$ Pump | Defined$ Self | KW$ " + k[1]});
        }
        String[][] hidden = {
            {"cantBlock", "can't block", "HIDDEN CARDNAME can't block."},
            {"cantAttack", "can't attack", "HIDDEN CARDNAME can't attack."},
            {"cantAttackOrBlock", "can't attack or block", "HIDDEN CARDNAME can't attack or block."},
            {"mustBeBlocked", "must be blocked if able", "HIDDEN CARDNAME must be blocked if able."},
            {"lure", "all creatures able to block it do so", "HIDDEN All creatures able to block CARDNAME do so."},
            {"switchPT", "power and toughness switched", "HIDDEN CARDNAME's power and toughness are switched"},
            {"preventDealtBy", "prevent all combat damage it would deal", "Prevent all combat damage that would be dealt by CARDNAME."},
            {"preventDealtTo", "prevent all damage that would be dealt to it", "Prevent all damage that would be dealt to CARDNAME."},
        };
        for (String[] h : hidden) {
            EOT.put(h[0], new String[] {h[1], "DB$ Pump | Defined$ Self | KW$ " + h[2]});
        }
        EOT.put("unblockable", new String[] {"can't be blocked",
                "DB$ Effect | RememberObjects$ Self | ExileOnMoved$ Battlefield | StaticAbilities$ " + UNBLOCKABLE_SVAR});
        EOT.put("control", new String[] {"control of it (untapped, with haste)",
                "DB$ GainControl | Defined$ Self | LoseControl$ EOT | Untap$ True | AddKWs$ Haste"});
    }

    /** Does {@code me} get to do {@code action} to this card by hand? */
    public static boolean allowed(Card card, Player me, String action) {
        // Effects on a permanent, like counters, may go on anyone's (an opponent's creature can't block,
        // gets -2/-2, comes over to you for the turn...). Everything else: your own cards only.
        if (card.isInPlay() && (action.startsWith("eot:") || action.equals("removeFromCombat") || action.equals("goad"))) {
            return !action.equals("eot:control") || card.getController() != me;
        }
        if (action.startsWith("cast:")) {
            return castable(card, me);
        }
        return card.isInPlay() ? card.getController() == me : card.getOwner() == me;
    }

    /**
     * May {@code me} be let cast this card by hand ({@code cast:}): your own card in exile or your
     * graveyard, or a face-down exiled card you may look at (one you exiled while searching
     * someone's library, say).
     */
    static boolean castable(Card card, Player me) {
        ZoneType z = card.getZone() == null ? null : card.getZone().getZoneType();
        if (z == ZoneType.Graveyard) {
            return card.getOwner() == me;
        }
        return z == ZoneType.Exile && (card.getOwner() == me || card.isFaceDown() && card.getView().mayPlayerLook(me.getView()));
    }

    private static final Pattern MANA_COST = Pattern.compile("^[0-9WUBRGCXS/ ]{1,30}$");
    private static final Pattern SUSPEND = Pattern.compile("^suspend:(\\d{1,2})$");

    /** The log text and Forge script for an {@code eot:} action, or null if it's not one we know. */
    static String[] eot(String action) {
        if (!action.startsWith("eot:")) {
            return null;
        }
        String key = action.substring(4);
        Matcher m = EOT_PT.matcher(key);
        if (m.matches()) {
            int a = Integer.parseInt(m.group(1));
            int d = Integer.parseInt(m.group(2));
            return a == 0 && d == 0 ? null : new String[] {String.format("%+d/%+d", a, d),
                    "DB$ Pump | Defined$ Self | NumAtt$ " + String.format("%+d", a) + " | NumDef$ " + String.format("%+d", d)};
        }
        return EOT.get(key);
    }

    /** The combat steps after attackers are declared, when a creature can be put into combat attacking. */
    static boolean afterAttackersDeclared(Game g) {
        PhaseType ph = g.getPhaseHandler().getPhase();
        return g.getCombat() != null && ph != null && ph.isAfter(PhaseType.COMBAT_BEGIN) && ph.isBefore(PhaseType.COMBAT_END);
    }

    /**
     * Runs a manual action. {@code to}: the players to reveal to (for "reveal"). Returns false if
     * the action is unknown or doesn't apply to this card where it is.
     */
    public boolean run(Game g, Player me, Card card, String action, List<Player> to, Runnable after) {
        boolean inPlay = card.isInPlay();
        ZoneType zone = g.getZoneOf(card) == null ? null : g.getZoneOf(card).getZoneType();
        String[] effect = eot(action);
        Matcher suspend = SUSPEND.matcher(action);
        if (suspend.matches() && zone == ZoneType.Hand) {
            int n = Math.max(1, Math.min(Integer.parseInt(suspend.group(1)), 20));
            return invoke(g, after, () -> {
                Card moved = g.getAction().moveTo(ZoneType.Exile, card, null, AbilityKey.newMap());
                if (moved == null) {
                    return;
                }
                moved.addCounterInternal(forge.game.card.CounterEnumType.TIME, n, me, false, null, null);
                // Like Jhoira of the Ghitu: if it doesn't have suspend, it gains suspend.
                if (!moved.hasKeyword(forge.game.keyword.Keyword.SUSPEND)) {
                    resolve(moved, me, "DB$ Pump | Defined$ Self | KW$ Suspend | PumpZone$ Exile | Duration$ Permanent");
                }
                log(g, me, "suspended " + moved.getName() + " with " + n + " time counter" + (n == 1 ? "" : "s"));
            });
        }
        if (action.startsWith("cast:")) {
            String how = action.substring(5);
            String extra = how.equals("pay") ? "" : how.equals("free") ? " | MayPlayWithoutManaCost$ True"
                    : how.startsWith("cost:") && MANA_COST.matcher(how.substring(5).trim()).matches() ? " | MayPlayAltManaCost$ " + how.substring(5).trim() : null;
            if (extra == null || !castable(card, me) || zone == null) {
                return false;
            }
            String desc = how.equals("pay") ? "paying its mana cost" : how.equals("free") ? "without paying its mana cost" : "for " + how.substring(5).trim();
            return invoke(g, after, () -> {
                SpellAbility sa = AbilityFactory.getAbility("DB$ Effect | RememberObjects$ Self | StaticAbilities$ WebMayPlay | ExileOnMoved$ " + zone.name() + " | Duration$ Permanent", card);
                sa.setActivatingPlayer(me);
                sa.setSVar("WebMayPlay", "Mode$ Continuous | Affected$ Card.IsRemembered | AffectedZone$ Exile,Graveyard | MayPlay$ True" + extra
                        + " | Description$ You may cast it " + desc + " (by hand).");
                AbilityUtils.resolve(sa);
                g.getAction().checkStaticAbilities();
                String name = card.isFaceDown() ? "a face-down card" : card.getName();
                log(g, me, "may now cast " + name + " from " + (zone == ZoneType.Exile ? "exile " : "their graveyard ") + desc);
            });
        }
        Combat combat = g.getCombat();
        Player defender = to == null || to.isEmpty() ? null : to.get(0);
        Runnable change = effect != null ? (inPlay ? () -> {
            SpellAbility sa = AbilityFactory.getAbility(effect[1], card);
            sa.setActivatingPlayer(me);
            sa.setSVar(UNBLOCKABLE_SVAR, "Mode$ CantBlockBy | ValidAttacker$ Card.IsRemembered | Description$ This creature can't be blocked this turn.");
            AbilityUtils.resolve(sa);
            g.getAction().checkStaticAbilities(); // so "can't be blocked" and the like apply right away
            String name = card.isFaceDown() ? "a face-down card" : card.getName();
            log(g, me, action.equals("eot:control") ? "gained control of " + name + " until end of turn (untapped, with haste)"
                    : "gave " + name + " " + effect[0] + " until end of turn");
        } : null) : switch (action) {
            case "attack" -> inPlay && card.isCreature() && card.getController() == me && afterAttackersDeclared(g)
                    && combat.getAttackingPlayer() == me && !combat.isAttacking(card) && defender != null
                    && combat.getDefenders().contains(defender) ? () -> {
                combat.removeFromCombat(card);
                if (!card.isTapped()) {
                    card.tap(null, me);
                }
                combat.addAttacker(card, defender);
                if (g.getPhaseHandler().getPhase().isAfter(PhaseType.COMBAT_DECLARE_ATTACKERS)) {
                    combat.getBandOfAttacker(card).setBlocked(false); // blockers are already declared: it's unblocked
                }
                g.updateCombatForView();
                g.fireEvent(new GameEventCombatChanged());
                log(g, me, "put " + card.getName() + " into combat tapped and attacking " + defender.getName());
            } : null;
            case "removeFromCombat" -> inPlay && combat != null && (combat.isAttacking(card) || combat.isBlocking(card)) ? () -> {
                combat.removeFromCombat(card);
                g.updateCombatForView();
                g.fireEvent(new GameEventCombatChanged());
                log(g, me, "removed " + card.getName() + " from combat");
            } : null;
            case "goad" -> inPlay && card.isCreature() && card.getController() != me ? () -> {
                resolve(card, me, "DB$ Goad | Defined$ Self");
                log(g, me, "goaded " + card.getName());
            } : null;
            case "phaseOut" -> inPlay && !card.isPhasedOut() ? () -> {
                String name = card.getName();
                resolve(card, me, "DB$ Phases | Defined$ Self");
                log(g, me, "phased out " + name);
            } : null;
            case "transform" -> inPlay && card.isTransformable() ? () -> {
                String name = card.getName();
                resolve(card, me, "DB$ SetState | Defined$ Self | Mode$ Transform");
                log(g, me, "transformed " + name + " into " + g.getCardState(card).getName());
            } : null;
            // Foretell by hand, as Forge's Foretell does: exiled face down, you may look at it, and it's
            // foretold (a card with foretell can then be cast for its foretell cost; any other card:
            // "Cast it ▸ for another cost").
            case "foretell" -> zone == ZoneType.Hand ? () -> {
                Card moved = g.getAction().moveTo(ZoneType.Exile, card, null, AbilityKey.newMap());
                if (moved != null) {
                    moved.setForetold(true);
                    moved.turnFaceDown(true);
                    moved.addMayLookFaceDownExile(me);
                    me.addForetoldThisTurn();
                    if (!moved.hasKeyword(forge.game.keyword.Keyword.FORETELL)) {
                        moved.setForetoldCostByEffect(true);
                    }
                    g.fireEvent(new forge.game.event.GameEventCardForetold(me.getView()));
                    log(g, me, "foretold a card");
                }
            } : null;
            // Exile face down; only the players in {@code to} may look at it (none: nobody).
            case "exileFaceDown" -> zone != ZoneType.Exile ? () -> {
                boolean wasHidden = zone == ZoneType.Hand || zone == ZoneType.Library;
                String name = wasHidden || card.isFaceDown() ? "a card" : card.getName();
                Card moved = g.getAction().moveTo(ZoneType.Exile, card, null, AbilityKey.newMap());
                if (moved != null) {
                    moved.turnFaceDown(true);
                    List<String> names = new ArrayList<>();
                    for (Player p : to == null ? List.<Player>of() : to) {
                        moved.addMayLookFaceDownExile(p);
                        names.add(p.getName());
                    }
                    log(g, me, "exiled " + name + " face down (" + (names.isEmpty() ? "nobody" : "only " + String.join(" and ", names)) + " may look at it)");
                }
            } : null;
            case "plot" -> zone == ZoneType.Hand ? () -> {
                Card moved = g.getAction().moveTo(ZoneType.Exile, card, null, AbilityKey.newMap());
                if (moved != null) {
                    moved.setPlotted(true);
                    log(g, me, "plotted " + moved.getName() + " (cast it free on a later turn, as a sorcery)");
                }
            } : null;
            case "discard" -> zone == ZoneType.Hand ? () -> {
                if (me.discard(card, null, false, AbilityKey.newMap()) != null) {
                    log(g, me, "discarded " + card.getName());
                }
            } : null;
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

    /**
     * Scry or surveil by hand ({@code kind} "scry" or "surveil"): {@code top} (top first) stays on
     * top and {@code away} goes to the bottom (scry) or the graveyard (surveil). Between them they
     * must be exactly your library's top cards. Done as Forge's own Scry / Surveil, so "whenever you
     * scry" triggers and the like happen. Returns false if it doesn't apply.
     */
    public boolean arrange(Game g, Player me, String kind, List<Integer> top, List<Integer> away, Runnable after) {
        int n = top.size() + away.size();
        List<Card> lib = new ArrayList<>(me.getCardsIn(ZoneType.Library));
        if (!(kind.equals("scry") || kind.equals("surveil")) || n < 1 || n > 99 || n > lib.size()
                || !(me.getController() instanceof WebPlayerController ctl)) {
            return false;
        }
        java.util.Set<Integer> want = new java.util.HashSet<>(top);
        want.addAll(away);
        java.util.Set<Integer> topIds = new java.util.HashSet<>();
        lib.subList(0, n).forEach(c -> topIds.add(c.getId()));
        if (want.size() != n || !want.equals(topIds)) {
            return false;
        }
        Card host = lib.get(0);
        g.getAction().invoke(() -> {
            try {
                ctl.arrangeNext(new WebPlayerController.Arrangement(List.copyOf(top), java.util.Set.copyOf(away)));
                SpellAbility sa = AbilityFactory.getAbility(kind.equals("scry") ? "DB$ Scry | ScryNum$ " + n : "DB$ Surveil | Amount$ " + n, host);
                sa.setActivatingPlayer(me);
                AbilityUtils.resolve(sa);
                ctl.arrangeNext(null);
                log(g, me, (kind.equals("scry") ? "scried " : "surveilled ") + n + ": " + top.size() + " on top, " + away.size()
                        + (kind.equals("scry") ? " on the bottom" : " into the graveyard"));
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
        boolean toHidden = to == ZoneType.Hand || to == ZoneType.Library;
        String name = hidden ? "a card" : card.isFaceDown() && (card.isInPlay() || toHidden) ? "a face-down card" : card.getName();
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

    private static boolean invoke(Game g, Runnable after, Runnable change) {
        g.getAction().invoke(() -> {
            try {
                change.run();
            } finally {
                after.run();
            }
        });
        return true;
    }

    /** Runs a Forge ability script on {@code card} as if {@code me} activated it. */
    private static void resolve(Card card, Player me, String script) {
        SpellAbility sa = AbilityFactory.getAbility(script, card);
        sa.setActivatingPlayer(me);
        AbilityUtils.resolve(sa);
        card.getGame().getAction().checkStaticAbilities();
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
