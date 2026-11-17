package forge.web.engine;

import forge.game.GameLogEntry;
import forge.game.GameLogEntryType;
import forge.game.card.CardView;
import forge.util.Localizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Tidies Forge's game log for players. The browser links a card's name to the card when the line
 * writes it as "Name (id)", which Forge does for most lines but not for "AI 3 cast Feed the Swarm",
 * so each line's own card gets its id added. And a resolving spell or ability is logged with its
 * whole stack text, rules text and all (plus Forge's internal "[Zone Changer: …]" note for
 * triggers), so that becomes "Feed the Swarm resolved." or "T'Challa's ability resolved."
 */
final class LogLines {
    private LogLines() {}

    /** The messages of {@code oldestFirst}, tidied, oldest first. */
    static List<String> render(List<GameLogEntry> oldestFirst) {
        String cast = " " + Localizer.getInstance().getMessage("lblCast") + " ";
        Map<Integer, Boolean> lastWasCast = new HashMap<>(); // card id -> its latest stack entry was a spell
        List<String> out = new ArrayList<>(oldestFirst.size());
        for (GameLogEntry e : oldestFirst) {
            String msg = e.message() == null ? "" : e.message();
            CardView c = e.sourceCard();
            String name = c == null ? null : c.getName();
            if (name == null || name.isEmpty()) {
                out.add(msg);
                continue;
            }
            String tagged = name + " (" + c.getId() + ")";
            if (e.type() == GameLogEntryType.STACK_ADD) {
                lastWasCast.put(c.getId(), msg.contains(cast + name));
            } else if (e.type() == GameLogEntryType.STACK_RESOLVE && !msg.endsWith("fizzles.")) {
                msg = lastWasCast.getOrDefault(c.getId(), false)
                        ? tagged + " resolved."
                        : tagged + "'s ability resolved.";
            }
            out.add(tag(msg, name, tagged));
        }
        return out;
    }

    /** Writes the first untagged mention of {@code name} as "Name (id)". */
    static String tag(String msg, String name, String tagged) {
        for (int i = msg.indexOf(name); i >= 0; i = msg.indexOf(name, i + 1)) {
            int end = i + name.length();
            if (!msg.startsWith(" (", end)) {
                return msg.substring(0, i) + tagged + msg.substring(end);
            }
            if (msg.startsWith(tagged, i)) {
                return msg; // already linked
            }
        }
        return msg;
    }
}
