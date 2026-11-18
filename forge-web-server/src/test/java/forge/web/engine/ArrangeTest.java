package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import forge.gamemodes.net.ProtocolMethod;
import forge.gamemodes.net.event.GuiGameEvent;
import forge.gui.interfaces.IGuiGame;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

/** Arrange questions (scry, surveil, Forge's order lists): one window, answered with a list per pile. */
public class ArrangeTest {

    private final ObjectMapper json = new ObjectMapper();
    private BlockingQueue<String> sent;
    private BrowserSeat seat;

    @BeforeMethod
    public void newSeat() {
        sent = new LinkedBlockingQueue<>();
        seat = new BrowserSeat(json, sent::offer);
    }

    private JsonNode nextAsk() throws Exception {
        for (;;) {
            String s = sent.poll(10, TimeUnit.SECONDS);
            Assert.assertNotNull(s, "no ask sent");
            JsonNode m = json.readTree(s);
            if ("ask".equals(m.path("t").asText())) {
                return m;
            }
        }
    }

    @Test
    public void scryAsksOnceAndChecksTheAnswer() throws Exception {
        List<String> cards = List.of("A", "B", "C");
        CompletableFuture<List<List<String>>> result = CompletableFuture.supplyAsync(() -> seat.arrange("Scry 3", "", cards,
                List.of(new BrowserSeat.Pile("Top of library", true), new BrowserSeat.Pile("Bottom of library", true)),
                List.of(cards, List.of())));
        JsonNode ask = nextAsk();
        Assert.assertEquals(ask.path("kind").asText(), "arrange");
        Assert.assertEquals(ask.path("piles").size(), 2);
        Assert.assertEquals(ask.path("start").toString(), "[[0,1,2],[]]");
        int id = ask.path("id").asInt();

        seat.answer(id, json.readTree("[[2,0],[0]]"), null); // a card twice: ignored
        seat.answer(id, json.readTree("[[2],[0]]"), null); // a card missing: ignored
        Assert.assertFalse(result.isDone());
        seat.answer(id, json.readTree("[[2,0],[1]]"), null);
        Assert.assertEquals(result.get(10, TimeUnit.SECONDS), List.of(List.of("C", "A"), List.of("B")));
    }

    @Test
    @SuppressWarnings("unchecked")
    public void forgeChooseManyIsTwoPilesWithCounts() throws Exception {
        // Forge's many(min 1, max 2) of three: order(..., remainingMin 1, remainingMax 2, source, dest).
        GuiGameEvent ev = new GuiGameEvent(ProtocolMethod.order, "Pick", "Chosen", 1, 2, List.of("A", "B", "C"), null, null, false, false);
        CompletableFuture<Object> result = CompletableFuture.supplyAsync(() -> seat.sendAndWait(ev));
        JsonNode ask = nextAsk();
        JsonNode chosen = ask.path("piles").get(0);
        Assert.assertEquals(chosen.path("min").asInt(), 1);
        Assert.assertEquals(chosen.path("max").asInt(), 2);
        int id = ask.path("id").asInt();
        seat.answer(id, json.readTree("[[],[0,1,2]]"), null); // too few chosen: ignored
        seat.answer(id, json.readTree("[[1],[0,2]]"), null);
        IGuiGame.OrderResult<String> r = (IGuiGame.OrderResult<String>) result.get(10, TimeUnit.SECONDS);
        Assert.assertEquals(r.ordered(), List.of("B"));
    }

    @Test
    public void closingTheSeatKeepsTheStart() throws Exception {
        List<String> cards = List.of("A", "B");
        CompletableFuture<List<List<String>>> result = CompletableFuture.supplyAsync(() -> seat.arrange("Surveil 2", "", cards,
                List.of(new BrowserSeat.Pile("Top of library", true), new BrowserSeat.Pile("Graveyard", false)),
                List.of(cards, List.of())));
        nextAsk();
        seat.close();
        Assert.assertEquals(result.get(10, TimeUnit.SECONDS), List.of(cards, List.of()));
    }
}
