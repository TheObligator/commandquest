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
  ok?: { label: string; enabled: boolean; onClick: () => void };
  cancel?: { label: string; enabled: boolean; onClick: () => void };
  /** The button the game server hasn't answered yet. */
  sent: Sent | null;
}) {
  const [title, ...rest] = props.message.split("\n");
  return (
    <div className="target-bar" role="status">
      <span className="tb-icon" aria-hidden>◎</span>
      <div className="tb-text">
        <b>{title || "Choose"}</b>
        {(rest.join(" ").trim() || props.status) && (
          <span>{[rest.join(" ").trim(), props.status].filter(Boolean).join(" · ")}</span>
        )}
      </div>
      {props.ok?.label && (
        <PressButton what="ok" sent={props.sent} className="btn small" disabled={!props.ok.enabled} onClick={props.ok.onClick}>{props.ok.label}</PressButton>
      )}
      {props.cancel?.label && (
        <PressButton what="cancel" sent={props.sent} className="btn small ghost" disabled={!props.cancel.enabled} onClick={props.cancel.onClick}>{props.cancel.label}</PressButton>
      )}
    </div>
  );
}
