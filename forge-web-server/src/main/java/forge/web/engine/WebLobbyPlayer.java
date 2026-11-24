package forge.web.engine;

import forge.game.Game;
import forge.game.player.Player;
import forge.player.LobbyPlayerHuman;
import forge.util.GuiDisplayUtil;

/** A browser player in the lobby: like Forge's human player, but playing with {@link WebPlayerController}. */
public class WebLobbyPlayer extends LobbyPlayerHuman {

    /** This player's browser, or null. */
    private final BrowserSeat seat;
    private volatile WebPlayerController controller;

    public WebLobbyPlayer(String name, BrowserSeat seat) {
        super(name);
        this.seat = seat;
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player player = new Player(GuiDisplayUtil.personalizeHuman(getName()), game, id);
        controller = new WebPlayerController(game, player, this, seat);
        player.setFirstController(controller);
        return player;
    }

    /** This player's own controller, even while someone else controls their turn; null before the game. */
    WebPlayerController controller() {
        return controller;
    }
}
