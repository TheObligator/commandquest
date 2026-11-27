import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_FOLDER_NAME } from "../../convex/model/folderRules";
import { errorMessage } from "../app/errors";
import { navigate, useRoute } from "../app/router";
import { bracketName } from "../brackets";
import { closeOnBackdrop } from "../carddetails";
import { CardMenu, type MenuItem } from "../components/CardMenu";
import { DeckTabs } from "../components/DeckTabs";
import { BusyLabel, CoverWait, DeckSkeletons } from "../components/Spinner";
import { CARD_LIST, formatLabel } from "../deckFormats";
import { DEFAULT_SORT, firstDir, pickSort, SORTS, sortDecks, type DeckSort, type SortKey } from "../deckSort";
import { toast } from "../dom";
import { artistOf, cachedById, cardsById } from "../scryfall";
import { useDeckColors } from "../useDeckColors";
import { useGameChecks } from "../useGameDecks";
import { DeckTable, type TableFolder } from "./DeckTable";
import { NewDeckDialog } from "./NewDeckDialog";
import { ShareDialog } from "../components/ShareDialog";
import { sharePath, VISIBILITY } from "../sharing";

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

/** How many decks this list had last time (so its placeholders don't promise more), or sets it. */
const COUNT_KEY = "cq.deckCount.";
function savedCount(key: string, set?: number): number {
  try {
    if (set !== undefined) localStorage.setItem(key, String(set));
    return Math.min(60, Number(localStorage.getItem(key)) || 0);
  } catch {
    return 0; // no storage: the spinner instead
  }
}

/** How this browser shows the deck list: as a table (with folders, or every deck together) or as covers, and sorted how. */
interface DeckView {
  view: "list" | "covers";
  folders: boolean;
  sort: DeckSort;
}
const VIEW_KEY = "cq.deckView";

function loadView(): DeckView {
  let v: Partial<DeckView> = {};
  try {
    v = (JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<DeckView> | null) ?? {};
  } catch {
    // nothing saved: the defaults
  }
  const sort = SORTS.some((s) => s.id === v.sort?.key) ? { key: v.sort!.key, dir: v.sort!.dir === "asc" ? "asc" as const : "desc" as const } : DEFAULT_SORT;
  return { view: v.view === "covers" ? "covers" : "list", folders: v.folders !== false, sort };
}

export function DeckList() {
  const { query } = useRoute();
  const decks = useQuery(api.decks.list);
  const folders = useQuery(api.folders.list);
  const moveDeck = useMutation(api.decks.move);
  const removeFolder = useMutation(api.folders.remove);
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState<Id<"decks"> | null>(null);
  const [naming, setNaming] = useState<{ id?: Id<"deckFolders">; name: string; deckId?: Id<"decks"> } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Which decks can start a game: the table's deck picker only offers those, so the rest are marked here.
  const [how, setHow] = useState(loadView);
  const change = (c: Partial<DeckView>) => {
    const next = { ...how, ...c };
    setHow(next);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {
      // private mode: still used for this visit
    }
  };
  const asList = how.view === "list";
  const setBracket = useMutation(api.decks.setBracket);
  const { colors, done: colorsDone } = useDeckColors(decks, asList || how.sort.key === "colors");
  const playDecks = useQuery(api.decks.forPlay);
  const checks = useGameChecks(playDecks);
  /** The covers whose cards have been looked up (found or not). */
  const [artLoaded, setArtLoaded] = useState("");

  // Cover art is Scryfall's art crop of the commander. Scryfall requires the artist credit
  // wherever an art crop is shown, so each cover carries an "Art by …" caption.
  const coverIds = (decks ?? []).map((d) => d.coverScryfallId).filter((id): id is string => !!id);
  const coverKey = coverIds.join(",");
  useEffect(() => {
    if (!coverIds.length) return;
    cardsById(coverIds).catch(() => undefined).finally(() => setArtLoaded(coverKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey]);

  // The folder being shown lives in the URL (#/decks?folder=…), so Back and reloads keep it.
  const param = query.get("folder");
  // "No folder" is one of the covers' buttons; the table has folders beside the decks in none.
  const shown: Shown = param === "none" ? (asList ? "all" : "none") : param && folders?.some((f) => f._id === param) ? (param as Id<"deckFolders">) : "all";
  const show = (s: Shown) => navigate(s === "all" ? "/decks" : `/decks?folder=${s}`, true);
  const folder = folders?.find((f) => f._id === shown);
  /** The table lists the folders, so decks in one aren't listed beside them. */
  const folderRows = asList && how.folders && shown === "all";
  const visible = useMemo(
    () =>
      sortDecks(
        (decks ?? [])
          .filter((d) => (shown === "none" || folderRows ? !d.folderId : shown === "all" || d.folderId === shown))
          .map((d) => ({ ...d, colors: colors.get(d._id) })),
        how.sort,
      ),
    [decks, shown, folderRows, colors, how.sort],
  );
  const countIn = (id: Id<"deckFolders">) => (decks ?? []).filter((d) => d.folderId === id).length;
  const unfiled = (decks ?? []).filter((d) => !d.folderId).length;

  const countKey = COUNT_KEY + (param ?? "all");
  useEffect(() => {
    if (decks && folders) savedCount(countKey, visible.length);
  }, [decks, folders, countKey, visible.length]);

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

  async function changeBracket(id: Id<"decks">, bracket: number | undefined) {
    try {
      await setBracket({ id, bracket: bracket ?? null });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function deleteFolder(f: { _id: Id<"deckFolders">; name: string }) {
    const n = countIn(f._id);
    if (!confirm(`Delete the folder "${f.name}"?${n ? ` Its ${n === 1 ? "deck stays" : `${n} decks stay`} in your deck list, just not in a folder.` : ""}`)) return;
    try {
      await removeFolder({ id: f._id });
      if (shown === f._id) show("all");
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

  const dragProps = (id: Id<"decks">) => ({
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DECK_DRAG, id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => setDropTarget(null),
  });

  const moveItems = (d: { _id: Id<"decks">; folderId?: Id<"deckFolders"> }): MenuItem[] => [
    ...(folders ?? []).filter((f) => f._id !== d.folderId).map((f) => ({ label: `📁 ${f.name}`, onSelect: () => void move(d._id, f._id) })),
    ...(d.folderId ? [{ label: "Out of the folder", onSelect: () => void move(d._id, null) }] : []),
    { label: "+ New folder…", onSelect: () => setNaming({ name: "", deckId: d._id }) },
  ];

  const deckItems = (d: { _id: Id<"decks">; visibility: string; shareKey?: string }): MenuItem[] => [
    { label: "Share…", onSelect: () => setSharing(d._id) },
    ...(d.visibility !== "private" && d.shareKey ? [{ label: "View shared page", onSelect: () => navigate(sharePath(d.shareKey!)) }] : []),
  ];

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

  const folderButtons = (f: { _id: Id<"deckFolders">; name: string }) => (
    <>
      <button className="btn ghost small" onClick={() => setNaming({ id: f._id, name: f.name })}>Rename</button>
      <button className="btn ghost small danger" onClick={() => void deleteFolder(f)}>Delete folder</button>
    </>
  );

  const folderInfo: TableFolder[] = (folders ?? []).map((f) => {
    const inside = (decks ?? []).filter((d) => d.folderId === f._id);
    return { ...f, count: inside.length, updatedAt: inside.length ? Math.max(...inside.map((d) => d.updatedAt)) : undefined };
  });

  const viewControls = (
    <div className="deck-show">
      {asList && !folder && !!folders?.length && (
        <label className="inline" title="Off: every deck in one list, whichever folder it's in">
          <input type="checkbox" checked={how.folders} onChange={(e) => change({ folders: e.target.checked })} /> Folders
        </label>
      )}
      {/* The table's headers sort it, except on a phone, where there's no room for them. */}
      <div className={`deck-sort${asList ? " narrow-only" : ""}`}>
        <select aria-label="Sort by" value={how.sort.key} onChange={(e) => change({ sort: { key: e.target.value as SortKey, dir: firstDir(e.target.value as SortKey) } })}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
        </select>
        <button className="btn ghost small" aria-label="Reverse the order" title="Reverse the order" onClick={() => change({ sort: pickSort(how.sort, how.sort.key) })}>
          {how.sort.dir === "asc" ? "↑" : "↓"}
        </button>
      </div>
      <div className="deck-show-as" role="group" aria-label="Show decks as">
        <button aria-pressed={asList} onClick={() => change({ view: "list" })}><span aria-hidden="true">☰</span> List</button>
        <button aria-pressed={!asList} onClick={() => change({ view: "covers" })}><span aria-hidden="true">▦</span> Covers</button>
      </div>
    </div>
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
        <DeckTabs current="decks" />
        {actions}
      </div>
      {decks === undefined || folders === undefined ? (
        <DeckSkeletons n={savedCount(countKey)} rows={asList} text="Loading your decks…" />
      ) : decks.length === 0 && folders.length === 0 ? (
        <div className="empty card">
          <h3>No decks yet</h3>
          <p>Start from scratch, copy a preconstructed deck, or bring a list over from Moxfield, Archidekt or a text file.</p>
          {actions}
        </div>
      ) : (
        <>
        {asList ? (
          <div className="deck-bar-row">
            {folder ? (
              <>
                <nav className="deck-crumbs" aria-label="Folder">
                  <a href="#/decks" className={dropTarget === "none" ? "drop" : undefined} {...dropProps("none")}>All decks</a>
                  <span className="muted" aria-hidden="true">›</span>
                  <h2>📁 {folder.name}</h2>
                </nav>
                {folderButtons(folder)}
              </>
            ) : (
              <>
                <h2>{decks.length} deck{decks.length === 1 ? "" : "s"}</h2>
                <button className="btn ghost small" onClick={() => setNaming({ name: "" })}>+ New folder</button>
              </>
            )}
            {viewControls}
          </div>
        ) : (
          <>
            <div className="deck-bar-row">
              <div className="folder-bar" role="toolbar" aria-label="Folders">
                {chip("all", "All decks", decks.length)}
                {folders.length > 0 && chip("none", "No folder", unfiled)}
                {folders.map((f) => chip(f._id, f.name, countIn(f._id)))}
                <button className="folder-chip add" onClick={() => setNaming({ name: "" })}>+ New folder</button>
              </div>
              {viewControls}
            </div>
            {folder && (
              <div className="folder-head">
                <h2>📁 {folder.name}</h2>
                {folderButtons(folder)}
              </div>
            )}
          </>
        )}
        {asList && (visible.length > 0 || folderRows) && (folders.length > 0 || decks.length > 0) && (
          <DeckTable
            decks={visible}
            folders={folderRows ? folderInfo : []}
            sort={how.sort}
            onSort={(sort) => change({ sort })}
            colorsDone={colorsDone}
            checks={checks}
            folderName={(d) => (shown === "all" ? folders.find((f) => f._id === d.folderId)?.name : undefined)}
            onBracket={(d, b) => void changeBracket(d._id, b)}
            moveItems={moveItems}
            deckItems={deckItems}
            folderItems={(f) => [
              { label: "Rename…", onSelect: () => setNaming({ id: f._id, name: f.name }) },
              { label: "Delete folder", danger: true, onSelect: () => void deleteFolder(f) },
            ]}
            dragProps={(d) => dragProps(d._id)}
            dropProps={dropProps}
            dropTarget={dropTarget}
          />
        )}
        <div className="deck-grid">
          {visible.length === 0 && !(folderRows && decks.length > 0) &&
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
                <p>Make a deck here, or move one in: drag it onto this folder in the deck list, or use the ⋯ menu on the deck.</p>
                <div className="actions"><button className="btn" onClick={() => setCreating(true)}>+ New deck in {folder?.name}</button></div>
              </div>
            ))}
          {!asList && visible.map((d) => {
            const card = d.coverScryfallId ? cachedById(d.coverScryfallId) : undefined;
            const art = card && (card.card_faces?.[0]?.image_uris?.art_crop ?? card.image_uris?.art_crop);
            const check = checks?.get(d._id);
            const inFolder = folders.find((f) => f._id === d.folderId);
            return (
              <div key={d._id} className="deck-tile-wrap">
              <CardMenu label={`${d.name}: deck options`} className="deck-tile-menu" sections={[{ title: d.name, items: deckItems(d) }, { title: "Move to folder", items: moveItems(d) }]} />
              <a
                className="deck-tile"
                href={`#/decks/${d._id}`}
                draggable
                {...dragProps(d._id)}
              >
                <div className="deck-cover" style={art ? { backgroundImage: `url("${art}")` } : undefined}>
                  <CoverWait src={art || undefined} pending={!!d.coverScryfallId && !card && artLoaded !== coverKey} />
                  {art && <span className="art-credit">Art by {artistOf(card!) ?? "unknown"} · © Wizards of the Coast</span>}
                </div>
                <div className="deck-meta">
                  <h3>{d.name} <span className="vis-mark" title={`${VISIBILITY[d.visibility].label}: ${VISIBILITY[d.visibility].hint}`} aria-label={VISIBILITY[d.visibility].label}>{VISIBILITY[d.visibility].icon}</span></h3>
                  {d.format !== CARD_LIST && <p>{d.commanders.length ? d.commanders.join(" & ") : "No commander"}</p>}
                  <p className="muted small">
                    {formatLabel(d.format)}
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
      {sharing && (() => {
        const d = decks?.find((x) => x._id === sharing);
        return d ? <ShareDialog deck={d} colors={colors.get(d._id)} onClose={() => setSharing(null)} /> : null;
      })()}
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
          <button className="btn" disabled={busy || !name.trim()}><BusyLabel busy={busy} working={id ? "Renaming…" : "Creating…"}>{id ? "Rename" : "Create folder"}</BusyLabel></button>
        </div>
      </form>
    </dialog>
  );
}
