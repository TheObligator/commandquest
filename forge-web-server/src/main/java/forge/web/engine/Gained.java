package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.game.CardTraitBase;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardTraitChanges;
import forge.game.card.ICardTraitChanges;
import forge.game.keyword.Keyword;
import forge.game.keyword.KeywordInterface;
import forge.game.keyword.KeywordsChange;
import forge.game.staticability.StaticAbility;
import java.util.Collection;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * What a permanent has gained in this game and isn't printed on it: keywords and abilities other
 * effects gave it (equipment, auras, anthems, "gains flying until end of turn"…). Forge keeps
 * these apart from the card's own (layer 6 changes, {@link Card#getChangedCardKeywords()} and
 * {@link Card#getChangedCardTraits()}), so this reads them from there and keeps the ones the card
 * still has.
 *
 * <p>Each entry: {@code text}, and for a keyword its {@code keyword} (Forge's name, "Flying") and
 * {@code reminder} (what it does); {@code source} is the card that gave it, when Forge knows.
 * Read it on the game thread, like the rest of the view.
 */
final class Gained {
    private Gained() {
    }

    /** Adds {@code gained} to each battlefield card of a view ({@link ViewJson#game}) whose face its viewer can see. */
    static void annotate(Game g, ObjectNode view, ObjectMapper json) {
        if (g == null) {
            return;
        }
        Map<Long, Card> statics = null;
        for (JsonNode p : view.path("players")) {
            for (JsonNode c : p.path("battlefield")) {
                if (c.path("hidden").asBoolean()) {
                    continue;   // a face-down card's abilities stay hidden
                }
                Card card = g.findById(c.path("id").asInt());
                if (card == null || card.getChangedCardKeywords().isEmpty() && card.getChangedCardTraits().isEmpty()) {
                    continue;
                }
                if (statics == null) {
                    statics = staticHosts(g);
                }
                ArrayNode list = of(card, statics, json);
                if (!list.isEmpty()) {
                    ((ObjectNode) c).set("gained", list);
                }
            }
        }
    }

    /** The card behind each static ability in the game, by the ability's id. */
    static Map<Long, Card> staticHosts(Game g) {
        Map<Long, Card> hosts = new java.util.HashMap<>();
        for (Card c : g.getCardsInGame()) {
            for (StaticAbility st : c.getStaticAbilities()) {
                hosts.put((long) st.getId(), c);
            }
        }
        return hosts;
    }

    static ArrayNode of(Card card, Map<Long, Card> statics, ObjectMapper json) {
        ArrayNode out = json.createArrayNode();
        Set<String> seen = new LinkedHashSet<>();

        // Keywords: the gained instances still in the card's keyword list (a keyword it already
        // had, or one another effect removed, isn't there).
        Set<KeywordInterface> has = Collections.newSetFromMap(new IdentityHashMap<>());
        has.addAll(card.getUnhiddenKeywords(card.getCurrentState()).getValues());
        for (var cell : card.getChangedCardKeywords().cellSet()) {
            KeywordsChange kc = cell.getValue();
            if (kc.getKeywords() == null) {
                continue;
            }
            for (KeywordInterface ki : kc.getKeywords()) {
                if (!has.contains(ki)) {
                    continue;
                }
                Card source = source(card, ki.getStatic(), cell.getColumnKey(), statics);
                if (ki.getKeyword() == Keyword.UNDEFINED) {
                    // Not a real keyword ("CARDNAME can't block."): show its words, unless it's an internal marker.
                    String t = ki.getOriginal();
                    if (t != null && !t.contains(":") && !t.isBlank()) {
                        add(out, seen, card, t, null, null, source);
                    }
                    continue;
                }
                String title;
                String reminder;
                try {
                    title = ki.getTitle();
                    reminder = ki.getReminderText();
                } catch (RuntimeException e) {
                    title = ki.getOriginal();
                    reminder = null;
                }
                add(out, seen, card, title, ki.getKeyword().toString(), reminder, source);
            }
        }

        // Other abilities: triggered, activated (mana too), static and replacement.
        Set<Object> present = Collections.newSetFromMap(new IdentityHashMap<>());
        card.getSpellAbilities().forEach(present::add);
        card.getTriggers().forEach(present::add);
        card.getStaticAbilities().forEach(present::add);
        card.getReplacementEffects().forEach(present::add);
        for (var cell : card.getChangedCardTraits().cellSet()) {
            ICardTraitChanges ch = cell.getValue();
            if (!(ch instanceof CardTraitChanges t)) {
                continue;
            }
            Card source = source(card, null, cell.getColumnKey(), statics);
            traits(out, seen, card, t.getTriggers(), present, source);
            traits(out, seen, card, t.getAbilities(), present, source);
            traits(out, seen, card, t.getStaticAbilities(), present, source);
            traits(out, seen, card, t.getReplacements(), present, source);
        }
        return out;
    }

    private static void traits(ArrayNode out, Set<String> seen, Card card, Collection<? extends CardTraitBase> list,
                               Set<Object> present, Card source) {
        if (list == null) {
            return;
        }
        for (CardTraitBase t : list) {
            if (t == null || !present.contains(t) || t.isSecondary() || t.getKeyword() != null) {
                continue;   // keyword parts are listed as their keyword
            }
            String text;
            try {
                text = t.toString();
            } catch (RuntimeException e) {
                continue;
            }
            if (text != null && !text.isBlank()) {
                add(out, seen, card, text, null, null, source);
            }
        }
    }

    private static void add(ArrayNode out, Set<String> seen, Card card, String text, String keyword, String reminder, Card source) {
        text = text.replace("CARDNAME", card.getName()).replace("NICKNAME", card.getName()).replace("\\r\\n", "\n").replace("\r\n", "\n").trim();
        if (text.isEmpty() || !seen.add(text)) {
            return;
        }
        ObjectNode o = out.addObject();
        o.put("text", text);
        if (keyword != null) {
            o.put("keyword", keyword);
        }
        if (reminder != null && !reminder.isBlank()) {
            o.put("reminder", reminder.replace("CARDNAME", card.getName()).trim());
        }
        if (source != null && source != card) {
            o.put("source", source.getName());
        }
    }

    /** The card that gave it: the static ability's host, or for an effect (a resolved spell's "until end of turn") the card that made it. */
    private static Card source(Card card, StaticAbility st, Long staticId, Map<Long, Card> statics) {
        Card host = st != null ? st.getHostCard() : staticId != null && staticId != 0 ? statics.get(staticId) : null;
        if (host != null && host.getEffectSource() != null) {
            host = host.getEffectSource();
        }
        return host;
    }
}
