// Left side of the table: the decision the game wants from you, quick auto-pass skips, the stack,
// the hovered card and the game log.
import { useEffect, useRef } from "react";
import { CardBack, cardImage, tokenImage, usePreview, type Preview } from "./cards";
import type { AutoPassMode } from "./phases";
import { stepLabel } from "./sim";
import type { SimGame } from "./useSimGame";
import { commanderTax, type GameView } from "./view";

export const AUTO_PASS: { mode: AutoPassMode; label: string; key: string; title: string }[] = [
  { mode: "END_OF_TURN", label: "End of turn", key: "E", title: "Skip the rest of this turn. Your stops apply again next turn." },
  { mode: "BEFORE_MY_TURN", label: "Before my turn", key: "B", title: "Skip until the end step of the player right before you." },
  { mode: "ACTION_OR_END_STEP", label: "Action / end step", key: "R", title: "Skip until someone casts something, or this turn's end step." },
];

export function ActionRail(props: {
  sim: SimGame;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  bottomIds: number[];
  preview: Preview | null;
  onError: (msg: string) => void;
}) {
  const { sim, nameOf, colorOf, preview } = props;
  const v = sim.view;
  return (
    <aside className="action-rail">

      <section className="ar-stack">
        <header>
          <h3>Stack</h3>
          <span className="ar-sub">{v.stack.length ? `${v.stack.length} item${v.stack.length > 1 ? "s" : ""} · top first` : "empty"}</span>
        </header>
        <StackList view={v} nameOf={nameOf} colorOf={colorOf} />
      </section>

      <section className="ar-preview" aria-live="polite">
        {preview ? <PreviewCard p={preview} /> : <p className="ar-sub">Hover a card to see it here.</p>}
      </section>

      <Log lines={v.log} />

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
              <kbd>{a.key}</kbd>
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
  let actions: { label: string; key: string; primary?: boolean; disabled?: boolean; run: () => void }[] = [];

  if (sim.phase === "mulligan") {
    const keep = 7 - sim.mulligans;
    title = "Opening hand";
    text = sim.mulligans ? `Keep and put ${sim.mulligans} card${sim.mulligans > 1 ? "s" : ""} on the bottom, or mulligan again?` : "Keep this 7-card hand, or mulligan?";
    actions = [
      { label: `Keep ${keep}`, key: "1", primary: true, run: sim.keep },
      { label: "Mulligan", key: "2", disabled: keep <= 1, run: sim.mulligan },
    ];
  } else if (sim.phase === "bottom") {
    title = "Bottom of library";
    text = `Choose ${sim.mulligans} card${sim.mulligans > 1 ? "s" : ""} in your hand to put on the bottom (${bottomIds.length}/${sim.mulligans}).`;
    actions = [{ label: "Confirm", key: "1", primary: true, disabled: bottomIds.length !== sim.mulligans, run: () => sim.confirmBottom(bottomIds) }];
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
    actions = [{ label: "Let it resolve", key: "F2", primary: true, run: sim.pass }];
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
    actions = [{ label: "Pass priority", key: "F2", primary: true, run: sim.pass }];
    const commander = me.command[0];
    if (commander && mine && (v.step === "MAIN1" || v.step === "MAIN2")) {
      actions.push({
        label: `Cast ${commander.name?.split(",")[0]} (+${commanderTax(me)})`,
        key: "C",
        run: () => {
          const err = sim.castCommander();
          if (err) onError(err);
        },
      });
    }
  }

  // 1 / 2 / C shortcuts for the buttons shown.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
      const a = actionsRef.current.find((x) => x.key.length === 1 && x.key.toLowerCase() === e.key.toLowerCase());
      if (a && !a.disabled) (e.preventDefault(), a.run());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section className={`ar-decision${sim.priority || sim.phase !== "playing" ? " live" : ""}`}>
      <div className="ar-ribbon">Decision</div>
      <h3>{title}</h3>
      <p>{text}</p>
      <div className="ar-actions">
        {actions.map((a) => (
          <button key={a.label} className={`ar-btn${a.primary ? " primary" : ""}`} disabled={a.disabled} onClick={a.run}>
            {a.label}
            <kbd>{a.key}</kbd>
          </button>
        ))}
      </div>
    </section>
  );
}

export function StackList({ view, nameOf, colorOf }: { view: GameView; nameOf: (id: string) => string; colorOf: (id: string) => string }) {
  const setPreview = usePreview();
  if (!view.stack.length) return null;
  return (
    <ol className="stack-list">
      {[...view.stack].reverse().map((s, i) => (
        <li
          key={s.id}
          className={i === 0 ? "top" : undefined}
          style={{ "--seat": colorOf(s.controller) } as React.CSSProperties}
          onMouseEnter={() => s.card && setPreview({ card: s.card })}
          onMouseLeave={() => setPreview(null)}
        >
          {s.card && (tokenImage(s.card) ?? cardImage(s.card.name, "small")) && <img src={tokenImage(s.card) ?? cardImage(s.card.name, "small")} alt="" />}
          <div>
            <strong>{s.name}</strong>
            <span>{s.kind} · {s.controller === view.viewer ? "you" : nameOf(s.controller)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PreviewCard({ p }: { p: Preview }) {
  const src = p.card.hidden ? undefined : p.card.token ? tokenImage(p.card) : cardImage(p.card.name, "normal");
  return (
    <figure>
      {p.card.hidden ? (
        <div className="ar-preview-back"><CardBack /></div>
      ) : src ? (
        <img src={src} alt={p.card.name} />
      ) : (
        <div className="ar-preview-token">
          <strong>{p.card.name}</strong>
          <span>{p.card.token ? "Token " : ""}{p.card.types?.join(" ")}</span>
          {p.card.power !== undefined && <span className="big">{p.card.power}/{p.card.toughness}</span>}
        </div>
      )}
      {p.note && <figcaption>{p.note}</figcaption>}
    </figure>
  );
}

export function Log({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length]);
  return (
    <section className="ar-log">
      <header><h3>Log</h3></header>
      <ol ref={ref}>
        {lines.slice(-60).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
    </section>
  );
}
