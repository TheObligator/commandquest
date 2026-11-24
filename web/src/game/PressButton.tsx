// A button that asks the game server for something (src/game/sending.ts). Once the server takes a
// moment over it, the pressed button spins and it and the buttons beside it stop responding, so you
// can see that the press was heard and that another wouldn't do anything. They work again when the
// server has answered, or has clearly not.
import { Spinner } from "../components/Spinner";
import type { Sent } from "./sending";

export function PressButton({ what, sent, className, disabled, title, onClick, hint, children }: {
  /** What pressing it sends, as in `sent`. */
  what: string;
  /** What the server hasn't answered yet. */
  sent: Sent | null;
  className: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  /** At the end of the button (its key). */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const mine = sent?.what === what;
  return (
    <button
      className={`${className}${mine ? " pressed" : sent ? " held" : ""}`}
      disabled={disabled && !mine}
      aria-disabled={sent ? true : undefined}
      aria-busy={mine || undefined}
      title={sent ? "Waiting for the game server" : title}
      onClick={() => !sent && onClick()}
    >
      <span className="press-label">
        {mine && <Spinner />}
        {children}
      </span>
      {hint}
    </button>
  );
}
