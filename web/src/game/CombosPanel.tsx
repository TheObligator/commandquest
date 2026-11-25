// Combos (docs/combos.md): the rail's section to record and run them, and a combo's window.
import { useEffect, useRef, useState } from "react";
import { gainsText, groupSteps, newCombo, parseTimes, MAX_LOOPS, type Combo, type CombosView } from "./combos";

export interface ComboActions {
  record: () => void;
  keep: () => void;
  discard: () => void;
  run: (id: number, times: number) => void;
  stop: () => void;
  rename: (id: number, name: string) => void;
  remove: (id: number) => void;
}

export function CombosPanel({ combos, actions, canRecord }: { combos?: CombosView; actions: ComboActions; canRecord: boolean }) {
  const list = combos?.list ?? [];
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
          <button className="btn small ghost" disabled={!canRecord} title={canRecord ? "Record: play it once by hand, then press Stop" : "Start recording when you have priority"} onClick={actions.record}>
            <i className="rec-dot" aria-hidden /> Record
          </button>
        )}
      </header>
      {combos?.recording && (
        <div className="combo-rec">
          <div className="combo-row">
            <strong>Recording…</strong>
            <span>
              <button
                className="btn small"
                disabled={!combos.recording.length}
                title="Stop, and keep it. You need priority."
                onClick={() => {
                  before.current = list;
                  actions.keep();
                }}
              >
                ■ Stop
              </button>
              <button className="btn small ghost" aria-label="Discard the recording" title="Discard the recording" onClick={actions.discard}>×</button>
            </span>
          </div>
          <Steps steps={combos.recording} />
          {!combos.recording.length && <p>Do it once by hand.</p>}
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
      {list.length > 0 && !running && !combos?.recording && (
        <ul>
          {list.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <span>{gainsText(c)}</span>
              </div>
              <button className="btn small" onClick={() => setOpen(c.id)}>Run…</button>
            </li>
          ))}
        </ul>
      )}
      {shown && !running && <ComboWindow key={shown.id} combo={shown} actions={actions} onClose={() => setOpen(null)} />}
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

function ComboWindow({ combo, actions, onClose }: { combo: Combo; actions: ComboActions; onClose: () => void }) {
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
