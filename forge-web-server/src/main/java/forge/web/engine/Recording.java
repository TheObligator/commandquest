package forge.web.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.common.eventbus.Subscribe;
import forge.game.Game;
import forge.game.GameLogEntry;
import forge.game.GameView;
import forge.game.card.Card;
import forge.game.event.GameEvent;
import forge.game.event.GameEventGameOutcome;
import forge.game.event.GameEventPlayerPriority;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.player.PlayerControllerHuman;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.zip.GZIPOutputStream;
import org.tinylog.Logger;

/**
 * Records a game for watching later (docs/replays.md): the whole table face up, every hand shown,
 * at each moment a player is about to get priority after something changed (the same moments
 * {@link Rewind} saves), plus the game log. The replay file is gzipped JSON:
 * <pre>{version: 1, meta: {...}, frames: [patch, patch, ...]}</pre>
 * The first frame is the whole view; each next one is a JSON merge patch (RFC 7386) on the one
 * before. Cards are kept once, in {@code cards} by id, and zones list card ids, so a patch carries
 * only the cards that changed. The log isn't in the view: a frame adds its new lines in
 * {@code logAdd}, after first cutting the log back to {@code logCut} lines when a rewind took
 * lines back.
 */
public final class Recording {

    public static final int VERSION = 1;
    /** Frames kept at most; a longer game keeps its first ones and says it was cut short. */
    static final int MAX_FRAMES = 5000;
    private static final String[] ZONES = {"hand", "battlefield", "graveyard", "exile", "command"};

    private final Game game;
    private final ObjectMapper json;
    private final ViewJson views;
    private final List<byte[]> frames = new ArrayList<>();
    private ObjectNode last;
    private final List<GameLogEntry> logSent = new ArrayList<>();
    private boolean dirty = true;
    private long stepKey = -1;
    private boolean finished;
    private boolean truncated;
    private Consumer<Recording> onFinish = r -> { };
    private ObjectNode meta;

    public Recording(Game game, ObjectMapper json, Map<String, Map<String, String>> tokenArtByPlayer) {
        this.game = game;
        this.json = json;
        this.views = new ViewJson(json, true);
        views.setTokenArt(owner -> owner == null ? null : tokenArtByPlayer.get(owner.getName()));
    }

    /** Called once, when the game is over and the replay is ready. */
    public void onFinish(Consumer<Recording> c) {
        onFinish = c == null ? r -> { } : c;
    }

    @Subscribe
    public void onEvent(GameEvent ev) {
        Recording done = null;
        synchronized (this) {
            if (finished) {
                return;
            }
            if (ev instanceof GameEventGameOutcome outcome) {
                frame();
                finish(outcome);
                done = this;
            } else if (ev instanceof GameEventPlayerPriority) {
                var ph = game.getPhaseHandler();
                long key = ph.getTurn() * 100L + (ph.getPhase() == null ? 0 : ph.getPhase().ordinal());
                if (dirty || key != stepKey) {
                    stepKey = key;
                    frame();
                }
            } else {
                dirty = true;
            }
        }
        if (done != null) {
            try {
                onFinish.accept(done);
            } catch (RuntimeException e) {
                Logger.warn(e, "Couldn't hand the replay over");
            }
        }
    }

    /** Adds the table as it is now, if it changed. */
    private void frame() {
        if (truncated) {
            return;
        }
        if (frames.size() >= MAX_FRAMES) {
            truncated = true;
            return;
        }
        try {
            GameView gv = game.getView();
            Iterator<PlayerView> it = gv == null ? null : gv.getPlayers().iterator();
            if (it == null || !it.hasNext()) {
                return;
            }
            ObjectNode now = normalize(views.game(gv, it.next()));
            ObjectNode patch = last == null ? now.deepCopy() : diff(last, now);
            log(patch);
            dirty = false;
            if (patch.isEmpty()) {
                return;
            }
            frames.add(json.writeValueAsBytes(patch));
            last = now;
        } catch (Exception e) {
            Logger.warn(e, "Couldn't record a replay frame");
        }
    }

    /** The log lines since the last frame (after cutting back to what a rewind kept). */
    private void log(ObjectNode patch) {
        List<GameLogEntry> all = game.getGameLog().getAllEntries();
        int same = 0;
        while (same < logSent.size() && same < all.size() && logSent.get(same).equals(all.get(same))) {
            same++;
        }
        if (same < logSent.size()) {
            patch.put("logCut", same);
        }
        if (same < all.size()) {
            ArrayNode add = patch.putArray("logAdd");
            for (int i = same; i < all.size(); i++) {
                add.add(all.get(i).message());
            }
        }
        logSent.clear();
        logSent.addAll(all);
    }

    /** Cards once, by id, in {@code cards}; zones as lists of ids. The log is sent apart. */
    static ObjectNode normalize(ObjectNode view) {
        view.remove("log");
        view.remove("viewer");
        ObjectNode cards = view.putObject("cards");
        for (JsonNode p : view.path("players")) {
            for (String zone : ZONES) {
                JsonNode list = p.path(zone);
                if (!list.isArray()) {
                    continue;
                }
                ArrayNode ids = ((ObjectNode) p).putArray(zone);
                for (JsonNode c : list) {
                    ids.add(c.path("id").asInt());
                    cards.set(c.path("id").asText(), c);
                }
            }
        }
        return view;
    }

    /** A JSON merge patch (RFC 7386) turning {@code a} into {@code b}: arrays are replaced whole. */
    static ObjectNode diff(ObjectNode a, ObjectNode b) {
        ObjectNode p = a.objectNode();
        a.fieldNames().forEachRemaining(f -> {
            if (!b.has(f)) {
                p.putNull(f);
            }
        });
        b.fields().forEachRemaining(e -> {
            JsonNode was = a.get(e.getKey());
            JsonNode is = e.getValue();
            if (was == null || !was.equals(is)) {
                if (was instanceof ObjectNode wo && is instanceof ObjectNode io) {
                    p.set(e.getKey(), diff(wo, io));
                } else {
                    p.set(e.getKey(), is.deepCopy());
                }
            }
        });
        return p;
    }

    private void finish(GameEventGameOutcome outcome) {
        finished = true;
        ObjectNode m = json.createObjectNode();
        List<String> names = new ArrayList<>();
        ArrayNode players = m.putArray("players");
        for (Player p : game.getRegisteredPlayers()) {
            names.add(p.getName());
            ObjectNode o = players.addObject();
            o.put("name", p.getName());
            o.put("human", p.getController() instanceof PlayerControllerHuman);
            List<Card> commanders = p.getCommanders();
            if (commanders != null && !commanders.isEmpty()) {
                o.put("commander", commanders.get(0).getName());
            }
        }
        m.put("title", String.join(" vs ", names));
        m.put("playedAt", System.currentTimeMillis());
        m.put("turns", outcome == null ? game.getPhaseHandler().getTurn() : outcome.lastTurnNumber());
        m.put("frames", frames.size());
        if (outcome != null && outcome.winningPlayerName() != null) {
            m.put("winner", outcome.winningPlayerName());
        }
        if (truncated) {
            m.put("truncated", true);
        }
        meta = m;
    }

    /** What the replay is: players, turns, winner… (null until the game is over). */
    public synchronized ObjectNode meta() {
        return meta;
    }

    public synchronized int frameCount() {
        return frames.size();
    }

    /** The replay file (gzipped JSON). Only once the game is over. */
    public synchronized byte[] bytes() throws IOException {
        if (meta == null) {
            throw new IllegalStateException("The game isn't over");
        }
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (OutputStream out = new GZIPOutputStream(buf)) {
            out.write(("{\"version\":" + VERSION + ",\"meta\":").getBytes(StandardCharsets.UTF_8));
            out.write(json.writeValueAsBytes(meta));
            out.write(",\"frames\":[".getBytes(StandardCharsets.UTF_8));
            for (int i = 0; i < frames.size(); i++) {
                if (i > 0) {
                    out.write(',');
                }
                out.write(frames.get(i));
            }
            out.write("]}".getBytes(StandardCharsets.UTF_8));
        }
        return buf.toByteArray();
    }
}
