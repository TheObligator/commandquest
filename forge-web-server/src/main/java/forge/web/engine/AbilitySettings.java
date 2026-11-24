package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.Trigger;
import forge.player.AutoYieldStore;
import forge.player.AutoYieldStore.TriggerDecision;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * One player's settings per ability: auto-yield (don't stop for it on the stack) and, for a "you may",
 * always yes, always no or ask. A setting is for every copy of the ability (Forge's key without the
 * card: its text) unless the player made it for that one card only. Forge's own store has one scope
 * for everything, chosen by a preference, so ours replaces it ({@link WebPlayerController}).
 */
public final class AbilitySettings {

    static final int MAX_SETTINGS = 500;
    static final int MAX_KEY = 1000;

    private record Setting(boolean autoYield, TriggerDecision decision) {
        static final Setting NONE = new Setting(false, TriggerDecision.ASK);

        boolean isNone() {
            return !autoYield && decision == TriggerDecision.ASK;
        }
    }

    /** By ability text (every copy), or by full key for those in {@link #cardOnly}. */
    private final Map<String, Setting> settings = new ConcurrentHashMap<>();
    /** Keys ("this ability of this card") set for that card only. */
    private final Set<String> cardOnly = ConcurrentHashMap.newKeySet();

    private String storageKey(String key) {
        return cardOnly.contains(key) ? key : AutoYieldStore.abilitySuffix(key);
    }

    private Setting get(String key) {
        return key == null || key.isEmpty() ? Setting.NONE : settings.getOrDefault(storageKey(key), Setting.NONE);
    }

    private void put(String storageKey, Setting s) {
        if (s.isNone()) {
            settings.remove(storageKey);
        } else if (settings.size() < MAX_SETTINGS || settings.containsKey(storageKey)) {
            settings.put(storageKey, s);
        }
    }

    public boolean autoYield(String key) {
        return get(key).autoYield();
    }

    public TriggerDecision decision(String key) {
        return get(key).decision();
    }

    public synchronized void setAutoYield(String key, boolean on) {
        put(storageKey(key), new Setting(on, get(key).decision()));
    }

    public synchronized void setDecision(String key, TriggerDecision decision) {
        put(storageKey(key), new Setting(get(key).autoYield(), decision));
    }

    /** Makes the ability's setting hold for every copy of it, or for this card only. What's set moves along. */
    public synchronized void setEveryCopy(String key, boolean every) {
        Setting now = get(key);
        String text = AutoYieldStore.abilitySuffix(key);
        if (text.equals(key) || every != cardOnly.contains(key)) {
            return;
        }
        if (every) {
            cardOnly.remove(key);
            settings.remove(key);
            if (!now.isNone()) {
                put(text, now);
            }
        } else if (cardOnly.size() < MAX_SETTINGS) {
            cardOnly.add(key);
            settings.remove(text);
            put(key, now);
        }
    }

    /** The settings saved with the player's deck: {@code [{text, autoYield?, decision?}]}. */
    public void seed(JsonNode saved) {
        if (!saved.isArray()) {
            return;
        }
        for (JsonNode n : saved) {
            String text = n.path("text").asText("");
            if (text.isBlank() || text.length() > MAX_KEY) {
                continue;
            }
            TriggerDecision d = switch (n.path("decision").asText("")) {
                case "ACCEPT" -> TriggerDecision.ACCEPT;
                case "DECLINE" -> TriggerDecision.DECLINE;
                default -> TriggerDecision.ASK;
            };
            put(text, new Setting(n.path("autoYield").asBoolean(false), d));
        }
    }

    /** For the view: {@code {set: {<text, or key>: {autoYield, decision}}, cardOnly: [key]}}. */
    ObjectNode json(ObjectMapper json) {
        ObjectNode o = json.createObjectNode();
        ObjectNode set = o.putObject("set");
        new java.util.TreeMap<>(settings).forEach((k, s) ->
                set.putObject(k).put("autoYield", s.autoYield()).put("decision", s.decision().name()));
        ArrayNode only = o.putArray("cardOnly");
        cardOnly.stream().sorted().forEach(only::add);
        return o;
    }

    /** Forge's key for a trigger on the stack ({@code WrappedAbility.yieldKey}), also when it isn't there. */
    static String key(Card host, Trigger t) {
        return host.toString() + ": " + t.toString();
    }

    /** The key of the triggered ability {@code sa} is part of, or null. */
    static String key(SpellAbility sa) {
        SpellAbility root = sa == null ? null : sa.getRootAbility();
        Trigger t = root == null ? null : root.getTrigger();
        return t == null || root.getHostCard() == null ? null : key(root.getHostCard(), t);
    }

    /**
     * The card's triggered abilities for its menu: {@code [{key, text, mayAsk?, mine?}]}. {@code mayAsk}:
     * it can ask {@code me} a "you may" that always yes / always no answers.
     */
    public static ArrayNode list(Card card, Player me, ObjectMapper json) {
        ArrayNode out = json.createArrayNode();
        Set<String> seen = new HashSet<>();
        boolean controls = me.equals(card.getController());
        for (Trigger t : card.getTriggers()) {
            String text = t.toString();
            // Static triggers (Forge's) never use the stack; those without text are its own bookkeeping.
            if (t.isStatic() || text.isBlank() || !seen.add(text) || key(card, t).length() > MAX_KEY) {
                continue;
            }
            ObjectNode o = out.addObject();
            o.put("key", key(card, t));
            o.put("text", t.replaceAbilityText(text, card.getCurrentState()));
            if (controls && mayAsk(t)) {
                o.put("mayAsk", true);
            }
            if (me.equals(card.getOwner()) && !card.isToken()) {
                o.put("mine", true);
            }
        }
        return out;
    }

    /** Does this trigger ask its controller a "you may" (as it resolves, or one of its effects)? */
    static boolean mayAsk(Trigger t) {
        if (t.hasParam("OptionalDecider")) {
            return !t.getParam("OptionalDecider").contains("Opponent");
        }
        SpellAbility sa = t.ensureAbility();
        if (sa == null) {
            return false;
        }
        // Forge asks about these the same way (TriggerHandler): a trigger with a cost you may pay.
        if (!(sa instanceof AbilitySub) && sa.hasParam("Cost") && !"0".equals(sa.getParam("Cost"))
                && (sa.getPayCosts() == null || !sa.getPayCosts().isMandatory())) {
            return true;
        }
        for (SpellAbility part = sa; part != null; part = part.getSubAbility()) {
            if (optional(part)) {
                return true;
            }
        }
        return false;
    }

    /** An effect its player may decline. */
    static boolean optional(SpellAbility sa) {
        return sa.hasParam("Optional")
                || (sa.hasParam("OptionalDecider") && !sa.getParam("OptionalDecider").contains("Opponent"));
    }
}
