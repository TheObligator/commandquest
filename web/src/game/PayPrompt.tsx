// The pay window: when a spell or ability you're casting needs mana, choose Auto-pay (Forge taps
// your sources for you, basics before dual lands), tap your lands yourself, Cancel the cast, or in
// a free-play game pay nothing. After Auto-pay the window shows what it tapped: Confirm (Space)
// spends that mana, Undo auto-pay (Esc) untaps it to pay another way. It floats over the table without blocking it, so you can still
// click your own mana sources.
import { ManaCost } from "../components/ManaCost";
import { Waiting } from "../components/Spinner";
import { PressButton } from "./PressButton";
import { Kbd } from "./useHotkeys";
import type { LiveGame, LivePrompt } from "./useLiveGame";

const FREE_LABEL = { spell: "Cast for free", ability: "Activate for free", effect: "Pay nothing" } as const;

export function PayPrompt({ prompt, game, pool }: {
  prompt: LivePrompt;
  game: Pick<LiveGame, "ok" | "cancel" | "payFree" | "payPool" | "sent">;
  /** Your floating mana, by symbol. */
  pool?: Record<string, number>;
}) {
  const pay = prompt.pay!;
  // only the floating mana that can pay some of this (colorless can't pay {W/U})
  const floating = Object.entries(pool ?? {}).filter(([x, n]) => n > 0 && (!pay.pool || pay.pool.includes(x)));
  const what = pay.kind === "spell" ? "Cast" : pay.kind === "ability" ? "Activate" : "Pay for";
  if (pay.autoPaid) {
    return (
      <div className="pay-prompt" role="dialog" aria-label={`Confirm paying for ${pay.card}`}>
        <header>
          <span className="pay-what">{what}</span>
          <strong>{pay.card || "this"}</strong>
          <ManaCost cost={pay.cost} font />
        </header>
        <p className="pay-tapped">Auto-pay tapped <b>{pay.autoPaid}</b>.</p>
        <div className="pay-btns">
          <PressButton what="ok" sent={game.sent} className="ar-btn primary" title="Pay with this mana" onClick={game.ok} hint={<Kbd action="ok" />}>
            Confirm
          </PressButton>
          <PressButton what="cancel" sent={game.sent} className="ar-btn" title="Untap them and choose the mana yourself" onClick={game.cancel} hint={<Kbd action="cancel" />}>
            Undo auto-pay
          </PressButton>
        </div>
        <p className="pay-hint">{game.sent?.slow ? <Waiting text="Waiting for the game server…" className="" /> : "Or click a land to undo and tap it yourself."}</p>
      </div>
    );
  }
  return (
    <div className="pay-prompt" role="dialog" aria-label={`Pay for ${pay.card}`}>
      <header>
        <span className="pay-what">{what}</span>
        <strong>{pay.card || "this"}</strong>
        <ManaCost cost={pay.cost} font />
      </header>
      <div className="pay-btns">
        <PressButton
          what="ok"
          sent={game.sent}
          className="ar-btn primary"
          disabled={!prompt.ok.enabled}
          title={prompt.ok.enabled ? "Tap your mana sources for you, using basic lands before dual and any-color ones" : "Your untapped sources can't pay this"}
          onClick={game.ok}
          hint={<Kbd action="ok" />}
        >
          Auto-pay
        </PressButton>
        {floating.length > 0 && (
          <PressButton what="payPool:all" sent={game.sent} className="ar-btn" title="Pay with the mana in your pool, as much as it can (click a symbol by your name to use just one)" onClick={() => game.payPool("all")}>
            Use floating <ManaCost cost={floating.map(([x, n]) => `{${x}}`.repeat(n)).join("")} font />
          </PressButton>
        )}
        {pay.free && (
          <PressButton what="payFree" sent={game.sent} className="ar-btn free" title="Free play: pay this mana cost with nothing. The game log shows it was done by hand." onClick={game.payFree}>
            {FREE_LABEL[pay.kind]}
          </PressButton>
        )}
        <PressButton what="cancel" sent={game.sent} className="ar-btn" disabled={!prompt.cancel.enabled} onClick={game.cancel} hint={<Kbd action="cancel" />}>Cancel</PressButton>
      </div>
      <p className="pay-hint">
        {game.sent?.slow ? <Waiting text="Waiting for the game server…" className="" /> : prompt.ok.enabled ? "Or tap your mana sources yourself." : "Not enough untapped mana for Auto-pay. Tap sources yourself, or cancel."}
      </p>
    </div>
  );
}
