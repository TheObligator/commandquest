// Left rail for a live game: then at the bottom Forge's current
// prompt (with Forge's own button labels) or question, and the auto-pass skips.
import { useEffect, useState } from "react";
import { AUTO_PASS } from "./ActionRail";
import { Kbd, useHotkeys } from "./useHotkeys";
import { cardImage, previewFor, usePreview, type Preview } from "./cards";
import type { LiveAsk, LiveGame } from "./useLiveGame";
import type { CardView } from "./view";

export function LiveRail(props: {
  game: LiveGame;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  preview: Preview | null;
}) {
  const { game, nameOf } = props;
  return (
    <aside className="action-rail">

      {/* At the bottom, by your hand: what the game wants now, then the skips. */}
      {game.ask ? <AskPanel ask={game.ask} game={game} nameOf={nameOf} /> : <PromptPanel game={game} />}

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
    </aside>
  );
}

/** Forge's prompt: OK / Cancel with Forge's labels (OK passes priority; Cancel is often "End Turn"). */
function PromptPanel({ game }: { game: LiveGame }) {
  const p = game.prompt;
  useHotkeys({
    ok: () => (p?.ok.enabled ? game.ok() : false),
    cancel: () => (p?.cancel.enabled ? game.cancel() : false),
  });

  if (!p) {
    return (
      <section className="ar-decision">
        <div className="ar-ribbon">Decision</div>
        <h3>Waiting</h3>
        <p>Other players are deciding…</p>
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
    <section className="ar-decision live">
      <div className="ar-ribbon">Decision</div>
      <h3>{title || "Your move"}</h3>
      {rest.length > 0 && <p className="ar-prompt-text">{rest.join("\n")}</p>}
      {!!game.view?.revealed?.length && <RevealedCards cards={game.view.revealed} />}
      {!!game.view?.selection?.offer?.length && (
        <OfferedCards cards={game.view.selection.offer} chosen={game.view.selection.chosen} onPick={game.clickCard} />
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

/**
 * Cards the prompt offers from places the table doesn't show (your library while you search it…):
 * click one to choose it, like a card on the table.
 */
function OfferedCards({ cards, chosen, onPick }: { cards: CardView[]; chosen: (number | string)[]; onPick: (id: number) => void }) {
  const setPreview = usePreview();
  return (
    <ul className="ask-options" aria-label="Cards to choose from">
      {cards.map((c) => (
        <li key={c.id}>
          <button
            className={`ask-option${chosen.includes(c.id) ? " on" : ""}`}
            aria-pressed={chosen.includes(c.id)}
            onClick={() => onPick(c.id)}
            onMouseEnter={() => setPreview({ card: c })}
            onMouseLeave={() => setPreview(null)}
          >
            {!c.hidden && c.name && <img src={cardImage(c.name, "small")} alt="" />}
            <span>{c.hidden ? "Hidden card" : c.name}</span>
          </button>
        </li>
      ))}
    </ul>
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
  useHotkeys({
    ok: () => {
      if (info) game.answer(ask.id, []);
      else if (ask.kind !== "text" && !single && ok) game.answer(ask.id, picked);
      else return false;
    },
    cancel: () => (ask.min === 0 && !info && ask.kind !== "text" ? game.answer(ask.id, []) : false),
  });

  return (
    <section className="ar-decision live ar-ask">
      <div className="ar-ribbon">Decision</div>
      <h3>{ask.title || ask.message.split("\n")[0] || "Choose"}</h3>
      {ask.title && <p className="ar-prompt-text">{ask.message}</p>}
      {!ask.title && ask.message.includes("\n") && <p className="ar-prompt-text">{ask.message.split("\n").slice(1).join("\n")}</p>}
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
                    <span>{o.label}</span>
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
