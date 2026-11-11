// The pay window: when a spell or ability you're casting needs mana, choose Auto-pay (Forge taps
// your sources for you, basics before dual lands), tap your lands yourself, Cancel the cast, or in
// a free-play game pay nothing. It floats over the table without blocking it, so you can still
// click your own mana sources.
import { ManaCost } from "../components/ManaCost";
import { Kbd } from "./useHotkeys";
import type { LiveGame, LivePrompt } from "./useLiveGame";

const FREE_LABEL = { spell: "Cast for free", ability: "Activate for free", effect: "Pay nothing" } as const;

export function PayPrompt({ prompt, game }: { prompt: LivePrompt; game: Pick<LiveGame, "ok" | "cancel" | "payFree"> }) {
  const pay = prompt.pay!;
  const what = pay.kind === "spell" ? "Cast" : pay.kind === "ability" ? "Activate" : "Pay for";
  return (
    <div className="pay-prompt" role="dialog" aria-label={`Pay for ${pay.card}`}>
      <header>
        <span className="pay-what">{what}</span>
        <strong>{pay.card || "this"}</strong>
        <ManaCost cost={pay.cost} />
      </header>
      <div className="pay-btns">
        <button
          className="ar-btn primary"
          disabled={!prompt.ok.enabled}
          title={prompt.ok.enabled ? "Tap your mana sources for you, using basic lands before dual and any-color ones" : "Your untapped sources can't pay this"}
          onClick={game.ok}
        >
          Auto-pay
          <Kbd action="ok" />
        </button>
        {pay.free && (
          <button className="ar-btn free" title="Free play: pay this mana cost with nothing. The game log shows it was done by hand." onClick={game.payFree}>
            {FREE_LABEL[pay.kind]}
          </button>
        )}
        <button className="ar-btn" disabled={!prompt.cancel.enabled} onClick={game.cancel}>
          Cancel
          <Kbd action="cancel" />
        </button>
      </div>
      <p className="pay-hint">
        {prompt.ok.enabled ? "Or tap your mana sources yourself." : "Not enough untapped mana for Auto-pay. Tap sources yourself, or cancel."}
      </p>
    </div>
  );
}
