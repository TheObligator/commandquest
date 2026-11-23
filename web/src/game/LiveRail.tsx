// Left rail for a live game: then at the bottom Forge's current
// prompt (with Forge's own button labels) or question, and the auto-pass skips.
import { useEffect, useState } from "react";
import { AUTO_PASS } from "./ActionRail";
import { isAttackPrompt } from "./AttackArrows";
import { manaChoiceFor } from "./manaOptions";
import { RewindPanel } from "./RewindPanel";
import { ScryDialog } from "./ScryDialog";
import { Kbd, useHotkeys } from "./useHotkeys";
import { cardImage, previewFor, usePreview, type Preview } from "./cards";
import { logParts } from "./logText";
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
  /** The question (`game.ask`) is answered in the pick window. */
  pickAsk?: boolean;
}) {
  const { game, nameOf } = props;
  return (
    <aside className="action-rail">

      {/* At the bottom, by your hand: what the game wants now, then the skips. */}
      {manaChoiceFor(game.ask, null) ? (
        <section className="ar-decision live">
          <div className="ar-ribbon">Decision</div>
          <h3>Which mana?</h3>
          <p>Choose by the card you're tapping.</p>
        </section>
      ) : game.ask?.kind === "order" ? (
        <OrderPanel key={game.ask.id} ask={game.ask} game={game} />
      ) : game.ask?.kind === "scry" ? (
        <ScryPanel key={game.ask.id} ask={game.ask} game={game} />
      ) : game.ask?.kind === "arrange" ? (
        <ArrangePanel key={game.ask.id} ask={game.ask} game={game} />
      ) : game.ask?.kind === "distribute" ? (
        <DistributePanel key={game.ask.id} ask={game.ask} game={game} />
      ) : game.ask && props.pickAsk ? (
        <section className="ar-decision live">
          <div className="ar-ribbon">Decision</div>
          <h3>{game.ask.title || game.ask.message.split("\n")[0] || "Choose cards"}</h3>
          {props.onShowPick ? (
            <button className="ar-btn" onClick={props.onShowPick}>Show the cards to choose from</button>
          ) : (
            <p>Choose in the window over the table.</p>
          )}
        </section>
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
        <h3>{game.status === "over" ? "Game over" : "Waiting"}</h3>
        <p>{game.status === "over" ? "Nothing more to decide in this game." : "Other players are deciding…"}</p>
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
          <button className="ar-btn primary" disabled={!p.ok.enabled} onClick={game.ok}>
            {p.ok.label}
            <Kbd action="ok" />
          </button>
        )}
        {p.cancel.label && (
          <button className="ar-btn" disabled={!p.cancel.enabled} onClick={game.cancel}>
            {p.cancel.label}
            <Kbd action="cancel" />
          </button>
        )}
      </div>
    </section>
  );
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
        <button className="ar-btn primary" disabled={!p.ok.enabled} onClick={game.ok}>
          {counts.size ? "Attack" : "No attack"}
          <Kbd action="ok" />
        </button>
        {p.cancel.label && (
          <button className="ar-btn" disabled={!p.cancel.enabled} onClick={game.cancel}>
            {p.cancel.label}
            <Kbd action="cancel" />
          </button>
        )}
      </div>
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
            {!c.hidden && c.name && <img src={cardImage(c.name, "small")} alt="" />}
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

/** One option's picture and name, with its preview on hover. */
function OptionLabel({ o }: { o: LiveAsk["options"] extends (infer T)[] | undefined ? T : never }) {
  const setPreview = usePreview();
  const img = o.card && !o.card.hidden && o.card.name ? cardImage(o.card.name, "small") : undefined;
  return (
    <span className="ask-label" onMouseEnter={() => o.card && setPreview({ card: o.card })} onMouseLeave={() => setPreview(null)}>
      {img && <img src={img} alt="" />}
      <span>{o.label}</span>
    </span>
  );
}

/** Put things in order (cards on top of your library, triggers…); some may be left out when Forge allows. */
function OrderPanel({ ask, game }: { ask: LiveAsk; game: LiveGame }) {
  const all = ask.options ?? [];
  const [order, setOrder] = useState<number[]>(() => all.map((_, i) => i));
  const [out, setOut] = useState<number[]>(() => (ask.max < all.length ? all.map((_, i) => i).slice(ask.max) : []));
  const kept = order.filter((i) => !out.includes(i));
  const ok = kept.length >= ask.min && kept.length <= ask.max;
  const canLeaveOut = ask.min < all.length;
  const move = (pos: number, by: number) =>
    setOrder((o) => {
      const n = [...o];
      const to = pos + by;
      if (to < 0 || to >= n.length) return o;
      [n[pos], n[to]] = [n[to], n[pos]];
      return n;
    });
  const done = () => ok && game.answer(ask.id, kept);
  useHotkeys({ ok: () => (ok ? done() : false) });
  return (
    <section className="ar-decision live ar-ask">
      <div className="ar-ribbon">Decision</div>
      <h3>{ask.message || "Put these in order"}</h3>
      <p className="ar-sub">
        {ask.top ? `First: ${ask.top}. ` : ""}Use ↑ ↓ to reorder{canLeaveOut ? `; keep ${ask.min === ask.max ? ask.min : `${ask.min} to ${ask.max}`}` : ""}.
      </p>
      <ol className="ask-options order-list">
        {order.map((i, pos) => (
          <li key={i} className={out.includes(i) ? "left-out" : undefined}>
            <span className="ask-option info">
              <OptionLabel o={all[i]} />
            </span>
            <span className="order-btns">
              <button type="button" aria-label="Move up" disabled={pos === 0} onClick={() => move(pos, -1)}>↑</button>
              <button type="button" aria-label="Move down" disabled={pos === order.length - 1} onClick={() => move(pos, 1)}>↓</button>
              {canLeaveOut && (
                <button type="button" aria-pressed={!out.includes(i)} title={out.includes(i) ? "Keep it" : "Leave it out"} onClick={() => setOut((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]))}>
                  {out.includes(i) ? "+" : "−"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="ar-actions">
        <button className="ar-btn primary" disabled={!ok} onClick={done}>
          Done
          <Kbd action="ok" />
        </button>
      </div>
    </section>
  );
}

/** Scry and the like: each card to the top or the bottom of your library, in order. */
function ArrangePanel({ ask, game }: { ask: LiveAsk; game: LiveGame }) {
  const all = ask.options ?? [];
  const [top, setTop] = useState<number[]>(() => (ask.toTop !== false ? all.map((_, i) => i) : []));
  const [bottom, setBottom] = useState<number[]>(() => (ask.toTop !== false ? [] : all.map((_, i) => i)));
  const move = (list: number[], set: (v: number[]) => void, pos: number, by: number) => {
    const to = pos + by;
    if (to < 0 || to >= list.length) return;
    const n = [...list];
    [n[pos], n[to]] = [n[to], n[pos]];
    set(n);
  };
  const flip = (i: number, toBottom: boolean) => {
    if (toBottom) {
      setTop((t) => t.filter((x) => x !== i));
      setBottom((b) => [...b, i]);
    } else {
      setBottom((b) => b.filter((x) => x !== i));
      setTop((t) => [...t, i]);
    }
  };
  const done = () => game.answer(ask.id, [...top, -1, ...bottom]);
  useHotkeys({ ok: () => done() });
  const rows = (list: number[], set: (v: number[]) => void, onBottom: boolean) =>
    list.map((i, pos) => (
      <li key={i}>
        <span className="ask-option info">
          <OptionLabel o={all[i]} />
        </span>
        <span className="order-btns">
          {list.length > 1 && (
            <>
              <button type="button" aria-label="Move up" disabled={pos === 0} onClick={() => move(list, set, pos, -1)}>↑</button>
              <button type="button" aria-label="Move down" disabled={pos === list.length - 1} onClick={() => move(list, set, pos, 1)}>↓</button>
            </>
          )}
          {(onBottom ? ask.toTop !== false : ask.toBottom !== false) && (
            <button type="button" className="flip" title={onBottom ? "Put it on top" : "Put it on the bottom"} onClick={() => flip(i, !onBottom)}>
              {onBottom ? "Top" : "Bottom"}
            </button>
          )}
        </span>
      </li>
    ));
  return (
    <section className="ar-decision live ar-ask">
      <div className="ar-ribbon">Decision</div>
      <h3>{ask.message || "Top or bottom?"}</h3>
      <p className="ar-sub">Top of library (first = top)</p>
      <ol className="ask-options order-list">{top.length ? rows(top, setTop, false) : <li className="ar-sub">None</li>}</ol>
      {(ask.toBottom !== false || bottom.length > 0) && (
        <>
          <p className="ar-sub">Bottom of library (last = bottom)</p>
          <ol className="ask-options order-list">{bottom.length ? rows(bottom, setBottom, true) : <li className="ar-sub">None</li>}</ol>
        </>
      )}
      <div className="ar-actions">
        <button className="ar-btn primary" onClick={done}>
          Done
          <Kbd action="ok" />
        </button>
      </div>
    </section>
  );
}

/** Divide an amount (damage, counters…) among targets: − and + for each, adding up to the total. */
function DistributePanel({ ask, game }: { ask: LiveAsk; game: LiveGame }) {
  const all = ask.options ?? [];
  const total = ask.amount ?? 0;
  const low = ask.atLeastOne ? 1 : 0;
  const [n, setN] = useState<number[]>(() => {
    const start = all.map(() => low);
    if (start.length) start[0] += Math.max(0, total - low * all.length);
    return start;
  });
  const sum = n.reduce((a, b) => a + b, 0);
  const ok = sum === total && n.every((x) => x >= low);
  const set = (i: number, by: number) => setN((v) => v.map((x, j) => (j === i ? Math.max(low, Math.min(total, x + by)) : x)));
  const done = () => ok && game.answer(ask.id, n);
  useHotkeys({ ok: () => (ok ? done() : false) });
  return (
    <section className="ar-decision live ar-ask">
      <div className="ar-ribbon">Decision</div>
      <h3>{ask.message || `Divide ${total}`}</h3>
      <p className="ar-sub">{sum} of {total} assigned{ask.atLeastOne ? " · at least 1 each" : ""}</p>
      <ul className="ask-options order-list">
        {all.map((o, i) => (
          <li key={i}>
            <span className="ask-option info">
              <OptionLabel o={o} />
            </span>
            <span className="order-btns">
              <button type="button" aria-label="Less" disabled={n[i] <= low} onClick={() => set(i, -1)}>−</button>
              <b className="dist-n">{n[i]}</b>
              <button type="button" aria-label="More" disabled={sum >= total} onClick={() => set(i, 1)}>+</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="ar-actions">
        <button className="ar-btn primary" disabled={!ok} onClick={done}>
          Done
          <Kbd action="ok" />
        </button>
      </div>
    </section>
  );
}

/** A question that blocks the game: pick min..max of the options, or type an answer. */
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
                    {img && <img src={img} alt="" />}
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
