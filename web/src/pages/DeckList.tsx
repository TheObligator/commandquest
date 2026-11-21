import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_FOLDER_NAME } from "../../convex/model/folderRules";
import { errorMessage } from "../app/errors";
import { navigate, useRoute } from "../app/router";
import { bracketName } from "../brackets";
import { closeOnBackdrop } from "../carddetails";
import { CardMenu, type MenuItem } from "../components/CardMenu";
import { Loading } from "../components/Spinner";
import { toast } from "../dom";
import { artistOf, cachedById, cardsById } from "../scryfall";
import { useGameChecks } from "../useGameDecks";
import { NewDeckDialog } from "./NewDeckDialog";

/** The deck list's folder filter: every deck, decks in no folder, or one folder. */
type Shown = "all" | "none" | Id<"deckFolders">;
/** What a dragged deck tile carries, so dropping it on a folder files it there. */
const DECK_DRAG = "application/x-commandquest-deck";

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString();
}

export function DeckList() {
  const { query } = useRoute();
  const decks = useQuery(api.decks.list);
  const folders = useQuery(api.folders.list);
  const moveDeck = useMutation(api.decks.move);
  const removeFolder = useMutation(api.folders.remove);
  const [creating, setCreating] = useState(false);
  const [naming, setNaming] = useState<{ id?: Id<"deckFolders">; name: string; deckId?: Id<"decks"> } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Which decks can start a game: the table's deck picker only offers those, so the rest are marked here.
  const playDecks = useQuery(api.decks.forPlay);
  const checks = useGameChecks(playDecks);
  const [, setArtLoaded] = useState(0);

  // Cover art is Scryfall's art crop of the commander. Scryfall requires the artist credit
  // wherever an art crop is shown, so each cover carries an "Art by …" caption.
  const coverIds = (decks ?? []).map((d) => d.coverScryfallId).filter((id): id is string => !!id);
  const coverKey = coverIds.join(",");
  useEffect(() => {
    if (!coverIds.length) return;
    cardsById(coverIds).then(() => setArtLoaded((n) => n + 1)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey]);

  // The folder being shown lives in the URL (#/decks?folder=…), so Back and reloads keep it.
  const param = query.get("folder");
  const shown: Shown = param === "none" ? "none" : param && folders?.some((f) => f._id === param) ? (param as Id<"deckFolders">) : "all";
  const show = (s: Shown) => navigate(s === "all" ? "/decks" : `/decks?folder=${s}`, true);
  const folder = folders?.find((f) => f._id === shown);
  const visible = (decks ?? []).filter((d) => shown === "all" || (shown === "none" ? !d.folderId : d.folderId === shown));
  const countIn = (id: Id<"deckFolders">) => (decks ?? []).filter((d) => d.folderId === id).length;
  const unfiled = (decks ?? []).filter((d) => !d.folderId).length;

  async function move(deckId: Id<"decks">, to: Id<"deckFolders"> | null) {
    const d = decks?.find((x) => x._id === deckId);
    if (!d || (d.folderId ?? null) === to) return;
    try {
      await moveDeck({ id: deckId, folderId: to });
      toast(to ? `Moved ${d.name} to ${folders?.find((f) => f._id === to)?.name ?? "the folder"}` : `Took ${d.name} out of its folder`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function deleteFolder() {
    if (!folder) return;
    const n = countIn(folder._id);
    if (!confirm(`Delete the folder "${folder.name}"?${n ? ` Its ${n === 1 ? "deck stays" : `${n} decks stay`} in your deck list, just not in a folder.` : ""}`)) return;
    try {
      await removeFolder({ id: folder._id });
      show("all");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  // Drop a dragged deck tile on a folder (or on "No folder") to move it there.
  const dropProps = (target: Shown) =>
    target === "all"
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DECK_DRAG)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTarget(target);
          },
          onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            setDropTarget(null);
            const id = e.dataTransfer.getData(DECK_DRAG);
            if (id) void move(id as Id<"decks">, target === "none" ? null : target);
          },
        };

  const chip = (target: Shown, label: string, count: number) => (
    <button
      key={target}
      className={`folder-chip${shown === target ? " active" : ""}${dropTarget === target ? " drop" : ""}`}
      aria-pressed={shown === target}
      onClick={() => show(target)}
      {...dropProps(target)}
    >
      {target !== "all" && target !== "none" && <span aria-hidden="true">📁 </span>}
      {label} <span className="folder-count">{count}</span>
    </button>
  );

  const actions = (
    <div className="actions">
      <a href="#/decks/precons" className="btn ghost">Browse precons</a>
      <a href="#/decks/new?import=1" className="btn ghost">Import deck</a>
      <button className="btn" onClick={() => setCreating(true)}>+ New deck</button>
    </div>
  );

  return (
    <>
      <div className="page-head row">
        <h1>Your decks</h1>
        {actions}
      </div>
      {decks === undefined || folders === undefined ? (
        <Loading />
      ) : decks.length === 0 && folders.length === 0 ? (
        <div className="empty card">
          <h3>No decks yet</h3>
          <p>Start from scratch, copy a preconstructed deck, or bring a list over from Moxfield, Archidekt or a text file.</p>
          {actions}
        </div>
      ) : (
        <>
        <div className="folder-bar" role="toolbar" aria-label="Folders">
          {chip("all", "All decks", decks.length)}
          {folders.length > 0 && chip("none", "No folder", unfiled)}
          {folders.map((f) => chip(f._id, f.name, countIn(f._id)))}
          <button className="folder-chip add" onClick={() => setNaming({ name: "" })}>+ New folder</button>
        </div>
        {folder && (
          <div className="folder-head">
            <h2>📁 {folder.name}</h2>
            <button className="btn ghost small" onClick={() => setNaming({ id: folder._id, name: folder.name })}>Rename</button>
            <button className="btn ghost small danger" onClick={() => void deleteFolder()}>Delete folder</button>
          </div>
        )}
        <div className="deck-grid">
          {visible.length === 0 &&
            (shown === "all" ? (
              <div className="empty card">
                <h3>No decks yet</h3>
                <p>Start from scratch, copy a preconstructed deck, or bring a list over from Moxfield, Archidekt or a text file.</p>
                {actions}
              </div>
            ) : shown === "none" ? (
              <div className="empty card">
                <h3>Every deck is in a folder</h3>
                <p>Decks you take out of a folder show up here.</p>
              </div>
            ) : (
              <div className="empty card">
                <h3>This folder is empty</h3>
                <p>Make a deck here, or move one in: drag it onto this folder's name above, or use the ⋯ menu on the deck.</p>
                <div className="actions"><button className="btn" onClick={() => setCreating(true)}>+ New deck in {folder?.name}</button></div>
              </div>
            ))}
          {visible.map((d) => {
            const card = d.coverScryfallId ? cachedById(d.coverScryfallId) : undefined;
            const art = card && (card.card_faces?.[0]?.image_uris?.art_crop ?? card.image_uris?.art_crop);
            const check = checks?.get(d._id);
            const inFolder = folders.find((f) => f._id === d.folderId);
            const moveItems: MenuItem[] = [
              ...folders.filter((f) => f._id !== d.folderId).map((f) => ({ label: `📁 ${f.name}`, onSelect: () => void move(d._id, f._id) })),
              ...(d.folderId ? [{ label: "Out of the folder", onSelect: () => void move(d._id, null) }] : []),
              { label: "+ New folder…", onSelect: () => setNaming({ name: "", deckId: d._id }) },
            ];
            return (
              <div key={d._id} className="deck-tile-wrap">
              <CardMenu label={`Move ${d.name} to a folder`} className="deck-tile-menu" sections={[{ title: "Move to folder", items: moveItems }]} />
              <a
                className="deck-tile"
                href={`#/decks/${d._id}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DECK_DRAG, d._id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDropTarget(null)}
              >
                <div className="deck-cover" style={art ? { backgroundImage: `url("${art}")` } : undefined}>
                  {art && <span className="art-credit">Art by {artistOf(card!) ?? "unknown"} · © Wizards of the Coast</span>}
                </div>
                <div className="deck-meta">
                  <h3>{d.name}</h3>
                  <p>{d.commanders.length ? d.commanders.join(" & ") : "No commander"}</p>
                  <p className="muted small">
                    {capitalize(d.format)}
                    {d.format === "commander" && d.bracket ? ` · Bracket ${d.bracket} (${bracketName(d.bracket)})` : ""} · {d.cardCount} cards · {ago(d.updatedAt)}
                  </p>
                  {shown === "all" && inFolder && <p className="muted small deck-folder">📁 {inFolder.name}</p>}
                  {check?.problems.length ? (
                    <div className="deck-unplayable" title={check.problems.join("\n")}>
                      <strong>⚠ Can't be played yet</strong>
                      <ul className="small">{check.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                    </div>
                  ) : check?.needsFreePlay.length ? (
                    <p className="deck-freeplay small" title={`Not in the rules engine yet: ${check.needsFreePlay.join(", ")}`}>✋ Needs free play</p>
                  ) : null}
                </div>
              </a>
              </div>
            );
          })}
        </div>
        </>
      )}
      {creating && <NewDeckDialog folderId={folder?._id} onClose={() => setCreating(false)} />}
      {naming && (
        <FolderNameDialog
          id={naming.id}
          initial={naming.name}
          onDone={(id) => {
            const { deckId } = naming;
            setNaming(null);
            if (id && deckId) void move(deckId, id);
            else if (id && !naming.id) show(id);
          }}
        />
      )}
    </>
  );
}

/** Name a new folder, or rename one (`id`). `onDone` gets the folder's id, or nothing if cancelled. */
function FolderNameDialog({ id, initial, onDone }: { id?: Id<"deckFolders">; initial: string; onDone: (id?: Id<"deckFolders">) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const createFolder = useMutation(api.folders.create);
  const renameFolder = useMutation(api.folders.rename);
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const result = useRef<Id<"deckFolders">>(undefined);
  useEffect(() => ref.current?.showModal(), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (id) await renameFolder({ id, name });
      result.current = id ?? (await createFolder({ name }));
      ref.current?.close();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="new-deck folder-dialog" onClose={() => onDone(result.current)} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <form onSubmit={(e) => void submit(e)}>
        <h3>{id ? "Rename folder" : "New folder"}</h3>
        <label>
          Name
          <input value={name} maxLength={MAX_FOLDER_NAME} required autoFocus placeholder="e.g. Competitive, Casual, Testing" onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="form-error">{error}</p>
        <div className="actions new-deck-actions">
          <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn" disabled={busy || !name.trim()}>{id ? "Rename" : "Create folder"}</button>
        </div>
      </form>
    </dialog>
  );
}
