// Left side of the table: the decision the game wants from you and
// quick auto-pass skips. (The log is under the phase strip, on the right.)
import { useEffect, useRef } from "react";
import type { HotkeyAction } from "./hotkeys";
import { Kbd, useHotkeys } from "./useHotkeys";
import { previewFor, usePreview, type Preview } from "./cards";
import { logParts } from "./logText";
import type { AutoPassMode } from "./phases";
import { stepLabel } from "./sim";
import type { SimGame } from "./useSimGame";
import { commanderTax, type CardView } from "./view";

export const AUTO_PASS: { mode: AutoPassMode; label: string; key: HotkeyAction; title: string }[] = [
  { mode: "END_OF_TURN", label: "End of turn", key: "autoEndOfTurn", title: "Skip the rest of this turn. Your stops apply again next turn." },
  { mode: "BEFORE_MY_TURN", label: "Before my turn", key: "autoBeforeMyTurn", title: "Skip until the end step of the player right before you." },
  { mode: "UNTIL_MY_TURN", label: "Until my turn", key: "autoUntilMyTurn", title: "Skip everything until your next turn starts, including the end step before it. Your stops apply again on your turn." },
  { mode: "ACTION_OR_END_STEP", label: "Action / end step", key: "autoActionOrEnd", title: "Skip until someone casts something, or this turn's end step." },
];

export function ActionRail(props: {
  sim: SimGame;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  bottomIds: number[];
  preview: Preview | null;
  onError: (msg: string) => void;
}) {
  const { sim } = props;
  return (
    <aside className="action-rail">

      {/* At the bottom, by your hand: the decision, then the skips. */}
      <Decision {...props} />
      {sim.phase === "playing" && (
        <section className="ar-autopass">
          <header>
            <h3>Auto-pass</h3>
            <span className="ar-sub">skip ahead</span>
          </header>
          {AUTO_PASS.map((a) => (
            <button
              key={a.mode}
              className={`ar-skip${sim.autoPass?.mode === a.mode ? " on" : ""}`}
              aria-pressed={sim.autoPass?.mode === a.mode}
              title={a.title + (sim.autoPass?.mode === a.mode ? " Click again to cancel." : "")}
              onClick={() => sim.setAutoPass(a.mode)}
            >
              {a.label}
              <Kbd action={a.key} />
            </button>
          ))}
        </section>
      )}
    </aside>
  );
}

function Decision({ sim, nameOf, bottomIds, onError }: Parameters<typeof ActionRail>[0]) {
  const v = sim.view;
  const me = v.players[0];
  let title: string;
  let text: React.ReactNode;
  let actions: { label: string; key: HotkeyAction; primary?: boolean; disabled?: boolean; run: () => void }[] = [];

  if (sim.phase === "mulligan") {
    const keep = 7 - sim.mulligans;
    title = "Opening hand";
    text = sim.mulligans ? `Keep and put ${sim.mulligans} card${sim.mulligans > 1 ? "s" : ""} on the bottom, or mulligan again?` : "Keep this 7-card hand, or mulligan?";
    actions = [
      { label: `Keep ${keep}`, key: "ok", primary: true, run: sim.keep },
      { label: "Mulligan", key: "cancel", disabled: keep <= 1, run: sim.mulligan },
    ];
  } else if (sim.phase === "bottom") {
    title = "Bottom of library";
    text = `Choose ${sim.mulligans} card${sim.mulligans > 1 ? "s" : ""} in your hand to put on the bottom (${bottomIds.length}/${sim.mulligans}).`;
    actions = [{ label: "Confirm", key: "ok", primary: true, disabled: bottomIds.length !== sim.mulligans, run: () => sim.confirmBottom(bottomIds) }];
  } else if (!sim.priority) {
    title = "Waiting";
    text = "Other players are deciding…";
  } else if (v.stack.length) {
    const top = v.stack[v.stack.length - 1];
    title = "Respond?";
    text = (
      <>
        <strong>{top.name}</strong> ({top.controller === v.viewer ? "yours" : nameOf(top.controller)}) is on top of the stack. Cast an instant to respond, or let it resolve.
      </>
    );
    actions = [{ label: "Let it resolve", key: "ok", primary: true, run: sim.pass }];
  } else {
    const mine = v.active === v.viewer;
    title = `${mine ? "Your" : nameOf(v.active) + "'s"} turn · ${stepLabel(v.step)}`;
    const attackers = v.players.flatMap((p) => p.battlefield).filter((c) => c.attacking === v.viewer);
    text = attackers.length ? (
      <>
        <strong>{nameOf(v.active)}</strong> is attacking you with {attackers.length} creature{attackers.length > 1 ? "s" : ""}.
      </>
    ) : mine && (v.step === "MAIN1" || v.step === "MAIN2") ? (
      sim.canPlayLand ? "Drag a card from your hand onto your board (or double-click it) to play it." : "Cast spells from your hand, or move on."
    ) : (
      "You have priority."
    );
    actions = [{ label: "Pass priority", key: "ok", primary: true, run: sim.pass }];
    const commander = me.command[0];
    if (commander && mine && (v.step === "MAIN1" || v.step === "MAIN2")) {
      actions.push({
        label: `Cast ${commander.name?.split(",")[0]} (+${commanderTax(me)})`,
        key: "castCommander",
        run: () => {
          const err = sim.castCommander();
          if (err) onError(err);
        },
      });
    }
  }

  // Your hotkeys for the buttons shown.
  const byKey = (k: HotkeyAction) => () => {
    const a = actions.find((x) => x.key === k);
    if (!a || a.disabled) return false;
    a.run();
  };
  useHotkeys({ ok: byKey("ok"), cancel: byKey("cancel"), castCommander: byKey("castCommander") });

  return (
    <section className={`ar-decision${sim.priority || sim.phase !== "playing" ? " live" : ""}`}>
      <div className="ar-ribbon">Decision</div>
      <h3>{title}</h3>
      <p>{text}</p>
      <div className="ar-actions">
        {actions.map((a) => (
          <button key={a.label} className={`ar-btn${a.primary ? " primary" : ""}`} disabled={a.disabled} onClick={a.run}>
            {a.label}
            <Kbd action={a.key} />
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The game log, newest at the bottom. Cards it names ("Forgotten Cave (1138)") show as their name,
 * and hovering one shows the card, for spells, lands and the sources of triggered abilities alike.
 */
export function Log({ lines, cardOf, viewer = "", nameOf = (id) => id }: {
  lines: string[];
  /** The card with this id, if you can see it (or have seen it). */
  cardOf?: (id: number) => CardView | undefined;
  viewer?: string;
  nameOf?: (id: string) => string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const setPreview = usePreview();
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length]);
  return (
    <section className="ar-log">
      <header><h3>Log</h3></header>
      <ol ref={ref}>
        {lines.slice(-60).map((l, i) => (
          <li key={i}>
            {cardOf
              ? logParts(l, (id) => cardOf(id)?.name).map((part, k) => typeof part === "string" ? part : (
                <span
                  key={k}
                  className="log-card"
                  onMouseEnter={() => {
                    const c = cardOf(part.id);
                    if (c) setPreview(previewFor(c, viewer, nameOf));
                  }}
                  onMouseLeave={() => setPreview(null)}
                >
                  {part.name}
                </span>
              ))
              : l}
          </li>
        ))}
      </ol>
    </section>
  );
}
