// Vertical phase strip with priority stops (docs/stops.md).
//
// Every step is a tile split in two: the left part is a stop on YOUR turn, the right part a stop
// on opponents' turns. With "Per opponent" on, the right part splits into one slice per opponent
// (in turn order, in their seat colors), so each opponent can have different stops. Otherwise one
// click sets the step for every opponent at once.
import { Fragment } from "react";
import { STEPS, toggleForAll, toggleStop, type StepId, type TableStops } from "./phases";

export interface Seat {
  id: string;
  name: string;
  /** CSS color for the player's marker. */
  color: string;
}

const SHORT: Record<StepId, string> = {
  UNTAP: "Untap", UPKEEP: "Upkeep", DRAW: "Draw", MAIN1: "Main 1",
  COMBAT_BEGIN: "Beg.", COMBAT_DECLARE_ATTACKERS: "Atk", COMBAT_DECLARE_BLOCKERS: "Blk",
  COMBAT_FIRST_STRIKE_DAMAGE: "1st", COMBAT_DAMAGE: "Dmg", COMBAT_END: "End C.",
  MAIN2: "Main 2", END_OF_TURN: "End", CLEANUP: "Clean",
};

/** Divider shown above the first step of these phases. */
const DIVIDERS: Partial<Record<string, string>> = { Combat: "combat", "Postcombat main": "main", Ending: "ending" };

export function PhaseStrip(props: {
  me: Seat;
  /** In turn order after you. */
  opponents: Seat[];
  stops: TableStops;
  /** Called with the same (mutated) stops object after every change. */
  onChange: (stops: TableStops) => void;
  activePlayer: string;
  step: StepId;
  turn: number;
  /** You have priority right now. */
  priority: boolean;
  perOpponent: boolean;
  onPerOpponent: (on: boolean) => void;
  holdPriority: boolean;
  onHoldPriority: (on: boolean) => void;
}) {
  const { me, opponents, stops, onChange, activePlayer, step: current, turn, priority, perOpponent } = props;
  const oppIds = opponents.map((o) => o.id);
  const active = activePlayer === me.id ? me : opponents.find((o) => o.id === activePlayer);
  const myTurn = activePlayer === me.id;

  return (
    <aside className="phase-strip" style={{ "--active": active?.color } as React.CSSProperties} aria-label="Phases and stops">
      <div className="ps-turn">
        <strong>{myTurn ? "Your turn" : `${active?.name ?? "Opp"}'s turn`}</strong>
        <span>T{turn}</span>
      </div>
      <div className={`ps-priority${priority ? " on" : ""}`} role="status">
        <i /> {priority ? "Priority" : "Waiting"}
      </div>

      <div className="ps-steps">
        {STEPS.map((step, i) => {
          const divider = i > 0 && STEPS[i - 1].phase !== step.phase ? DIVIDERS[step.phase] : undefined;
          const here = current === step.id;
          const meOn = stops.get(me.id)?.has(step.id) ?? false;
          const oppOn = oppIds.filter((id) => stops.get(id)?.has(step.id));
          return (
            <Fragment key={step.id}>
              {divider && <div className="ps-divider"><span>{divider}</span></div>}
              <div
                className={["ps-step", !step.priority && "no-priority", here && "here", here && priority && "stopped", here && (myTurn ? "here-me" : "here-opp")]
                  .filter(Boolean).join(" ")}
              >
                {step.priority && (
                  <>
                    <button
                      className="ps-me"
                      aria-pressed={meOn}
                      title={`${meOn ? "Don't stop" : "Stop"} at ${step.label} on your turn`}
                      onClick={() => {
                        toggleStop(stops, me.id, step.id);
                        onChange(stops);
                      }}
                    />
                    <div className={`ps-opps${perOpponent ? " split" : ""}`}>
                      {perOpponent ? (
                        opponents.map((o) => {
                          const on = oppOn.includes(o.id);
                          return (
                            <button
                              key={o.id}
                              className={`ps-opp${activePlayer === o.id ? " active" : ""}`}
                              style={{ "--seat": o.color } as React.CSSProperties}
                              aria-pressed={on}
                              title={`${on ? "Don't stop" : "Stop"} at ${step.label} on ${o.name}'s turn`}
                              onClick={() => {
                                toggleStop(stops, o.id, step.id);
                                onChange(stops);
                              }}
                            />
                          );
                        })
                      ) : (
                        <button
                          className="ps-opp all"
                          aria-pressed={oppOn.length === oppIds.length && oppIds.length > 0}
                          data-mixed={oppOn.length > 0 && oppOn.length < oppIds.length}
                          title={`Stop at ${step.label} on every opponent's turn${oppOn.length && oppOn.length < oppIds.length ? ` (now on for ${oppOn.length} of ${oppIds.length})` : ""}`}
                          disabled={!oppIds.length}
                          onClick={() => {
                            toggleForAll(stops, oppIds, step.id);
                            onChange(stops);
                          }}
                        />
                      )}
                    </div>
                  </>
                )}
                <span className="ps-label">{SHORT[step.id]}</span>
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className="ps-legend">
        <span><i className="sw me" /> You</span>
        <span><i className="sw opp" /> Opp</span>
      </div>
      <label className="ps-switch" title="Give each opponent its own stops (one slice per opponent, in turn order)">
        <input type="checkbox" checked={perOpponent} onChange={(e) => props.onPerOpponent(e.target.checked)} />
        <span>Per opponent</span>
      </label>
      <button
        className={`ps-hold${props.holdPriority ? " on" : ""}`}
        aria-pressed={props.holdPriority}
        title="Keep priority after you cast a spell, so you can respond to it yourself (H)"
        onClick={() => props.onHoldPriority(!props.holdPriority)}
      >
        Hold priority
        <span className="ps-toggle"><i /></span>
        <kbd>H</kbd>
      </button>
    </aside>
  );
}
