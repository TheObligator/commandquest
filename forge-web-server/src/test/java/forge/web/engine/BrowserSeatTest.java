package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import forge.gamemodes.net.ProtocolMethod;
import forge.gamemodes.net.event.GuiGameEvent;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.testng.Assert;
import org.testng.annotations.Test;

/** What the browser is sent for Forge's prompts, without a game. */
public class BrowserSeatTest {

    private static JsonNode lastPrompt(ObjectMapper json, List<String> sent) throws Exception {
        for (int i = sent.size() - 1; i >= 0; i--) {
            JsonNode m = json.readTree(sent.get(i));
            if (m.path("t").asText().equals("prompt")) {
                return m;
            }
        }
        return null;
    }

    @Test
    public void promptTextArrivingAfterItsButtonsIsResent() throws Exception {
        ObjectMapper json = new ObjectMapper();
        List<String> sent = new CopyOnWriteArrayList<>();
        BrowserSeat seat = new BrowserSeat(json, sent::add);
        seat.send(new GuiGameEvent(ProtocolMethod.showPromptMessage, null, "Would you like to play or draw?", null));
        // Forge's yes/no and mulligan inputs set their buttons first, then their text.
        seat.send(new GuiGameEvent(ProtocolMethod.updateButtons, null, "Keep", "Mulligan", true, true, true));
        seat.send(new GuiGameEvent(ProtocolMethod.showPromptMessage, null, "Keep this hand?", null));
        long end = System.currentTimeMillis() + 2000;
        JsonNode p = null;
        while (System.currentTimeMillis() < end) {
            p = lastPrompt(json, sent);
            if (p != null && p.path("message").asText().equals("Keep this hand?")) {
                break;
            }
            Thread.sleep(20);
        }
        Assert.assertNotNull(p);
        Assert.assertEquals(p.path("message").asText(), "Keep this hand?", "the prompt shows its own question");
        Assert.assertEquals(p.path("ok").path("label").asText(), "Keep");
        Assert.assertEquals(p.path("cancel").path("label").asText(), "Mulligan");

        // Once nothing is asked, later text doesn't bring back an old prompt.
        int before = sent.size();
        seat.send(new GuiGameEvent(ProtocolMethod.awaitNextInput));
        seat.send(new GuiGameEvent(ProtocolMethod.showPromptMessage, null, "Waiting for opponent…", null));
        Thread.sleep(200);
        Assert.assertEquals(sent.size(), before + 1, "only 'waiting' was sent");
        seat.close();
    }

    @Test
    public void colorChoicesReadNaturally() {
        Assert.assertEquals(BrowserSeat.label("BLACK"), "Black");
        Assert.assertEquals(BrowserSeat.label("COLORLESS"), "Colorless");
        Assert.assertEquals(BrowserSeat.label("OK"), "OK");
    }

    /** Asks Forge's question on another thread (it blocks), answers it like the browser, returns Forge's value. */
    private static Object askAndAnswer(BrowserSeat seat, List<String> sent, ObjectMapper json, GuiGameEvent ev, String answer) throws Exception {
        java.util.concurrent.CompletableFuture<Object> result = java.util.concurrent.CompletableFuture.supplyAsync(() -> seat.sendAndWait(ev));
        JsonNode ask = null;
        long end = System.currentTimeMillis() + 3000;
        while (ask == null && System.currentTimeMillis() < end) {
            for (String m : sent) {
                JsonNode n = json.readTree(m);
                if (n.path("t").asText().equals("ask")) {
                    ask = n;
                }
            }
            Thread.sleep(20);
        }
        Assert.assertNotNull(ask, "asked");
        sent.clear();
        seat.answer(ask.path("id").asInt(), json.readTree(answer), null);
        return result.get(3, java.util.concurrent.TimeUnit.SECONDS);
    }

    @Test
    @SuppressWarnings("unchecked")
    public void orderAndDivideQuestions() throws Exception {
        ObjectMapper json = new ObjectMapper();
        List<String> sent = new CopyOnWriteArrayList<>();
        BrowserSeat seat = new BrowserSeat(json, sent::add);

        Object order = askAndAnswer(seat, sent, json, new GuiGameEvent(ProtocolMethod.order,
                "Order the triggers", "Resolves first", 0, 0, List.of("A", "B", "C"), null, null, false, false), "[2,0,1]");
        Assert.assertEquals(((forge.gui.interfaces.IGuiGame.OrderResult<Object>) order).ordered(), List.of("C", "A", "B"));

        java.util.Map<Object, Integer> targets = new java.util.LinkedHashMap<>();
        targets.put("x", 0);
        targets.put("y", 0);
        Object split = askAndAnswer(seat, sent, json, new GuiGameEvent(ProtocolMethod.assignGenericAmount,
                null, targets, 5, true, "damage"), "[2,3]");
        Assert.assertEquals(split, java.util.Map.of("x", 2, "y", 3));

        // Not adding up (or breaking "at least 1"): Forge's default split instead.
        Object bad = askAndAnswer(seat, sent, json, new GuiGameEvent(ProtocolMethod.assignGenericAmount,
                null, targets, 5, true, "damage"), "[5,0]");
        Assert.assertEquals(bad, java.util.Map.of("x", 4, "y", 1));
        seat.close();
    }
}
