package forge.web.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.card.CardType.CoreType;
import forge.game.GameEntityView;
import forge.game.GameLogEntry;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.card.CardView.CardStateView;
import forge.game.card.CounterEnumType;
import forge.game.card.CounterType;
import forge.game.combat.CombatView;
import forge.game.player.PlayerView;
import forge.game.spellability.StackItemView;
import forge.game.zone.ZoneType;
import java.util.ArrayList;
import java.util.List;

/**
 * Forge's game view as one player sees it, in the JSON shape of the client's {@code GameView}
 * (web/src/game/view.ts). Hidden information is removed here, on the server, so a browser never
 * receives what its player can't see: other hands and every library are counts only, and a
 * face-down card keeps only its public facts unless Forge lets this player look at it
 * ({@code CardView.canBeShownTo} / {@code canFaceDownBeShownTo}).
 *
 * <p>Read Forge's views on the game thread (as {@link BrowserSeat} does) so the snapshot is consistent.
 */
public final class ViewJson {

    /** Seat colors in seating order, matching the client's simulated table. */
    static final String[] SEAT_COLORS = {"#e0a84f", "#6aa9ff", "#d46ad8", "#58c98a", "#e06a6a", "#5fd3d3", "#c9b458", "#9a8cff"};
    private static final int LOG_LINES = 80;

    private final ObjectMapper json;

    public ViewJson(ObjectMapper json) {
        this.json = json;
    }

    public static String id(PlayerView p) {
        return p == null ? null : String.valueOf(p.getId());
    }

    public ObjectNode game(GameView gv, PlayerView viewer) {
        ObjectNode o = json.createObjectNode();
        List<PlayerView> seating = new ArrayList<>();
        gv.getPlayers().forEach(seating::add);
        int me = Math.max(0, seating.indexOf(viewer));

        o.put("viewer", id(viewer));
        ArrayNode players = o.putArray("players");
        for (int i = 0; i < seating.size(); i++) { // turn order, starting with the viewer
            int seat = (me + i) % seating.size();
            players.add(player(gv, seating.get(seat), viewer, seating, seat));
        }

        ArrayNode stack = o.putArray("stack"); // bottom first, like the client's (top is last)
        List<StackItemView> items = new ArrayList<>();
        if (gv.getStack() != null) {
            gv.getStack().forEach(items::add); // Forge lists the top first
        }
        for (int i = items.size() - 1; i >= 0; i--) {
            stack.add(stackItem(gv, items.get(i), viewer));
        }

        o.put("turn", gv.getTurn());
        o.put("active", id(gv.getPlayerTurn()));
        o.put("step", gv.getPhase() == null ? "UNTAP" : gv.getPhase().name());
        o.put("gameOver", gv.isGameOver());
        ArrayNode log = o.putArray("log"); // oldest first
        if (gv.getGameLog() != null) {
            List<GameLogEntry> entries = gv.getGameLog().getLogEntries(null); // newest first
            for (int i = Math.min(entries.size(), LOG_LINES) - 1; i >= 0; i--) {
                log.add(entries.get(i).message());
            }
        }
        return o;
    }

    private ObjectNode player(GameView gv, PlayerView p, PlayerView viewer, List<PlayerView> seating, int seat) {
        ObjectNode o = json.createObjectNode();
        o.put("id", id(p));
        o.put("name", p.getName());
        o.put("color", SEAT_COLORS[seat % SEAT_COLORS.length]);
        o.put("life", p.getLife());
        o.put("poison", p.getCounters(CounterEnumType.POISON));
        ObjectNode cmdDmg = o.putObject("commanderDamage");
        for (PlayerView owner : seating) {
            int total = 0;
            for (CardView c : commanders(owner)) {
                total += p.getCommanderDamage(c);
            }
            if (total > 0) {
                cmdDmg.put(id(owner), total);
            }
        }
        int casts = 0;
        for (CardView c : commanders(p)) {
            casts += p.getCommanderCast(c);
        }
        o.put("commanderCasts", casts);
        o.put("libraryCount", p.getZoneSize(ZoneType.Library));
        o.put("handCount", p.getZoneSize(ZoneType.Hand));
        o.set("hand", cards(gv, p.equals(viewer) ? p.getHand() : null, viewer));
        o.set("battlefield", cards(gv, p.getBattlefield(), viewer));
        o.set("graveyard", cards(gv, p.getGraveyard(), viewer));
        o.set("exile", cards(gv, p.getExile(), viewer));
        o.set("command", cards(gv, p.getCommand(), viewer));
        return o;
    }

    /** Empty (not null) before Forge has set up the commanders. */
    private static List<CardView> commanders(PlayerView p) {
        List<CardView> c = p.getCommanders();
        return c == null ? List.of() : c;
    }

    private ArrayNode cards(GameView gv, Iterable<CardView> cards, PlayerView viewer) {
        ArrayNode a = json.createArrayNode();
        if (cards != null) {
            for (CardView c : cards) {
                a.add(card(gv, c, viewer));
            }
        }
        return a;
    }

    public ObjectNode card(GameView gv, CardView c, PlayerView viewer) {
        ObjectNode o = json.createObjectNode();
        o.put("id", c.getId());
        o.put("owner", id(c.getOwner()));
        o.put("controller", id(c.getController() != null ? c.getController() : c.getOwner()));
        o.put("zone", zone(c.getZone()));
        boolean onBattlefield = c.getZone() == ZoneType.Battlefield;
        if (c.isFaceDown()) {
            o.put("faceDown", true);
        }
        CardStateView state = c.getCurrentState();
        boolean seen = c.canBeShownTo(viewer) && (!c.isFaceDown() || c.canFaceDownBeShownTo(viewer));
        if (seen) {
            CardStateView face = c.isFaceDown() && c.getAlternateState() != null ? c.getAlternateState() : state;
            o.put("name", face.getName());
            ArrayNode types = o.putArray("types");
            for (CoreType t : face.getType().getCoreTypes()) {
                types.add(t.name());
            }
            if (c.isToken()) {
                o.put("token", true);
            }
            if (c.isCommander()) {
                o.put("commander", true);
            }
        } else {
            o.put("hidden", true);
        }
        if (!onBattlefield) {
            return o;
        }
        // Public facts about a permanent, even a face-down one (a face-down permanent's 2/2 is public).
        if (c.isTapped()) {
            o.put("tapped", true);
        }
        if (state.getType().isCreature() || c.isFaceDown()) {
            o.put("power", state.getPower());
            o.put("toughness", state.getToughness());
        }
        if (c.isSick() && state.getType().isCreature()) {
            o.put("sick", true);
        }
        if (c.getCounters() != null && !c.getCounters().isEmpty()) {
            ObjectNode counters = o.putObject("counters");
            for (CounterType t : c.getCounters().elementSet()) {
                counters.put(t.getName(), c.getCounters().count(t));
            }
        }
        CombatView combat = gv.getCombat();
        if (combat != null) {
            GameEntityView defender = combat.getDefender(c);
            if (defender instanceof PlayerView pd) {
                o.put("attacking", id(pd));
            } else if (defender instanceof CardView cd && cd.getController() != null) {
                o.put("attacking", id(cd.getController()));
            }
        }
        return o;
    }

    private ObjectNode stackItem(GameView gv, StackItemView s, PlayerView viewer) {
        ObjectNode o = json.createObjectNode();
        o.put("id", s.getId());
        o.put("controller", id(s.getActivatingPlayer()));
        CardView source = s.getSourceCard();
        o.put("name", source != null && source.canBeShownTo(viewer) ? source.getCurrentState().getName() : "Hidden");
        o.put("kind", s.isTrigger() ? "Triggered ability" : s.isAbility() ? "Activated ability" : "Spell");
        o.put("text", s.getText());
        if (source != null) {
            if (!s.isAbility()) {
                o.put("cardId", source.getId());
            }
            o.set("card", card(gv, source, viewer));
        }
        return o;
    }

    static String zone(ZoneType z) {
        if (z == null) {
            return "command";
        }
        return switch (z) {
            case Hand -> "hand";
            case Library -> "library";
            case Battlefield -> "battlefield";
            case Graveyard -> "graveyard";
            case Exile -> "exile";
            case Stack -> "stack";
            default -> "command";
        };
    }
}
