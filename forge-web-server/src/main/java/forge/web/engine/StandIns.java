package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import forge.card.CardEdition;
import forge.card.CardRarity;
import forge.card.CardRules;
import forge.item.PaperCard;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Stand-ins for cards Forge has no script for (a card newer than our last Forge merge), so a deck
 * with them can be played with free play. The browser sends Scryfall's data for the card; the
 * stand-in has its name, cost, types, power/toughness and rules text but no abilities: players do
 * what the card says by hand. Each stand-in belongs to one deck and is never added to Forge's card
 * database, so one player's stand-in can't change another's game.
 *
 * <p>The data comes from the browser, so every field is checked and nothing in it can add script
 * lines: no line breaks, and only the characters a cost, type line or number can have.
 */
public final class StandIns {

    /** Different stand-in cards one deck may have. */
    public static final int MAX_PER_DECK = 60;

    private static final Pattern NAME = Pattern.compile("[\\p{L}\\p{N} ,.'’\\-!?&:/()]{1,80}");
    private static final Pattern COST_SYMBOL = Pattern.compile("\\{([0-9]{1,2}|[WUBRGCXYZS]|[WUBRGC2]/[WUBRGP](/P)?)\\}");
    private static final Pattern TYPE_WORD = Pattern.compile("[\\p{L}'’\\-]{1,30}");
    private static final Pattern STAT = Pattern.compile("[0-9]{1,2}|\\*|[0-9]?\\+\\*|[0-9]{1,2}\\+|X|-[0-9]");

    private StandIns() {
    }

    /** A stand-in for this Scryfall-shaped card, or null if its data doesn't check out. */
    public static PaperCard build(JsonNode card) {
        List<String> lines = new ArrayList<>();
        JsonNode faces = card.path("faces");
        String layout = card.path("layout").asText("normal");
        boolean twoFaced = faces.isArray() && faces.size() == 2 && (layout.equals("transform") || layout.equals("modal_dfc"));
        if (!face(twoFaced ? faces.get(0) : card, lines)) {
            return null;
        }
        if (twoFaced) {
            lines.add("AlternateMode:" + (layout.equals("modal_dfc") ? "Modal" : "DoubleFaced"));
            lines.add("ALTERNATE");
            if (!face(faces.get(1), lines)) {
                return null;
            }
        }
        try {
            CardRules rules = CardRules.fromScript(lines);
            return new PaperCard(rules, CardEdition.UNKNOWN_CODE, CardRarity.Special);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static boolean face(JsonNode f, List<String> lines) {
        String name = f.path("name").asText("").trim();
        String type = f.path("typeLine").asText("").replace("—", " ").trim();
        if (!NAME.matcher(name).matches() || type.isEmpty() || type.length() > 120) {
            return false;
        }
        StringBuilder types = new StringBuilder();
        for (String w : type.split("\\s+")) {
            if (!TYPE_WORD.matcher(w).matches()) {
                return false;
            }
            types.append(types.length() == 0 ? "" : " ").append(w);
        }
        String cost = manaCost(f.path("manaCost").asText(""));
        if (cost == null) {
            return false;
        }
        lines.add("Name:" + name);
        lines.add("ManaCost:" + cost);
        lines.add("Types:" + types);
        String power = f.path("power").asText("");
        String toughness = f.path("toughness").asText("");
        if (!power.isEmpty() || !toughness.isEmpty()) {
            if (!STAT.matcher(power).matches() || !STAT.matcher(toughness).matches()) {
                return false;
            }
            lines.add("PT:" + power + "/" + toughness);
        }
        for (String[] stat : new String[][] {{"loyalty", "Loyalty"}, {"defense", "Defense"}}) {
            String v = f.path(stat[0]).asText("");
            if (!v.isEmpty()) {
                if (!STAT.matcher(v).matches()) {
                    return false;
                }
                lines.add(stat[1] + ":" + v);
            }
        }
        // Rules text is shown, never run. Line breaks become Forge's "\n" escape, so it stays one line.
        String oracle = f.path("oracleText").asText("").replace("\r", "");
        if (oracle.length() > 1500) {
            oracle = oracle.substring(0, 1500) + "…";
        }
        lines.add("Oracle:" + oracle.replace("\\", "").replace("\n", "\\n"));
        return true;
    }

    /** Scryfall's "{2}{W/U}{G/P}" as Forge writes it ("2 WU GP"), "no cost" for none, null if malformed. */
    static String manaCost(String scryfall) {
        if (scryfall.isEmpty()) {
            return "no cost";
        }
        StringBuilder out = new StringBuilder();
        var m = COST_SYMBOL.matcher(scryfall);
        int at = 0;
        while (m.find()) {
            if (m.start() != at) {
                return null;
            }
            at = m.end();
            out.append(out.length() == 0 ? "" : " ").append(m.group(1).replace("/", ""));
        }
        return at == scryfall.length() && at > 0 ? out.toString() : null;
    }
}
