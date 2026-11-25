package forge.web.engine;

import forge.card.MagicColor;
import forge.card.mana.ManaAtom;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** What a combo can change, before and after it's recorded: what one time round gains, and whether it can go again. */
record ComboState(String step, Map<String, Integer> counts, Map<String, Integer> tapped) {

    /** The game now, as {@link #changes} counts it. */
    static ComboState of(Game g, Player me) {
        Map<String, Integer> counts = new TreeMap<>();
        Map<String, Integer> tapped = new TreeMap<>();
        for (byte b : ManaAtom.MANATYPES) {
            int n = me.getManaPool().getAmountOfColor(b);
            if (n > 0) {
                counts.put("{" + MagicColor.toShortString(b) + "}", n);
            }
        }
        for (Player p : g.getPlayers()) {
            String whose = p == me ? "" : p.getName() + ": ";
            counts.put(whose + "life", p.getLife());
            p.getCounters().entrySet().forEach(e -> counts.put(whose + e.getElement().getName().toLowerCase(java.util.Locale.ROOT) + " counter", e.getCount()));
            counts.put(whose + "card in library", p.getCardsIn(ZoneType.Library).size());
            counts.put(whose + "card in hand", p.getCardsIn(ZoneType.Hand).size());
            counts.put(whose + "card in graveyard", p.getCardsIn(ZoneType.Graveyard).size());
            counts.put(whose + "card in exile", p.getCardsIn(ZoneType.Exile).size());
            for (Card c : p.getCardsIn(ZoneType.Battlefield)) {
                counts.merge(whose + c.getName() + (c.isToken() && !c.getName().endsWith("Token") ? " token" : ""), 1, Integer::sum);
                c.getCounters().entrySet().forEach(e -> counts.merge(
                        whose + e.getElement().getName().toLowerCase(java.util.Locale.ROOT) + " counter on " + c.getName(), e.getCount(), Integer::sum));
                if (p == me && c.isTapped()) {
                    tapped.merge(c.getName(), 1, Integer::sum);
                }
            }
        }
        return new ComboState(g.getPhaseHandler().getTurn() + "/" + g.getPhaseHandler().getPhase(), counts, tapped);
    }

    /** At {@code later}, is no more of what was untapped here tapped? */
    boolean ready(ComboState later) {
        return later.tapped().entrySet().stream().allMatch(e -> e.getValue() <= tapped.getOrDefault(e.getKey(), 0));
    }

    /** What's different at {@code later}, in words ("+1 {C}", "+2 life"); what stays tapped last. */
    List<String> changes(ComboState later) {
        List<String> out = new ArrayList<>();
        TreeMap<String, Integer> all = new TreeMap<>(counts);
        all.putAll(later.counts());
        for (String what : all.keySet()) {
            int d = later.counts().getOrDefault(what, 0) - counts.getOrDefault(what, 0);
            if (d != 0) {
                int colon = what.indexOf(": ");
                String whose = colon < 0 ? "" : what.substring(0, colon + 2);
                String name = what.substring(whose.length());
                out.add(whose + (d > 0 ? "+" : "−") + Math.abs(d) + " " + name);
            }
        }
        later.tapped().forEach((name, n) -> {
            if (n > tapped.getOrDefault(name, 0)) {
                out.add(name + " stays tapped");
            }
        });
        return out;
    }
}
