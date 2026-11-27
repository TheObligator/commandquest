// A description written in the rich text box (DescriptionEditor.tsx), shown read-only. Renders the
// cleaned document (convex/model/richText.ts) as React elements, never as HTML, so nothing in it runs.
import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { RichMark, RichNode } from "../../convex/model/richText";
import { showCardDetails } from "../carddetails";
import * as scry from "../scryfall";
import { useCardPreview } from "../useCardPreview";

type Preview = ReturnType<typeof useCardPreview>;

/** A card named in the text: its image on hover, its details on click. */
function CardName({ name, preview }: { name: string; preview: Preview }) {
  useSyncExternalStore(scry.onLookup, scry.lookupVersion);
  useEffect(() => scry.wantCard(name), [name]);
  const card = scry.cached({ name, quantity: 1, board: "main" });
  return (
    <button type="button" className="card-ref" {...preview.handlers(card)} onClick={() => card && (preview.hide(), showCardDetails(card))} disabled={!card} title={card ? undefined : name}>
      {name}
    </button>
  );
}

function withMarks(text: string, marks: RichMark[] = []): ReactNode {
  return marks.reduce<ReactNode>((inner, m) => {
    if (m.type === "link") return <a href={m.attrs.href} target="_blank" rel="noopener noreferrer nofollow ugc">{inner}</a>;
    if (m.type === "bold") return <strong>{inner}</strong>;
    if (m.type === "italic") return <em>{inner}</em>;
    return <s>{inner}</s>;
  }, text);
}

function render(node: RichNode, key: number, preview: Preview): ReactNode {
  const kids = (content: RichNode[] = []) => content.map((n, i) => render(n, i, preview));
  switch (node.type) {
    case "doc":
      return <Fragment key={key}>{kids(node.content)}</Fragment>;
    case "paragraph":
      return <p key={key}>{node.content ? kids(node.content) : <br />}</p>;
    case "heading":
      return node.attrs.level === 3 ? <h4 key={key}>{kids(node.content)}</h4> : <h3 key={key}>{kids(node.content)}</h3>;
    case "bulletList":
      return <ul key={key}>{kids(node.content)}</ul>;
    case "orderedList":
      return <ol key={key} start={node.attrs?.start}>{kids(node.content)}</ol>;
    case "listItem":
      return <li key={key}>{kids(node.content)}</li>;
    case "hardBreak":
      return <br key={key} />;
    case "text":
      return <Fragment key={key}>{withMarks(node.text, node.marks)}</Fragment>;
    case "card":
      return <CardName key={key} name={node.attrs.id} preview={preview} />;
  }
}

export function RichText({ doc, className }: { doc: RichNode; className?: string }) {
  const preview = useCardPreview();
  return (
    <div className={`rich-text${className ? ` ${className}` : ""}`}>
      {render(doc, 0, preview)}
      {preview.element}
    </div>
  );
}
