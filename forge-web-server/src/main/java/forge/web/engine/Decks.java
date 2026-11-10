package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import forge.StaticData;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.card.CardEdition;
import forge.deck.io.DeckSerializer;
import forge.item.PaperCard;
import forge.util.MyRandom;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Decks for a game: a player's deck sent by the browser, and Forge's Commander precons for AI seats. */
public final class Decks {

    private Decks() {
    }

    /** A deck the browser sent: {@code {name, cards: [{name, quantity, board}]}} (the Convex deck shape). */
    public static Deck fromJson(JsonNode deck) {
        Deck d = new Deck(deck.path("name").asText("Deck"));
        Set<String> unknown = new LinkedHashSet<>();
        int total = 0;
        for (JsonNode c : deck.path("cards")) {
            String name = c.path("name").asText("").trim();
            int qty = c.path("quantity").asInt(1);
            String board = c.path("board").asText("main");
            if (name.isEmpty() || qty < 1 || qty > 250 || !(board.equals("main") || board.equals("commander"))) {
                continue;
            }
            String forgeName = resolve(name);
            if (forgeName == null) {
                unknown.add(name);
                continue;
            }
            DeckSection section = board.equals("commander") ? DeckSection.Commander : DeckSection.Main;
            // The printing you picked (Scryfall set + collector number), so the card's set, and the
            // tokens it makes, match it. Forge's own choice if it doesn't have that printing.
            PaperCard print = printing(forgeName, c.path("set").asText(""), c.path("collectorNumber").asText(""));
            if (print != null) {
                d.getOrCreate(section).add(print, qty);
            } else {
                d.getOrCreate(section).add(forgeName, qty);
            }
            total += qty;
        }
        if (!unknown.isEmpty()) {
            throw new IllegalArgumentException("Forge doesn't know these cards: " + String.join(", ", unknown));
        }
        if (d.get(DeckSection.Commander) == null || d.get(DeckSection.Commander).isEmpty()) {
            throw new IllegalArgumentException("This deck has no commander.");
        }
        if (total > 250) {
            throw new IllegalArgumentException("This deck is too big.");
        }
        return d;
    }

    /**
     * Forge's name for a card, or null if Forge doesn't have it. Scryfall names double-faced cards
     * "Front // Back"; Forge knows them by the front face. Card scripts load lazily, so ask Forge to
     * load the card before looking it up.
     */
    static String resolve(String name) {
        if (name.contains("|")) {
            return null; // Forge reads "|" as a set code
        }
        StaticData data = StaticData.instance();
        for (String candidate : name.contains(" // ") ? new String[] {name, name.substring(0, name.indexOf(" // "))} : new String[] {name}) {
            data.attemptToLoadCard(candidate);
            if (data.getCommonCards().getCard(candidate) != null) {
                return candidate;
            }
        }
        return null;
    }

    /** Forge's edition for a Scryfall set code, or null. */
    public static CardEdition editionForScryfall(String scryfallSet) {
        if (scryfallSet == null || scryfallSet.isEmpty()) {
            return null;
        }
        for (CardEdition e : StaticData.instance().getEditions()) {
            if (scryfallSet.equalsIgnoreCase(e.getScryfallCode())) {
                return e;
            }
        }
        return null;
    }

    private static PaperCard printing(String name, String scryfallSet, String number) {
        CardEdition ed = editionForScryfall(scryfallSet);
        if (ed == null) {
            return null;
        }
        StaticData data = StaticData.instance();
        data.attemptToLoadCard(name, ed.getCode());
        // Forge falls back to another printing when it lacks the one asked for, so check the set.
        // Collector numbers can differ between Forge and Scryfall; the set is what matters most.
        PaperCard pc = number.isEmpty() ? null : data.getCommonCards().getCard(name, ed.getCode(), number);
        if (pc == null || !ed.getCode().equals(pc.getEdition())) {
            pc = data.getCommonCards().getCard(name, ed.getCode());
        }
        return pc != null && ed.getCode().equals(pc.getEdition()) ? pc : null;
    }

    /** {@code count} different random Commander precons that ship with Forge (res/quest/commanderprecons). */
    public static List<Deck> randomPrecons(int count) {
        File dir = new File(ForgeEngine.findAssets().toFile(), "res/quest/commanderprecons");
        File[] files = dir.listFiles((f, n) -> n.endsWith(".dck"));
        if (files == null || files.length < count) {
            throw new IllegalStateException("No Commander precons in " + dir);
        }
        Arrays.sort(files); // the same pool order on every OS, so a seeded game picks the same decks
        List<File> pool = new ArrayList<>(Arrays.asList(files));
        List<Deck> decks = new ArrayList<>();
        while (decks.size() < count && !pool.isEmpty()) {
            Deck d = DeckSerializer.fromFile(pool.remove(MyRandom.getRandom().nextInt(pool.size())));
            if (d != null && d.get(DeckSection.Commander) != null && !d.get(DeckSection.Commander).isEmpty()) {
                decks.add(d);
            }
        }
        return decks;
    }
}
