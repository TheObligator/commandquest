// A deck's description at the top of the editor's deck panel: "Add a description" until there is
// one, then the text, which its owner clicks (or Edit) to change in the rich text box.
import { lazy, Suspense, useMemo, useState } from "react";
import { parseDescription } from "../../convex/model/richText";
import { FoldHeading, useCollapsed } from "./Collapsible";
import { RichText } from "./RichText";
import { Spinner } from "./Spinner";

const DescriptionEditor = lazy(() => import("./DescriptionEditor"));

export function DeckDescription({ value, onChange }: { value: string | undefined; onChange: (json: string | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  const [closed, toggle] = useCollapsed("description");
  const doc = useMemo(() => {
    try {
      return parseDescription(value);
    } catch {
      return undefined;
    }
  }, [value]);

  if (editing) {
    return (
      <div className="deck-description">
        <Suspense fallback={<p className="muted small"><Spinner /> Opening the editor…</p>}>
          <DescriptionEditor value={value} onChange={onChange} onDone={() => setEditing(false)} />
        </Suspense>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="deck-description">
        <button type="button" className="add-description" onClick={() => setEditing(true)}>＋ Add a description</button>
      </div>
    );
  }
  // Once written, it folds away under a Description heading like the editor's other sections.
  return (
    <div className={`board deck-description${closed ? " folded" : ""}`}>
      <FoldHeading closed={closed} onToggle={toggle}>Description</FoldHeading>
      {!closed && (
        <>
          <div
            className="description-text"
            title="Click to edit the description"
            // A click on a link or a card name does that instead.
            onClick={(e) => !(e.target as Element).closest("a, button") && !window.getSelection()?.toString() && setEditing(true)}
          >
            <RichText doc={doc} />
          </div>
          <button type="button" className="link small edit-description" onClick={() => setEditing(true)}>Edit</button>
        </>
      )}
    </div>
  );
}
