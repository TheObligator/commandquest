// The "+ New deck" popup: name the deck, pick its format and commander, and choose the folder it
// goes in (or make a new folder). Creating saves the deck and opens it in the editor.
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DeckCard } from "../../convex/model/deckRules";
import { MAX_FOLDER_NAME } from "../../convex/model/folderRules";
import { errorMessage } from "../app/errors";
import { navigate } from "../app/router";
import { closeOnBackdrop } from "../carddetails";
import { useCardSupport } from "../cardsupport";
import { CardImg } from "../components/CardImg";
import { BusyLabel, ScryfallWaiting } from "../components/Spinner";
import { FlipButton, useFlips } from "../components/FlipButton";
import { CARD_LIST, FORMATS, formatLabel, hasCommander } from "../deckFormats";
import * as scry from "../scryfall";
import { printingPref } from "../usePrintingPref";
import { canCommand } from "./EditorSearch";

const NEW_FOLDER = "__new__";
const MAX_RESULTS = 24;

/** `list`: make a card list (the format is settled). */
export function NewDeckDialog({ folderId, list, onClose }: { folderId?: Id<"deckFolders">; list?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const folders = useQuery(api.folders.list);
  const createDeck = useMutation(api.decks.create);
  const createFolder = useMutation(api.folders.create);

  const [name, setName] = useState("");
  const [format, setFormat] = useState(list ? CARD_LIST : "commander");
  const [commander, setCommander] = useState<scry.ScryCard | null>(null);
  const [folder, setFolder] = useState<string>(folderId ?? "");
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => ref.current?.showModal(), []);

  const needsCommander = hasCommander(format);
  const untitled = format === CARD_LIST ? "Untitled list" : "Untitled deck";
  // A commander picked for Commander may not suit Conquest's stricter rules.
  useEffect(() => {
    if (commander && !(needsCommander && canCommand(commander, format))) setCommander(null);
  }, [format]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const deckName = name.trim() || commander?.name || untitled;
    setBusy(true);
    setError("");
    try {
      let folderToUse: Id<"deckFolders"> | undefined = folder && folder !== NEW_FOLDER ? (folder as Id<"deckFolders">) : undefined;
      if (folder === NEW_FOLDER) {
        folderToUse = await createFolder({ name: folderName });
        setFolder(folderToUse); // a retry after a failed deck save doesn't make the folder twice
      }
      const cards: DeckCard[] = [];
      if (commander && needsCommander) {
        const cardName = scry.deckName(commander);
        let print = commander;
        if (printingPref() !== "default") {
          try {
            print = (await scry.preferredPrintings([cardName], printingPref())).get(cardName.toLowerCase()) ?? commander;
          } catch {
            // Scryfall busy: keep the printing that was shown.
          }
        }
        cards.push({ name: cardName, quantity: 1, board: "commander", scryfallId: print.id, set: print.set, collectorNumber: print.collector_number });
      }
      const id = await createDeck({ name: deckName, format, cards, folderId: folderToUse });
      ref.current?.close();
      navigate(`/decks/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="new-deck" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <form onSubmit={(e) => void create(e)}>
        <h3>{list ? "New list" : "New deck"}</h3>
        <label>
          Name
          <input value={name} maxLength={100} autoFocus placeholder={commander?.name ?? untitled} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className={list ? undefined : "new-deck-row"}>
          {!list && <label>
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
            </select>
          </label>}
          <label>
            Folder
            <select value={folder} onChange={(e) => setFolder(e.target.value)} disabled={folders === undefined}>
              <option value="">{folders === undefined ? "Loading folders…" : "No folder"}</option>
              {(folders ?? []).map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
              <option value={NEW_FOLDER}>+ New folder…</option>
            </select>
          </label>
        </div>
        {format === CARD_LIST && <p className="muted small format-hint">Any cards, any number: no commander, deck size or legality checks. Lists can't be picked for games.</p>}
        {folder === NEW_FOLDER && (
          <label>
            New folder name
            <input value={folderName} maxLength={MAX_FOLDER_NAME} required placeholder="e.g. Competitive, Casual, Testing" onChange={(e) => setFolderName(e.target.value)} />
          </label>
        )}
        {needsCommander && <CommanderPicker format={format} picked={commander} onPick={setCommander} />}
        <p className="form-error">{error}</p>
        <div className="actions new-deck-actions">
          <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn" disabled={busy}><BusyLabel busy={busy} working="Creating…">{format === CARD_LIST ? "Create list" : "Create deck"}</BusyLabel></button>
        </div>
      </form>
    </dialog>
  );
}

/** Search for a commander by name; the picked one shows as a card with a button to change it. */
function CommanderPicker({ format, picked, onPick }: { format: string; picked: scry.ScryCard | null; onPick: (c: scry.ScryCard | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<scry.ScryCard[] | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const support = useCardSupport();
  const flips = useFlips();
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    const mine = ++seq.current;
    setError("");
    setSearching(text.length >= 2);
    if (text.length < 2) return setResults(null);
    const timer = window.setTimeout(() => {
      scry.search(format === "conquest" ? `${text} t:legendary` : `${text} is:commander`).then(
        (p) => mine === seq.current && (setResults(p.cards.filter((c) => canCommand(c, format)).slice(0, MAX_RESULTS)), setSearching(false)),
        (e) => mine === seq.current && (setError(scry.lookupError(e)), setSearching(false)),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, format, attempt]);

  if (picked) {
    const st = support?.status(picked);
    return (
      <div className="field">
        <span className="field-label">Commander</span>
        <div className="picked-commander">
          {scry.imageUrl(picked, "small") && <CardImg tiny src={scry.imageUrl(picked, "small")!} name={picked.name} alt="" />}
          <div>
            <strong>{picked.name}</strong>
            <p className="muted small">{picked.type_line}</p>
            {st && !st.works && <p className="small form-error">{st.missing ? "Not playable yet" : "Known issue"}: {st.reason}</p>}
          </div>
          <button type="button" className="btn ghost small" onClick={() => onPick(null)}>Change</button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <label>
        Commander <small>optional, you can pick one later in the editor</small>
        <input type="search" value={q} placeholder="Search for a legendary creature…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
      </label>
      {error ? (
        <p className="form-error">{error} <button type="button" className="text-link" onClick={() => setAttempt((n) => n + 1)}>Try again</button></p>
      ) : searching && !results?.length ? (
        <p className="small"><ScryfallWaiting text={`Searching for “${q.trim()}”…`} still="Still searching." /></p>
      ) : results === null ? null : !results.length ? (
        <p className="muted small">No commanders match “{q.trim()}”.</p>
      ) : (
        <div className={`commander-results${searching ? " refreshing" : ""}`} aria-busy={searching}>
          {results.map((c) => {
            const st = support?.status(c);
            const face = flips.face(c);
            return (
              <div key={c.id} className="flip-host">
                <button type="button" className="commander-result" title={st && !st.works ? `${c.name}: ${st.reason}` : `Make ${c.name} the commander`} onClick={() => onPick(c)}>
                  {scry.imageUrl(c, "normal", face) ? <CardImg src={scry.imageUrl(c, "normal", face)!} name={c.name} alt={c.name} loading="lazy" /> : <span className="noimg">{c.name}</span>}
                  {st && !st.works && <span className="small form-error">{st.missing ? "Not playable yet" : "Known issue"}</span>}
                </button>
                <FlipButton card={c} face={face} onFlip={flips.toggle} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
