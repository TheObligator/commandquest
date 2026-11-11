package forge.web.engine;

import forge.game.Game;
import forge.game.player.Player;
import forge.player.LobbyPlayerHuman;
import forge.util.GuiDisplayUtil;

/** A browser player in the lobby: like Forge's human player, but playing with {@link WebPlayerController}. */
public class WebLobbyPlayer extends LobbyPlayerHuman {

    public WebLobbyPlayer(String name) {
        super(name);
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player player = new Player(GuiDisplayUtil.personalizeHuman(getName()), game, id);
        player.setFirstController(new WebPlayerController(game, player, this));
        return player;
    }
}
