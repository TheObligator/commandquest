package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.GameView;
import forge.game.player.PlayerView;
import forge.gui.FThreads;
import forge.interfaces.IGameController;
import forge.util.MyRandom;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPInputStream;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Recording a game for its replay: everything face up, frame by frame, and the log. */
public class RecordingTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start();
    }

    /** What the client does: a JSON merge patch (RFC 7386). */
    static JsonNode merge(JsonNode target, JsonNode patch) {
        if (!patch.isObject()) {
            return patch.deepCopy();
        }
        ObjectNode out = target != null && target.isObject() ? (ObjectNode) target.deepCopy() : JSON.createObjectNode();
        patch.fields().forEachRemaining(e -> {
            if (e.getValue().isNull()) {
                out.remove(e.getKey());
            } else {
                out.set(e.getKey(), merge(out.get(e.getKey()), e.getValue()));
            }
        });
        return out;
    }

    @Test
    public void diffThenMergeGivesTheNewView() throws Exception {
        ObjectNode a = (ObjectNode) JSON.readTree("{\"turn\":1,\"players\":[{\"id\":\"1\",\"life\":40}],\"cards\":{\"5\":{\"name\":\"Plains\"},\"6\":{\"name\":\"Island\"}},\"gone\":true}");
        ObjectNode b = (ObjectNode) JSON.readTree("{\"turn\":2,\"players\":[{\"id\":\"1\",\"life\":38}],\"cards\":{\"5\":{\"name\":\"Plains\",\"tapped\":true}},\"stack\":[]}");
        ObjectNode patch = Recording.diff(a, b);
        Assert.assertEquals(merge(a, patch), b);
        Assert.assertFalse(patch.path("cards").has("5") && patch.path("cards").path("5").has("name"), "only what changed: " + patch);
        Assert.assertTrue(Recording.diff(b, b.deepCopy()).isEmpty(), "no change, empty patch");
    }

    @Test(timeOut = 240_000)
    public void aGameIsRecordedFaceUpAndCanBeReplayed() throws Exception {
        MyRandom.setRandom(new Random(3));
        CompletableFuture<Recording> done = new CompletableFuture<>();
        List<String> keptFor = new ArrayList<>();
        GameSession.ReplaySink sink = (Recording r, Collection<String> users) -> {
            keptFor.addAll(users);
            done.complete(r);
        };
        GameSessionTest.ScriptedBrowser browser = new GameSessionTest.ScriptedBrowser();
        Deck you = new Deck("Isamaru");
        you.getOrCreate(DeckSection.Commander).add("Isamaru, Hound of Konda", 1);
        you.getMain().add("Plains", 99);
        Deck ai = new Deck("Krenko");
        ai.getOrCreate(DeckSection.Commander).add("Krenko, Mob Boss", 1);
        ai.getMain().add("Mountain", 99);
        GameSession session = GameSession.startCommander(List.of(
                new GameSession.Seat("You", you, browser),
                new GameSession.Seat("AI 1", ai, null)), new GameSession.Options(0, sink, Map.of("You", "https://x.convex.site#u1")));
        try {
            int landTurn = -1;
            long deadline = System.currentTimeMillis() + 120_000;
            while (System.currentTimeMillis() < deadline) {
                Object[] prompt = browser.buttonPrompts.poll(5, TimeUnit.SECONDS);
                GameView gv = session.view();
                if (gv == null || gv.getTurn() >= 5) {
                    break;
                }
                if (prompt == null || browser.me == null || !browser.me.contains((PlayerView) prompt[0])) {
                    continue;
                }
                PlayerView me = (PlayerView) prompt[0];
                IGameController ctl = session.controller("You", me);
                if (me.equals(gv.getPlayerTurn()) && gv.getPhase() == forge.game.phase.PhaseType.MAIN1 && landTurn != gv.getTurn()
                        && me.getHand() != null && !me.getHand().isEmpty()) {
                    var land = me.getHand().iterator().next();
                    landTurn = gv.getTurn();
                    FThreads.invokeInEdtLater(() -> ctl.selectCard(land, null, null));
                } else {
                    FThreads.invokeInEdtLater(ctl::selectButtonOk);
                }
            }
            Assert.assertNotNull(session.recording());
        } finally {
            session.abort();
        }
        Recording rec = done.get(30, TimeUnit.SECONDS);
        Assert.assertEquals(keptFor, List.of("https://x.convex.site#u1"));
        ObjectNode meta = rec.meta();
        Assert.assertTrue(meta.path("turns").asInt() >= 4, meta.toString());
        Assert.assertEquals(meta.path("title").asText(), "You vs AI 1");
        Assert.assertEquals(meta.path("players").get(1).path("commander").asText(), "Krenko, Mob Boss");

        JsonNode file = JSON.readTree(new GZIPInputStream(new ByteArrayInputStream(rec.bytes())));
        Assert.assertEquals(file.path("version").asInt(), Recording.VERSION);
        ArrayNode frames = (ArrayNode) file.path("frames");
        Assert.assertTrue(frames.size() > 10, "frames: " + frames.size());
        JsonNode view = null;
        List<String> log = new ArrayList<>();
        boolean sawAiHand = false;
        for (JsonNode f : frames) {
            if (f.has("logCut")) {
                log.subList(f.path("logCut").asInt(), log.size()).clear();
            }
            f.path("logAdd").forEach(l -> log.add(l.asText()));
            ObjectNode patch = ((ObjectNode) f).deepCopy();
            patch.remove("logCut");
            patch.remove("logAdd");
            view = merge(view, patch);
            JsonNode aiHand = view.path("players").get(1).path("hand");
            if (aiHand.size() > 0) {
                JsonNode card = view.path("cards").path(aiHand.get(0).asText());
                Assert.assertFalse(card.path("hidden").asBoolean(), "the AI's hand is face up in a replay");
                sawAiHand |= card.path("name").asText().equals("Mountain") || card.path("name").asText().startsWith("Krenko");
            }
        }
        Assert.assertTrue(sawAiHand, "saw the AI's hand");
        Assert.assertTrue(view.path("gameOver").asBoolean(), "last frame: the game is over");
        Assert.assertTrue(log.stream().anyMatch(l -> l.contains("Plains")), "the log is in the replay");
        Assert.assertTrue(rec.bytes().length < 2_000_000, "small: " + rec.bytes().length);
    }
}
