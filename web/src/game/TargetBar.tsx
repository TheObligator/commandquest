// A bar over the top of the table while you choose things that are on it: targets for a spell or
// ability, a permanent to sacrifice, cards to discard from your hand, a player. The choosable
// cards and players glow on the board, and you click them there; the bar says what you're choosing
// and has the buttons. It doesn't cover the board, so it isn't a blocking window.
import { PressButton } from "./PressButton";
import type { Sent } from "./sending";

export function TargetBar(props: {
  /** What you're choosing ("Select targets for Lightning Bolt"), Forge's wording. */
  message: string;
  /** "1 of 2 chosen" and the like. */
  status?: string;
  /** How many you've chosen of how many you need (shown as a count; "1 / 2"). */
  count?: { picked: number; min: number; max: number };
  ok?: { label: string; enabled: boolean; onClick: () => void };
  cancel?: { label: string; enabled: boolean; onClick: () => void };
  /** The button the game server hasn't answered yet. */
  sent: Sent | null;
}) {
  const [title, ...rest] = props.message.split("\n");
  const c = props.count;
  // Everything you need is chosen: the bar turns green and asks you to confirm. Nothing is sent
  // until you press the button, so you can still change your mind.
  const ready = !!c && !!props.ok?.enabled && c.picked > 0 && (c.picked === c.max || (c.min > 0 && c.picked >= c.min));
  const need = c ? (c.min === c.max ? `${c.max}` : c.min ? `${c.min}–${c.max}` : `${c.max}`) : "";
  const detail = ready
    ? c!.picked === c!.max
      ? "Click a chosen card again to swap it"
      : `You can choose up to ${c!.max}, or confirm now`
    : [rest.join(" ").trim(), props.status].filter(Boolean).join(" · ");
  return (
    <div className={`target-bar${ready ? " ready" : ""}${ready && c!.max > 1 && c!.picked === c!.max ? " full" : ""}`} role="status">
      <span className="tb-icon" aria-hidden>{ready ? "✓" : "◎"}</span>
      <div className="tb-text">
        <b>{ready ? (c!.picked === c!.max && c!.max > 1 ? `All ${c!.picked} chosen — press ${props.ok!.label}` : `${c!.picked} chosen — press ${props.ok!.label}`) : title || "Choose"}</b>
        {detail && <span>{detail}</span>}
      </div>
      {c && c.max > 1 && (
        <span className="tb-count" aria-label={`${c.picked} of ${need} chosen`}>
          {c.picked} / {need}
          {ready && " ✓"}
        </span>
      )}
      {props.ok?.label && (
        <PressButton what="ok" sent={props.sent} className="btn small tb-ok" disabled={!props.ok.enabled} onClick={props.ok.onClick}>{props.ok.label}</PressButton>
      )}
      {props.cancel?.label && (
        <PressButton what="cancel" sent={props.sent} className="btn small ghost" disabled={!props.cancel.enabled} onClick={props.cancel.onClick}>{props.cancel.label}</PressButton>
      )}
    </div>
  );
}
