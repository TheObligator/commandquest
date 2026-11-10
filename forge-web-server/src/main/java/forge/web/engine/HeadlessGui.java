package forge.web.engine;

import forge.gamemodes.match.HostedMatch;
import forge.gui.download.GuiDownloadService;
import forge.gui.interfaces.IGuiBase;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
import forge.localinstance.skin.ISkinImage;
import forge.sound.IAudioClip;
import forge.sound.IAudioMusic;
import forge.util.FSerializableFunction;
import forge.util.ImageFetcher;
import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.jupnp.UpnpServiceConfiguration;
import org.tinylog.Logger;

/**
 * Forge's GUI hooks for a server with no screen. Forge's human controller expects a single GUI
 * thread (desktop Forge's Swing EDT), so this provides one: a single "forge-ui" thread that runs
 * everything handed to {@code invokeInEdt*}. Browser answers are applied on it too, which keeps
 * Forge's input handling on the thread it was written for.
 *
 * <p>{@link #hasNetGame()} is true: Forge then treats every human as remote, so its controller
 * sends views (CardView, PlayerView) instead of live game objects.
 */
public final class HeadlessGui implements IGuiBase {

    private final String assetsDir;
    private volatile Thread uiThread;
    private final ExecutorService ui = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "forge-ui");
        t.setDaemon(true);
        uiThread = t;
        return t;
    });

    /** @param forgeGuiDir upstream's {@code forge-gui/} directory, which holds {@code res/} */
    public HeadlessGui(Path forgeGuiDir) {
        this.assetsDir = forgeGuiDir.toAbsolutePath().normalize() + File.separator;
    }

    @Override public boolean isRunningOnDesktop() { return true; }
    @Override public boolean isLibgdxPort() { return false; }
    @Override public String getCurrentVersion() { return "commandquest"; }
    @Override public String getUserAgent() { return "CommandQuest/1.0"; }
    @Override public String getAssetsDir() { return assetsDir; }
    @Override public boolean hasNetGame() { return true; }
    @Override public HostedMatch hostMatch() { return new HostedMatch(); }
    @Override public IGuiGame getNewGuiGame() { return null; }

    @Override public boolean isGuiThread() { return Thread.currentThread() == uiThread; }
    @Override public void invokeInEdtNow(Runnable r) { r.run(); }
    @Override public void invokeInEdtLater(Runnable r) {
        ui.execute(() -> {
            try {
                r.run();
            } catch (RuntimeException e) {
                Logger.error(e, "Error on the forge-ui thread");
            }
        });
    }
    @Override public void invokeInEdtAndWait(Runnable r) {
        if (isGuiThread()) {
            r.run();
            return;
        }
        try {
            ui.submit(r).get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException e) {
            throw new RuntimeException(e.getCause());
        }
    }
    @Override public void runBackgroundTask(String message, Runnable task) { task.run(); }

    // Everything below is desktop UI that a server never shows.
    @Override public ImageFetcher getImageFetcher() { return null; }
    @Override public ISkinImage getSkinIcon(FSkinProp skinProp) { return null; }
    @Override public ISkinImage getUnskinnedIcon(String path) { return null; }
    @Override public ISkinImage getCardArt(PaperCard card, boolean backFace) { return null; }
    @Override public ISkinImage createLayeredImage(PaperCard card, FSkinProp background, String overlayFilename, float opacity) { return null; }
    @Override public void clearImageCache() { }
    @Override public String encodeSymbols(String str, boolean formatReminderText) { return str; }
    @Override public int getAvatarCount() { return 0; }
    @Override public int getSleevesCount() { return 0; }
    @Override public float getScreenScale() { return 1.0f; }
    @Override public void preventSystemSleep(boolean preventSleep) { }
    @Override public void download(GuiDownloadService service, Consumer<Boolean> callback) { callback.accept(false); }
    @Override public void copyToClipboard(String text) { }
    @Override public void browseToUrl(String url) { }
    @Override public void showCardList(String title, String message, List<PaperCard> list) { }
    @Override public boolean showBoxedProduct(String title, String message, List<PaperCard> list) { return false; }
    @Override public void showBugReportDialog(String title, String text, boolean showExitAppBtn) {
        Logger.error("Forge bug report: {}\n{}", title, text);
    }
    @Override public void showImageDialog(ISkinImage image, String message, String title) { }
    @Override public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) { return defaultOption; }
    @Override public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) { return initialInput; }
    @Override public String showFileDialog(String title, String defaultDir) { return defaultDir; }
    @Override public File getSaveFile(File defaultFile) { return defaultFile; }
    @Override public <T> List<T> order(String title, String top, int remainingObjectsMin, int remainingObjectsMax, List<T> sourceChoices, List<T> destChoices) { return destChoices; }
    @Override public <T> List<T> getChoices(String message, int min, int max, Collection<T> choices, Collection<T> selected, FSerializableFunction<T, String> display) {
        return selected == null ? new ArrayList<>() : new ArrayList<>(selected);
    }
    @Override public PaperCard chooseCard(String title, String message, List<PaperCard> list) { return list.isEmpty() ? null : list.get(0); }
    @Override public boolean isSupportedAudioFormat(File file) { return false; }
    @Override public IAudioClip createAudioClip(String filename) { return null; }
    @Override public IAudioMusic createAudioMusic(String filename) { return null; }
    @Override public void startAltSoundSystem(String filename, boolean isSynchronized) { }
    @Override public void showSpellShop() { }
    @Override public void showBazaar() { }
    @Override public UpnpServiceConfiguration getUpnpPlatformService() { return null; }
}
