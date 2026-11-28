package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.card.MagicColor;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import forge.gui.FThreads;
import forge.util.MyRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Clicking a land with several mana abilities asks "which mana?" with one option per mana, like any mana choice. */
public class ManaChoiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    private static Deck deck(String commander, String basic) {
        Deck d = new Deck(commander);
        d.getOrCreate(DeckSection.Commander).add(commander, 1);
        d.getMain().add(basic, 99);
        return d;
    }

    private static void waitFor(String what, BooleanSupplier cond) throws InterruptedException {
        long end = System.currentTimeMillis() + 60_000;
        while (!cond.getAsBoolean()) {
            Assert.assertTrue(System.currentTimeMillis() < end, "timed out waiting: " + what);
            Thread.sleep(5);
        }
    }

    private static void edt(Runnable r) throws Exception {
        CompletableFuture<Void> done = new CompletableFuture<>();
        FThreads.invokeInEdtLater(() -> {
            try {
                r.run();
                done.complete(null);
            } catch (RuntimeException e) {
                done.completeExceptionally(e);
            }
        });
        done.get(20, TimeUnit.SECONDS);
    }

    @Test(timeOut = 240_000)
    public void dualAndPainLandsAskWhichMana() throws Exception {
        MyRandom.setRandom(new Random(11));
        BrowserSeat seat = new BrowserSeat(JSON, s -> { });
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", deck("Ezuri, Renegade Leader", "Forest"), seat),
                new GameSession.Seat("AI 1", deck("Talrand, Sky Summoner", "Island"), null)));
        try {
            BooleanSupplier ready = () -> seat.openAsk() != null || (seat.webController() != null
                    && seat.webController().getInputQueue().getInput() != null && seat.shownInput() == seat.webController().getInputQueue().getInput());
            long end = System.currentTimeMillis() + 60_000;
            while (true) {
                Assert.assertTrue(System.currentTimeMillis() < end, "never reached my main phase");
                if (ready.getAsBoolean()) {
                    var ctl = seat.webController();
                    Game g = session.game();
                    if (seat.openAsk() == null && ctl.getInputQueue().getInput() instanceof forge.gamemodes.match.input.InputPassPriority
                            && g.getPhaseHandler().isPlayerTurn(ctl.getPlayer()) && g.getPhaseHandler().getPhase() == PhaseType.MAIN1
                            && g.getStack().isEmpty()) {
                        break;
                    }
                    if (seat.openAsk() != null) {
                        seat.answerOpenWithDefaults();
                    } else {
                        GameSessionTest.pass(ctl);
                    }
                }
                Thread.sleep(30);
            }
            Game g = session.game();
            Player me = seat.webController().getPlayer();
            Card trop = UseLaterTest.onGameThread(g, () -> UseLaterTest.make(me, "Tropical Island", ZoneType.Battlefield));
            Card wastes = UseLaterTest.onGameThread(g, () -> UseLaterTest.make(me, "Adarkar Wastes", ZoneType.Battlefield));

            // Tropical Island: {G} or {U}, as mana options.
            FThreads.invokeInEdtLater(() -> seat.webController().selectCard(trop.getView(), null, null)); // blocks until answered
            waitFor("which mana", () -> seat.openAsk() != null);
            ObjectNode ask = seat.openAsk();
            Assert.assertTrue(ask.path("mana").asBoolean(), "a mana choice: " + ask);
            Assert.assertEquals(costs(ask), List.of("{U}", "{G}"), ask.toString());
            seat.answer(ask.path("id").asInt(), pick(ask, "{U}"), null);
            waitFor("blue floating", () -> me.getManaPool().getAmountOfColor(MagicColor.BLUE) == 1);
            Assert.assertTrue(trop.isTapped());

            // Adarkar Wastes: {C} free, {W} or {U} for 1 damage, all at once: no second "which color?".
            int life = me.getLife();
            waitFor("priority again", () -> seat.openAsk() == null && ready.getAsBoolean());
            FThreads.invokeInEdtLater(() -> seat.webController().selectCard(wastes.getView(), null, null)); // blocks until answered
            waitFor("which mana", () -> seat.openAsk() != null);
            ask = seat.openAsk();
            Assert.assertEquals(costs(ask), List.of("{W}", "{U}", "{C}"), ask.toString());
            Assert.assertEquals(ask.path("options").get(0).path("note").asText(), "1 damage");
            Assert.assertFalse(ask.path("options").get(2).has("note"), "{C} doesn't hurt");
            seat.answer(ask.path("id").asInt(), pick(ask, "{W}"), null);
            waitFor("white floating", () -> me.getManaPool().getAmountOfColor(MagicColor.WHITE) == 1);
            waitFor("no color question", () -> seat.openAsk() == null);
            waitFor("the damage", () -> me.getLife() == life - 1);
        } finally {
            session.abort();
        }
    }

    private static List<String> costs(JsonNode ask) {
        List<String> out = new ArrayList<>();
        ask.path("options").forEach(o -> out.add(o.path("cost").asText()));
        return out;
    }

    private static ArrayNode pick(JsonNode ask, String cost) {
        ArrayNode a = JSON.createArrayNode();
        for (int i = 0; i < ask.path("options").size(); i++) {
            if (ask.path("options").get(i).path("cost").asText().equals(cost)) {
                a.add(i);
            }
        }
        return a;
    }
}
