package forge.web.engine;

import forge.game.Game;
import forge.game.player.Player;
import forge.player.LobbyPlayerHuman;
import forge.util.GuiDisplayUtil;

/** A browser player in the lobby: like Forge's human player, but playing with {@link WebPlayerController}. */
public class WebLobbyPlayer extends LobbyPlayerHuman {

    /** The browser this player plays in, when there is one (for questions Forge asks in steps). */
    private final BrowserSeat seat;

    public WebLobbyPlayer(String name, BrowserSeat seat) {
        super(name);
        this.seat = seat;
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player player = new Player(GuiDisplayUtil.personalizeHuman(getName()), game, id);
        player.setFirstController(new WebPlayerController(game, player, this, seat));
        return player;
    }
}
