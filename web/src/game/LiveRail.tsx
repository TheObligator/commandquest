// Left rail for a live game: then at the bottom Forge's current
// prompt (with Forge's own button labels) or question, and the auto-pass skips.
import { useEffect, useState } from "react";
import { AUTO_PASS } from "./ActionRail";
import { isAttackPrompt } from "./AttackArrows";
import { manaChoiceFor } from "./manaOptions";
import { LaterRail } from "./LaterMenu";
import { RewindPanel } from "./RewindPanel";
import { ScryDialog } from "./ScryDialog";
import { Kbd, useHotkeys } from "./useHotkeys";
import { cardImage, previewFor, usePreview, type Preview } from "./cards";
import { logParts } from "./logText";
import { CardImg } from "../components/CardImg";
import { Waiting } from "../components/Spinner";
import { PressButton } from "./PressButton";
import { PointArrows } from "./PointArrows";
import type { LiveAsk, LiveGame } from "./useLiveGame";
import type { CardView, GameView } from "./view";

export function LiveRail(props: {
  game: LiveGame;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  preview: Preview | null;
  /** The pick window (cards to choose from a pile) is hidden: bring it back. */
  onShowPick?: () => void;
  /** The question (`game.ask`) is answered by clicking on the table; this answers it with what's clicked (null: not yet allowed). */
  boardAsk?: { onOk: (() => void) | null };
  /** The question (`game.ask`) is answered in a window over the table (pick window, DecisionWindow). */
  pickAsk?: boolean;
}) {
  const { game, nameOf } = props;
  return (
    <aside className="action-rail">

      <LaterRail />

      {/* At the bottom, by your hand: what the game wants now, then the skips. */}
      {manaChoiceFor(game.ask, null) ? (
        <section className="ar-decision live">
          <div className="ar-ribbon">Decision</div>
          <h3>Which mana?</h3>
          <p>Choose by the card you're tapping.</p>
        </section>
      ) : game.ask?.kind === "scry" ? (
        <ScryPanel key={game.ask.id} ask={game.ask} game={game} />
      ) : game.ask && props.boardAsk ? (
        <BoardPanel title={game.ask.title || game.ask.message.split("\n")[0] || "Decision"} onOk={props.boardAsk.onOk} />
      ) : game.ask && props.pickAsk ? (
        <WindowPanel title={game.ask.title || game.ask.message.split("\n")[0] || "Decision"} onShow={props.onShowPick} />
      ) : game.ask ? (
        <AskPanel ask={game.ask} game={game} nameOf={nameOf} />
      ) : game.prompt && isAttackPrompt(game.prompt) && game.view?.active === game.view?.viewer ? (
        <AttackPanel game={game} nameOf={nameOf} />
      ) : (
        <PromptPanel game={game} nameOf={nameOf} onShowPick={props.onShowPick} />
      )}

      <section className="ar-autopass">
        <header>
          <h3>Auto-pass</h3>
          <span className="ar-sub">skip ahead</span>
        </header>
        {AUTO_PASS.map((a) => (
          <button
            key={a.mode}
            className={`ar-skip${game.autoPass === a.mode ? " on" : ""}`}
            aria-pressed={game.autoPass === a.mode}
            title={a.title + (game.autoPass === a.mode ? " Click again to cancel." : "")}
            onClick={() => game.setAutoPass(a.mode)}
          >
            {a.label}
            <Kbd action={a.key} />
          </button>
        ))}
      </section>

      {!!game.view?.rewind?.level && game.status === "playing" && <RewindPanel game={game} rewind={game.view.rewind} />}
    </aside>
  );
}

/** Forge's prompt: OK / Cancel with Forge's labels (OK passes priority; Cancel is often "End Turn"). */
function PromptPanel({ game, nameOf, onShowPick }: { game: LiveGame; nameOf: (id: string) => string; onShowPick?: () => void }) {
  const p = game.prompt;
  const point = usePointing(game, nameOf, [p?.message ?? ""]);
  useHotkeys({
    ok: () => (p?.ok.enabled ? game.ok() : false),
    cancel: () => (p?.cancel.enabled ? game.cancel() : false),
  });

  if (!p) {
    return (
      <section className="ar-decision">
        <div className="ar-ribbon">Decision</div>
        {game.status === "over" ? (
          <>
            <h3>Game over</h3>
            <p>Nothing more to decide in this game.</p>
          </>
        ) : game.status === "reconnecting" ? (
          <>
            <h3>Connection lost</h3>
            <p><Waiting text="Reconnecting…" /></p>
          </>
        ) : game.sent?.what === "answer" ? (
          <>
            <h3>Your answer</h3>
            <p><Waiting text={game.sent.slow ? "Waiting for the game server…" : "Sending it to the game…"} /></p>
          </>
        ) : (
          <>
            <h3>Waiting</h3>
            <p>Other players are deciding…</p>
          </>
        )}
      </section>
    );
  }
  if (p.pay) {
    // The pay window over the table has the buttons; the hotkeys above still work.
    return (
      <section className="ar-decision live">
        <div className="ar-ribbon">Decision</div>
        <h3>Pay mana</h3>
        <p>Paying for {p.pay.card || "this"}: Auto-pay, tap your sources, or cancel.</p>
      </section>
    );
  }
  const [title, ...rest] = p.message.split("\n");
  return (
    <section className="ar-decision live" {...point.section}>
      {point.arrows}
      <div className="ar-ribbon">Decision</div>
      <h3>{title ? point.text(title) : "Your move"}</h3>
      {rest.length > 0 && <p className="ar-prompt-text">{point.text(rest.join("\n"))}</p>}
      {!!game.view?.revealed?.length && <RevealedCards cards={game.view.revealed} />}
      {onShowPick && (
        <button className="ar-btn" onClick={onShowPick}>Show the cards to choose from</button>
      )}
      <div className="ar-actions">
        {p.ok.label && (
          <PressButton what="ok" sent={game.sent} className="ar-btn primary" disabled={!p.ok.enabled} onClick={game.ok} hint={<Kbd action="ok" />}>{p.ok.label}</PressButton>
        )}
        {p.cancel.label && (
          <PressButton what="cancel" sent={game.sent} className="ar-btn" disabled={!p.cancel.enabled} onClick={game.cancel} hint={<Kbd action="cancel" />}>{p.cancel.label}</PressButton>
        )}
      </div>
      <SlowServer game={game} />
    </section>
  );
}

/** Under the buttons, once the server has taken a good while over the one you pressed. */
function SlowServer({ game }: { game: LiveGame }) {
  return game.sent?.slow ? <p className="ar-sub"><Waiting text="Waiting for the game server…" className="" /></p> : null;
}

/**
 * Declaring attackers: how to (drag), who you're attacking so far, and why a creature couldn't
 * (Forge's reason, after its own instructions), with Forge's OK and Alpha strike / Call back.
 */
function AttackPanel({ game, nameOf }: { game: LiveGame; nameOf: (id: string) => string }) {
  const p = game.prompt!;
  const v = game.view!;
  useHotkeys({
    ok: () => (p.ok.enabled ? game.ok() : false),
    cancel: () => (p.cancel.enabled ? game.cancel() : false),
  });
  const reason = p.message.split("\n\n").slice(1).join("\n\n").trim();
  // Who's attacked, with how many: players first, then planeswalkers and battles.
  const counts = new Map<string, number>();
  for (const c of v.players[0].battlefield) {
    if (!c.attacking) continue;
    const pw = c.attackingCard !== undefined ? v.players.flatMap((x) => x.battlefield).find((x) => x.id === c.attackingCard) : undefined;
    const who = pw ? `${pw.name ?? "a planeswalker"} (${nameOf(c.attacking)})` : nameOf(c.attacking);
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  const alpha = p.cancel.label === "Alpha Strike";
  return (
    <section className="ar-decision live">
      <div className="ar-ribbon">Decision</div>
      <h3>Declare attackers</h3>
      <p className="ar-prompt-text">
        Drag from a creature to an opponent's board, or to their planeswalker, to attack it. Select several first (drag a box, or Shift-click) to send them together. Drag back onto your board to call them back.
      </p>
      {counts.size > 0 ? (
        <ul className="atk-summary">
          {[...counts].map(([who, n]) => (
            <li key={who}>⚔ {n} → <strong>{who}</strong></li>
          ))}
        </ul>
      ) : (
        <p className="ar-sub">No attackers yet. OK to skip combat{alpha ? `, or ${p.cancel.label} to attack with everything` : ""}.</p>
      )}
      {reason && <p className="ar-prompt-text atk-reason">{reason}</p>}
      <div className="ar-actions">
        <PressButton what="ok" sent={game.sent} className="ar-btn primary" disabled={!p.ok.enabled} onClick={game.ok} hint={<Kbd action="ok" />}>{counts.size ? "Attack" : "No attack"}</PressButton>
        {p.cancel.label && (
          <PressButton what="cancel" sent={game.sent} className="ar-btn" disabled={!p.cancel.enabled} onClick={game.cancel} hint={<Kbd action="cancel" />}>{p.cancel.label}</PressButton>
        )}
      </div>
      <SlowServer game={game} />
    </section>
  );
}

/** Cards Forge is showing you with this prompt (an opponent revealing their hand…). */
function RevealedCards({ cards }: { cards: CardView[] }) {
  const setPreview = usePreview();
  return (
    <ul className="ask-options" aria-label="Revealed cards">
      {cards.map((c) => (
        <li key={c.id}>
          <div className="ask-option info" onMouseEnter={() => setPreview({ card: c })} onMouseLeave={() => setPreview(null)}>
            {!c.hidden && cardImage(c.name, "small") && <CardImg tiny src={cardImage(c.name, "small")!} name={c.name ?? ""} alt="" />}
            <span>{c.hidden ? "Hidden card" : c.name}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A scry or surveil: the cards in a window (ScryDialog); here, a way back to it once hidden. */
function ScryPanel({ ask, game }: { ask: LiveAsk; game: LiveGame }) {
  const [open, setOpen] = useState(true);
  const kind = ask.away === "graveyard" ? "surveil" : "scry";
  const opts = ask.options ?? [];
  const cards = opts.map((o, i) => o.card ?? ({ id: o.cardId ?? -1 - i, name: o.label } as CardView));
  const index = (id: number) => cards.findIndex((c) => c.id === id);
  const answer = (top: number[], away: number[]) => game.answer(ask.id, [...top.map(index), -1, ...away.map(index)]);
  useHotkeys({ ok: () => (open ? false : setOpen(true)) });
  return (
    <section className="ar-decision live ar-ask">
      <div className="ar-ribbon">Decision</div>
      <h3>{ask.title || (kind === "scry" ? "Scry" : "Surveil")}</h3>
      <p className="ar-sub">{kind === "scry" ? "Keep each card on top, or put it on the bottom." : "Keep each card on top, or put it into your graveyard."}</p>
      <div className="ar-actions">
        <button className="ar-btn primary" onClick={() => setOpen(true)}>
          Show the cards
          <Kbd action="ok" />
        </button>
      </div>
      {open && <ScryDialog forced kind={kind} cards={cards} onClose={() => setOpen(false)} onApply={answer} />}
    </section>
  );
}

/** The question is answered on the table (sacrifice, discard): the bar over it has the buttons. */
function BoardPanel({ title, onOk }: { title: string; onOk: (() => void) | null }) {
  useHotkeys({ ok: () => (onOk ? onOk() : false) });
  return (
    <section className="ar-decision live">
      <div className="ar-ribbon">Decision</div>
      <h3>{title}</h3>
      <p>Click the glowing cards on the table, then OK in the bar above it.</p>
    </section>
  );
}

/** The question is in a window over the table; once you've hidden it, a button brings it back. */
function WindowPanel({ title, onShow }: { title: string; onShow?: () => void }) {
  useHotkeys({ ok: () => (onShow ? onShow() : false) });
  return (
    <section className="ar-decision live">
      <div className="ar-ribbon">Decision</div>
      <h3>{title}</h3>
      {onShow ? (
        <div className="ar-actions">
          <button className="ar-btn primary" onClick={onShow}>
            Show the question
            <Kbd action="ok" />
          </button>
        </div>
      ) : (
        <p>Answer in the window over the table.</p>
      )}
    </section>
  );
}

/** A yes/no question (and anything without a window): pick min..max of the options, or type an answer. */
function AskPanel({ ask, game, nameOf }: { ask: LiveAsk; game: LiveGame; nameOf: (id: string) => string }) {
  const [picked, setPicked] = useState<number[]>(ask.selected ?? []);
  const [text, setText] = useState(ask.initial ?? "");
  const setPreview = usePreview();
  useEffect(() => {
    setPicked(ask.selected ?? []);
    setText(ask.initial ?? "");
  }, [ask.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const info = ask.kind === "info";
  const single = ask.max === 1;
  const ok = ask.kind === "text" || (picked.length >= ask.min && picked.length <= ask.max);
  const toggle = (i: number) => {
    if (info) return;
    if (single) {
      // One choice: clicking it answers right away.
      game.answer(ask.id, [i]);
      return;
    }
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < ask.max ? [...p, i] : p));
  };
  const viewer = game.view?.viewer ?? "";
  const point = usePointing(game, nameOf, [ask.title ?? "", ask.message, ...(ask.options ?? []).map((o) => o.label)]);
  useHotkeys({
    ok: () => {
      if (info) game.answer(ask.id, []);
      else if (ask.kind !== "text" && !single && ok) game.answer(ask.id, picked);
      else return false;
    },
    cancel: () => (ask.min === 0 && !info && ask.kind !== "text" ? game.answer(ask.id, []) : false),
  });

  return (
    <section className="ar-decision live ar-ask" {...point.section}>
      {point.arrows}
      <div className="ar-ribbon">Decision</div>
      <h3>{point.text(ask.title || ask.message.split("\n")[0] || "Choose")}</h3>
      {ask.title && <p className="ar-prompt-text">{point.text(ask.message)}</p>}
      {!ask.title && ask.message.includes("\n") && <p className="ar-prompt-text">{point.text(ask.message.split("\n").slice(1).join("\n"))}</p>}
      {ask.kind === "text" ? (
        <form
          className="ar-actions"
          onSubmit={(e) => {
            e.preventDefault();
            game.answer(ask.id, null, text);
          }}
        >
          <input autoFocus inputMode={ask.numeric ? "numeric" : undefined} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="ar-btn primary" type="submit">OK</button>
        </form>
      ) : (
        <>
          {!single && !info && (
            <p className="ar-sub">
              Choose {ask.min === ask.max ? ask.min : ask.min ? `${ask.min} to ${ask.max}` : `up to ${ask.max}`} · {picked.length} chosen
            </p>
          )}
          <ul className="ask-options">
            {ask.options?.map((o, i) => {
              const img = o.card && !o.card.hidden ? cardImage(o.card.name, "small") : undefined;
              return (
                <li key={i}>
                  <button
                    className={`ask-option${picked.includes(i) ? " on" : ""}${info ? " info" : ""}`}
                    aria-pressed={!single ? picked.includes(i) : undefined}
                    onClick={() => toggle(i)}
                    onMouseEnter={() => o.card && setPreview(previewFor(o.card, viewer, nameOf))}
                    onMouseLeave={() => setPreview(null)}
                  >
                    {img && <CardImg tiny src={img} name={o.label} alt="" />}
                    <span>{point.text(o.label)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="ar-actions">
            {info && (
              <button className="ar-btn primary" onClick={() => game.answer(ask.id, [])}>
                OK
                <Kbd action="ok" />
              </button>
            )}
            {!single && !info && (
              <button className="ar-btn primary" disabled={!ok} onClick={() => game.answer(ask.id, picked)}>
                Confirm
                <Kbd action="ok" />
              </button>
            )}
            {ask.min === 0 && !info && (
              <button className="ar-btn" onClick={() => game.answer(ask.id, [])}>
                {single ? "Cancel" : "Choose none"}
                <Kbd action="cancel" />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** A card in the game by id: on the table, on the stack, or shown with the current prompt. */
function cardIn(v: GameView | null | undefined, id: number): CardView | undefined {
  if (!v) return undefined;
  for (const p of v.players) for (const z of [p.hand, p.battlefield, p.graveyard, p.exile, p.command]) {
    const c = z.find((x) => x.id === id);
    if (c) return c;
  }
  return (
    v.stack.find((s) => s.card?.id === id)?.card ??
    v.selection?.offer?.find((c) => c.id === id) ??
    v.selection?.seen?.find((c) => c.id === id) ??
    v.revealed?.find((c) => c.id === id)
  );
}

/**
 * Forge names cards in its prompts as "Name (id)". This shows them by name alone, and points at
 * them: hovering the decision draws a line to every card it names, hovering one name draws a line
 * to that card and shows it.
 */
function usePointing(game: LiveGame, nameOf: (id: string) => string, texts: string[]) {
  const setPreview = usePreview();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [over, setOver] = useState(false);
  const [one, setOne] = useState<number | null>(null);
  const v = game.view;
  const cardOf = (id: number) => cardIn(v, id);
  const all = [...new Set(texts.flatMap((t) => logParts(t, (id) => cardOf(id)?.name).flatMap((p) => (typeof p === "string" ? [] : [p.id]))))];
  const ids = one !== null ? [one] : over ? all : [];
  const text = (t: string) =>
    logParts(t, (id) => cardOf(id)?.name).map((part, k) =>
      typeof part === "string" ? part : (
        <span
          key={k}
          className="log-card"
          onMouseEnter={() => {
            setOne(part.id);
            const c = cardOf(part.id);
            if (c) setPreview(previewFor(c, v?.viewer ?? "", nameOf));
          }}
          onMouseLeave={() => {
            setOne(null);
            setPreview(null);
          }}
        >
          {part.name}
        </span>
      ),
    );
  return {
    section: { ref: setEl, onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) },
    arrows: <PointArrows from={el} ids={ids} color={v?.players[0]?.color ?? "#e0b04a"} />,
    text,
  };
}
