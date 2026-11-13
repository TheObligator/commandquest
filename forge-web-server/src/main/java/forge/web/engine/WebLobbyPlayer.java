package forge.web.engine;

import forge.game.Game;
import forge.game.player.Player;
import forge.player.LobbyPlayerHuman;
import forge.util.GuiDisplayUtil;
import java.util.function.Consumer;

/** A browser player in the lobby: like Forge's human player, but playing with {@link WebPlayerController}. */
public class WebLobbyPlayer extends LobbyPlayerHuman {

    private final Consumer<String> notice;

    /** {@code notice}: tells this player's browser something, or null. */
    public WebLobbyPlayer(String name, Consumer<String> notice) {
        super(name);
        this.notice = notice;
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player player = new Player(GuiDisplayUtil.personalizeHuman(getName()), game, id);
        player.setFirstController(new WebPlayerController(game, player, this, notice));
        return player;
    }
}
