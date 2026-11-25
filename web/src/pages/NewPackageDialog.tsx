// The "New package" popup: name it, say what it's for, and it opens in the editor.
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { MAX_PACKAGE_NAME, MAX_PACKAGE_NOTE } from "../../convex/model/packageRules";
import { errorMessage } from "../app/errors";
import { navigate } from "../app/router";
import { closeOnBackdrop } from "../carddetails";
import { BusyLabel } from "../components/Spinner";

export function NewPackageDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const createPackage = useMutation(api.packages.create);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const id = await createPackage({ name, note, cards: [] });
      ref.current?.close();
      navigate(`/decks/packages/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="new-deck folder-dialog" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <form onSubmit={(e) => void submit(e)}>
        <h3>New package</h3>
        <p className="muted small format-hint">A set of cards to add to your decks. Each deck is offered the cards that fit its commander's colors.</p>
        <label>
          Name
          <input value={name} maxLength={MAX_PACKAGE_NAME} required autoFocus placeholder="e.g. Ramp staples" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Note <small>optional</small></span>
          <input value={note} maxLength={MAX_PACKAGE_NOTE} placeholder="e.g. Rocks and land ramp" onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="form-error">{error}</p>
        <div className="actions new-deck-actions">
          <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn" disabled={busy || !name.trim()}><BusyLabel busy={busy} working="Creating…">Create package</BusyLabel></button>
        </div>
      </form>
    </dialog>
  );
}
