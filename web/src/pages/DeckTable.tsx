// The deck list as a table: folders first, then a row per deck, sorted by the column headers.
// (DeckList.tsx has the covers, and everything a row does.)
import type { Id } from "../../convex/_generated/dataModel";
import { bracketName } from "../brackets";
import { BracketMenu } from "../components/BracketMenu";
import { CardMenu, type MenuItem } from "../components/CardMenu";
import { Symbol } from "../components/ManaCost";
import { formatLabel, hasCommander } from "../deckFormats";
import type { GameCheck } from "../deckcheck";
import { pickSort, SORTS, sortFolders, type DeckSort } from "../deckSort";
import type { Visibility } from "../../convex/model/sharing";
import { VISIBILITY } from "../sharing";

export interface TableDeck {
  _id: Id<"decks">;
  name: string;
  format: string;
  bracket?: number;
  cardCount: number;
  commanders: string[];
  updatedAt: number;
  colors?: string;
  visibility?: Visibility;
}

export interface TableFolder {
  _id: Id<"deckFolders">;
  name: string;
  count: number;
  /** Its newest deck's. */
  updatedAt?: number;
}

type DropProps = Pick<React.HTMLAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">;

export function longAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))} mo ago`;
  return `${Math.floor(s / (86400 * 365))} yr ago`;
}

const When = ({ ms }: { ms: number }) => <time dateTime={new Date(ms).toISOString()} title={new Date(ms).toLocaleString()}>{longAgo(ms)}</time>;

export function DeckTable<D extends TableDeck>(props: {
  decks: D[];
  /** The folders to list; none inside a folder, or when every deck is listed together. */
  folders: TableFolder[];
  sort: DeckSort;
  onSort: (s: DeckSort) => void;
  /** Nothing more is coming about decks without `colors`. */
  colorsDone: boolean;
  checks?: Map<string, GameCheck>;
  /** The folder to name on a deck's row. */
  folderName: (d: D) => string | undefined;
  onBracket: (d: D, bracket: number | undefined) => void;
  moveItems: (d: D) => MenuItem[];
  /** "Share…", and the like: the deck menu's first section. */
  deckItems: (d: D) => MenuItem[];
  folderItems: (f: TableFolder) => MenuItem[];
  dragProps: (d: D) => React.HTMLAttributes<HTMLElement>;
  dropProps: (folder: Id<"deckFolders">) => DropProps;
  dropTarget: string | null;
}) {
  const { sort } = props;
  return (
    <div className="deck-table" role="table" aria-label="Your decks">
      <div className="deck-row head" role="row">
        {SORTS.map((s) => (
          <div key={s.id} className={`dt-${s.id}`} role="columnheader" aria-sort={sort.key !== s.id ? undefined : sort.dir === "asc" ? "ascending" : "descending"}>
            <button className={sort.key === s.id ? sort.dir : undefined} onClick={() => props.onSort(pickSort(sort, s.id))}>
              {s.label}
              <span className="sort-arrows" aria-hidden="true"><i /><i /></span>
            </button>
          </div>
        ))}
        <div className="dt-menu" role="columnheader"><span className="sr-only">Actions</span></div>
      </div>
      {sortFolders(props.folders, sort).map((f) => (
        <div key={f._id} className={`deck-row folder${props.dropTarget === f._id ? " drop" : ""}`} role="row" {...props.dropProps(f._id)}>
          <div className="dt-name" role="cell">
            <FolderIcon />
            <a className="row-link" href={`#/decks?folder=${f._id}`} draggable={false}>{f.name}</a>
            <span className="muted small" title={`${f.count} deck${f.count === 1 ? "" : "s"}`}>{f.count}</span>
          </div>
          <div className="dt-updated" role="cell">{f.updatedAt !== undefined && <When ms={f.updatedAt} />}</div>
          <div className="dt-menu" role="cell">
            <CardMenu label={`${f.name}: folder options`} className="row-menu" sections={[{ title: f.name, items: props.folderItems(f) }]} />
          </div>
        </div>
      ))}
      {props.decks.map((d) => {
        const check = props.checks?.get(d._id);
        const folder = props.folderName(d);
        const commanders = d.commanders.join(" & ") || (hasCommander(d.format) ? "No commander" : "");
        return (
          <div key={d._id} className="deck-row" role="row" draggable {...props.dragProps(d)}>
            <div className="dt-name" role="cell">
              <a className="row-link" href={`#/decks/${d._id}`} draggable={false} title={d.name}>{d.name}</a>
              {d.visibility && <span className="vis-mark" title={`${VISIBILITY[d.visibility].label}: ${VISIBILITY[d.visibility].hint}`} aria-label={VISIBILITY[d.visibility].label}>{VISIBILITY[d.visibility].icon}</span>}
              <div className="muted dt-sub">{[commanders, folder && `📁 ${folder}`].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="dt-colors" role="cell"><Colors colors={d.colors} done={props.colorsDone} /></div>
            <div className="dt-format" role="cell">
              {d.format === "commander" ? (
                <BracketMenu
                  label={`${d.name}: set the bracket`}
                  className="format-btn"
                  bracket={d.bracket}
                  onBracket={(b) => props.onBracket(d, b)}
                  trigger={
                    <>
                      <span>Commander</span>
                      <span className="dt-sub">
                        {d.bracket ? `Bracket ${d.bracket} (${bracketName(d.bracket)})` : "No bracket"} <span className="caret" aria-hidden="true">▾</span>
                      </span>
                    </>
                  }
                />
              ) : (
                formatLabel(d.format)
              )}
            </div>
            <div className="dt-cards" role="cell">{d.cardCount}<span className="dt-unit"> cards</span></div>
            <div className="dt-updated" role="cell"><When ms={d.updatedAt} /></div>
            <div className="dt-menu" role="cell">
              {check?.problems.length ? (
                <Note mark="⚠" className="warn" title="Can't be played yet" lines={check.problems} />
              ) : check?.needsFreePlay.length ? (
                <Note mark="✋" title="Needs free play" lines={[`Not in the rules engine yet: ${check.needsFreePlay.join(", ")}`]} />
              ) : null}
              <CardMenu label={`${d.name}: deck options`} className="row-menu" sections={[{ title: d.name, items: props.deckItems(d) }, { title: "Move to folder", items: props.moveItems(d) }]} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Colors({ colors, done }: { colors?: string; done: boolean }) {
  if (colors !== undefined) return <span className="dt-pips">{[...(colors || "C")].map((c) => <Symbol key={c} sym={c} />)}</span>;
  return done ? <span className="muted" title="No colors to show">–</span> : <span className="sk-bar shimmer dt-pips-wait" />;
}

/** A mark on a deck: hover for what it's about, or click it (there's no hover on a phone). */
function Note({ mark, title, lines, className = "" }: { mark: string; title: string; lines: string[]; className?: string }) {
  return (
    <CardMenu
      label={`${title}:\n${lines.join("\n")}`}
      className={`row-note ${className}`}
      trigger={<span aria-hidden="true">{mark}</span>}
      sections={[{ title, items: lines.map((l) => ({ label: l, onSelect: () => undefined, disabled: true })) }]}
    />
  );
}

function FolderIcon() {
  return (
    <svg className="folder-icon" width="18" height="15" viewBox="0 0 18 15" fill="currentColor" aria-hidden="true">
      <path d="M1.5 0h5l2 2h8A1.5 1.5 0 0 1 18 3.500v10a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 0 13.500v-12A1.500 1.500 0 0 1 1.500 0z" />
    </svg>
  );
}
