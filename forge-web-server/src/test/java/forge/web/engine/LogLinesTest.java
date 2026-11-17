package forge.web.engine;

import forge.game.GameLogEntry;
import forge.game.GameLogEntryType;
import forge.game.card.CardView;
import java.util.List;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

public class LogLinesTest {

    @BeforeClass
    public void startEngine() {
        ForgeEngine.start(); // the localizer
    }

    private static GameLogEntry e(GameLogEntryType t, String msg, CardView c) {
        return new GameLogEntry(t, msg, c);
    }

    @Test
    public void castSpellsAndTriggersLinkTheirCardAndResolveBriefly() {
        CardView swarm = new CardView(7, null, "Feed the Swarm");
        CardView challa = new CardView(12, null, "T'Challa, the Black Panther");
        List<String> out = LogLines.render(List.of(
                e(GameLogEntryType.STACK_ADD, "AI 3 cast Feed the Swarm targeting [Whtz, the Bibliophile (45)]", swarm),
                e(GameLogEntryType.STACK_RESOLVE, "Feed the Swarm - Destroy target creature or enchantment an opponent controls.", swarm),
                e(GameLogEntryType.STACK_ADD, "AI 2 triggered T'Challa, the Black Panther", challa),
                e(GameLogEntryType.STACK_RESOLVE, "Whenever T'Challa enters or attacks, create a tapped Vibranium token. [Zone Changer: T'Challa, the Black Panther (12)]", challa),
                e(GameLogEntryType.MANA, "Plains (3) - {T}: Add {W}.", new CardView(3, null, "Plains")),
                e(GameLogEntryType.STACK_RESOLVE, "Feed the Swarm ability fizzles.", swarm)));
        Assert.assertEquals(out, List.of(
                "AI 3 cast Feed the Swarm (7) targeting [Whtz, the Bibliophile (45)]",
                "Feed the Swarm (7) resolved.",
                "AI 2 triggered T'Challa, the Black Panther (12)",
                "T'Challa, the Black Panther (12)'s ability resolved.",
                "Plains (3) - {T}: Add {W}.",
                "Feed the Swarm (7) ability fizzles."));
    }
}
