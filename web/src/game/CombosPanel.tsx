// Combos (docs/combos.md): the rail's section to record and run them, and a combo's window.
import { useEffect, useRef, useState } from "react";
import { ComboText } from "../components/DeckCombos";
import { gainsText, groupSteps, newCombo, parseTimes, MAX_LOOPS, type Combo, type CombosView } from "./combos";
import { comboCards, comboUrl, guideProgress, guideSteps, isReady, resultsText, showsResult, type MyZones, type SpellbookCombo } from "./spellbook";

/** Offered at once; the rest wait until these are recorded or put away. */
const OFFERS = 3;

export interface ComboActions {
  record: () => void;
  keep: (name?: string, ref?: string) => void;
  discard: () => void;
  run: (id: number, times: number) => void;
  stop: () => void;
  rename: (id: number, name: string) => void;
  remove: (id: number) => void;
}

/** `known`: your deck's combos from Commander Spellbook; `mine`: your cards, to see which are ready. */
export function CombosPanel({ combos, actions, canRecord, known = [], mine }: { combos?: CombosView; actions: ComboActions; canRecord: boolean; known?: SpellbookCombo[]; mine?: MyZones }) {
  const list = combos?.list ?? [];
  const ready = mine ? known.filter((k) => isReady(k, mine)) : [];
  const readyIds = new Set(ready.map((k) => k.id));
  const [away, setAway] = useState<ReadonlySet<string>>(new Set());
  const offers = ready.filter((k) => !away.has(k.id) && !list.some((c) => c.ref === k.id)).slice(0, OFFERS);
  const [look, setLook] = useState<SpellbookCombo | null>(null);
  // The known combo being recorded, with the steps you ticked or unticked yourself.
  const [guide, setGuide] = useState<SpellbookCombo | null>(null);
  const recordingNow = !!combos?.recording;
  const wasRecording = useRef(false);
  useEffect(() => {
    if (wasRecording.current && !recordingNow) setGuide(null);
    wasRecording.current = recordingNow;
  }, [recordingNow]);
  const [open, setOpen] = useState<number | null>(null);
  // Stop recording: the new combo's window opens when the server has it.
  const before = useRef<Combo[] | null>(null);
  useEffect(() => {
    const made = before.current && newCombo(before.current, list);
    if (made) {
      before.current = null;
      setOpen(made.id);
    }
  }, [list]);
  const shown = list.find((c) => c.id === open);
  const running = combos?.running;
  return (
    <section className="ar-combos">
      <header>
        <h3>Combos</h3>
        {!combos?.recording && !running && (
          <button className="btn small ghost" disabled={!canRecord} title={canRecord ? "Record: play it once by hand, then press Stop" : "Start recording when you have priority"} onClick={() => (setGuide(null), actions.record())}>
            <i className="rec-dot" aria-hidden /> Record
          </button>
        )}
      </header>
      {combos?.recording && (
        <div className="combo-rec">
          <div className="combo-row">
            <strong>{guide ? guide.results[0] ?? "Recording…" : "Recording…"}</strong>
            <span>
              <button
                className="btn small"
                disabled={!combos.recording.length}
                title="Stop, and keep it. You need priority."
                onClick={() => {
                  before.current = list;
                  actions.keep(guide ? comboCards(guide).slice(0, 60) : undefined, guide?.id);
                }}
              >
                ■ Stop
              </button>
              <button className="btn small ghost" aria-label="Discard the recording" title="Discard the recording" onClick={actions.discard}>×</button>
            </span>
          </div>
          {guide ? <Guide key={guide.id} combo={guide} recorded={combos.recording} /> : <Steps steps={combos.recording} />}
          {!guide && !combos.recording.length && <p>Do it once by hand.</p>}
        </div>
      )}
      {running && (
        <div className="combo-run" role="status">
          <div className="combo-row">
            <strong>{list.find((c) => c.id === running.id)?.name ?? "Combo"}</strong>
            <button className="btn small" onClick={actions.stop}>■ Stop</button>
          </div>
          {running.times !== undefined && <progress max={running.times} value={running.loop} />}
          <p>Loop {running.loop}{running.times !== undefined ? ` of ${running.times}` : ""}</p>
        </div>
      )}
      {!combos?.recording && !running && offers.length > 0 && (
        <ul className="combo-offers">
          {offers.map((k) => (
            <li key={k.id}>
              <div>
                <strong title={comboCards(k)}>{comboCards(k)}</strong>
                <span>{resultsText(k.results)}{k.mana ? `, needs ${k.mana}` : ""}</span>
              </div>
              <button className="btn small ghost" onClick={() => setLook(k)}>Show</button>
              <button className="btn small ghost" aria-label={`Don't offer ${comboCards(k)}`} title="Don't offer this one again" onClick={() => setAway(new Set([...away, k.id]))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && !running && !combos?.recording && (
        <ul>
          {list.map((c) => (
            <li key={c.id} className={c.ref && readyIds.has(c.ref) ? "ready" : undefined}>
              <div>
                <strong>{c.name}</strong>
                <span>{gainsText(c)}</span>
              </div>
              <button className="btn small" onClick={() => setOpen(c.id)}>Run…</button>
            </li>
          ))}
        </ul>
      )}
      {shown && !running && <ComboWindow key={shown.id} combo={shown} known={known.find((k) => k.id === shown.ref)} actions={actions} onClose={() => setOpen(null)} />}
      {look && !running && !combos?.recording && (
        <KnownWindow
          key={look.id}
          combo={look}
          canRecord={canRecord}
          onRecord={() => {
            setGuide(look);
            setLook(null);
            actions.record();
          }}
          onClose={() => setLook(null)}
        />
      )}
    </section>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol>
      {groupSteps(steps).map((s, i) => (
        <li key={i}>{s.text}{s.n > 1 ? ` ×${s.n}` : ""}</li>
      ))}
    </ol>
  );
}

/** The known combo's steps while it's recorded, ticked off as they're done (a guess: click one to tick it yourself). */
function Guide({ combo, recorded }: { combo: SpellbookCombo; recorded: string[] }) {
  const steps = guideSteps(combo.steps);
  const [own, setOwn] = useState<Record<number, boolean>>({});
  const done = guideProgress(steps, recorded, combo.cards.map((c) => c.name));
  const ticked = (i: number) => own[i] ?? i < done;
  const now = steps.findIndex((_, i) => !ticked(i));
  return (
    <>
      <ul className="combo-guide">
        {steps.map((s, i) => (
          <li key={i} className={ticked(i) ? "done" : i === now ? "now" : undefined}>
            <button aria-pressed={ticked(i)} onClick={() => setOwn({ ...own, [i]: !ticked(i) })}>
              <i aria-hidden>{ticked(i) ? "✓" : i === now ? "▸" : ""}</i>
              <span>{s}</span>
            </button>
          </li>
        ))}
      </ul>
      <p>{now < 0 ? "That's once around: press Stop." : "Do each step by hand, once."} <a href={comboUrl(combo.id)} target="_blank" rel="noreferrer">Commander Spellbook</a></p>
    </>
  );
}

/** A known combo that's ready: what it does, and recording it. */
function KnownWindow({ combo, canRecord, onRecord, onClose }: { combo: SpellbookCombo; canRecord: boolean; onRecord: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="decision-window combo-window" aria-label={comboCards(combo)} onCancel={(e) => (e.preventDefault(), onClose())}>
      <button className="dialog-close" aria-label="Close" onClick={onClose}>×</button>
      <div className="dw-head"><h3>{comboCards(combo)}</h3></div>
      <div className="dw-body">
        <div className="combo-gains"><strong>{resultsText(combo.results)}</strong></div>
        {combo.needs.length > 0 && <p className="dw-sub">It also needs: {combo.needs.join(", ")}.</p>}
        <ComboText combo={combo} />
        <p className="dw-sub">{canRecord ? "Record it by doing the steps once by hand. Then it can run by itself." : "You can record it when you have priority."}</p>
        <div className="dw-btns">
          <button className="btn small ghost" onClick={onClose}>Not now</button>
          <button className="btn small" disabled={!canRecord} onClick={onRecord}>Record it</button>
        </div>
      </div>
    </dialog>
  );
}

/** What was recorded, against what the combo is meant to do. */
function Checks({ combo, known }: { combo: Combo; known: SpellbookCombo }) {
  return (
    <ul className="combo-checks">
      <li className={combo.loops ? "yes" : "no"}>{combo.loops ? "Back where it started" : "Not back where it started"}</li>
      {known.results.map((r) => {
        const ok = showsResult(r, combo.gains);
        return <li key={r} className={ok === null ? "unknown" : ok ? "yes" : "no"}>{r}{ok === null ? ": can't be checked" : ok ? "" : ": not seen"}</li>;
      })}
    </ul>
  );
}

function ComboWindow({ combo, known, actions, onClose }: { combo: Combo; known?: SpellbookCombo; actions: ComboActions; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(combo.name);
  const [times, setTimes] = useState("10");
  const [until, setUntil] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const n = parseTimes(times);
  const rename = () => name.trim() && name.trim() !== combo.name && actions.rename(combo.id, name.trim());
  const ok = !combo.loops || until || n !== null;
  const run = () => {
    if (!ok) return;
    rename();
    actions.run(combo.id, !combo.loops ? 1 : until ? 0 : n!);
    onClose();
  };
  return (
    <dialog ref={ref} className="decision-window combo-window" aria-label={combo.name} onCancel={(e) => (e.preventDefault(), rename(), onClose())}>
      <button className="dialog-close" aria-label="Close" onClick={() => (rename(), onClose())}>×</button>
      <form className="dw-body" onSubmit={(e) => (e.preventDefault(), run())}>
        <div className="dw-text">
          <input aria-label="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Steps steps={combo.steps} />
        <div className="combo-gains">Each time: <strong>{gainsText(combo)}</strong></div>
        {known && <Checks combo={combo} known={known} />}
        {combo.loops ? (
          <>
            <label className={`dw-opt${until ? "" : " on"}`}>
              <input type="radio" name="times" checked={!until} onChange={() => setUntil(false)} />
              <span>
                Run <input className="num" inputMode="numeric" aria-label="How many times" value={times} onFocus={(e) => (setUntil(false), e.target.select())} onChange={(e) => setTimes(e.target.value)} /> times
              </span>
            </label>
            <label className={`dw-opt${until ? " on" : ""}`}>
              <input type="radio" name="times" checked={until} onChange={() => setUntil(true)} />
              <span>Until I press Stop (or {MAX_LOOPS} times)</span>
            </label>
            {!until && n === null && <p className="dw-sub">From 1 to {MAX_LOOPS}.</p>}
          </>
        ) : (
          <p className="dw-sub">It doesn't end where it started, so it runs once at a time.</p>
        )}
        <div className="dw-btns">
          <button type="button" className="btn small ghost danger" onClick={() => (actions.remove(combo.id), onClose())}>Delete</button>
          <button type="button" className="btn small ghost" onClick={() => (rename(), onClose())}>Not now</button>
          <button className="btn small" disabled={!ok}>{combo.loops ? "Run" : "Run once"}</button>
        </div>
      </form>
    </dialog>
  );
}
