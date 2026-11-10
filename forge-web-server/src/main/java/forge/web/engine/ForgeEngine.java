package forge.web.engine;

import forge.StaticData;
import forge.gui.GuiBase;
import forge.localinstance.properties.ForgeNetPreferences.FNetPref;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import java.nio.file.Files;
import java.nio.file.Path;
import org.tinylog.Logger;

/**
 * Starts Forge's rules engine once per process, with no desktop GUI. Card scripts load lazily
 * (only a name index up front; each card is parsed the first time a game uses it), so startup
 * takes seconds, not the full card database parse.
 */
public final class ForgeEngine {

    private static boolean started;

    private ForgeEngine() {
    }

    /**
     * Finds upstream's {@code forge-gui/} directory (it holds {@code res/}, the card scripts):
     * {@code FORGE_ASSETS} if set, else {@code ./forge-gui} or {@code ../forge-gui}, which covers
     * running from the repo root (the game service) and from {@code forge-web-server/} (tests).
     */
    public static Path findAssets() {
        String env = System.getenv("FORGE_ASSETS");
        if (env != null && !env.isBlank()) {
            return Path.of(env.trim());
        }
        for (String candidate : new String[] {"forge-gui", "../forge-gui"}) {
            Path p = Path.of(candidate);
            if (Files.isDirectory(p.resolve("res/cardsfolder"))) {
                return p;
            }
        }
        throw new IllegalStateException("Can't find forge-gui/res; set FORGE_ASSETS to the forge-gui directory");
    }

    public static synchronized void start() {
        start(findAssets());
    }

    public static synchronized void start(Path forgeGuiDir) {
        if (started) {
            return;
        }
        long t0 = System.currentTimeMillis();
        GuiBase.setInterface(new HeadlessGui(forgeGuiDir));
        if (StaticData.instance() == null) {
            FModel.initialize(null, prefs -> {
                prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
                prefs.setPref(FPref.UI_LANGUAGE, "en-US");
                // Deck legality is checked before a game starts (by us), not by Forge's lobby.
                prefs.setPref(FPref.ENFORCE_DECK_LEGALITY, false);
                FModel.getNetPreferences().setPref(FNetPref.UPnP, "NEVER");
                return null;
            });
        }
        FModel.getPreferences().setPref(FPref.UI_RECORD_REPLAYS, false);
        FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, false);
        started = true;
        Logger.info("Forge engine ready in {} ms (assets {})", System.currentTimeMillis() - t0, forgeGuiDir.toAbsolutePath().normalize());
    }
}
