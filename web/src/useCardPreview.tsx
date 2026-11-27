// Hover preview: a card image beside the hovered card or row, for lists of card names and stacked cards.
// Off on touch screens (no hover); tapping opens the card details instead.
import { useState } from "react";
import { CardImg } from "./components/CardImg";
import * as scry from "./scryfall";

/** Space between the two faces of a double-faced card. */
const PREVIEW_GAP = 8;
/** An upright preview's size; a sideways one (a battle, a split card) is the same turned. */
const PREVIEW_W = 250, PREVIEW_H = 349;

type Face = { url: string; sideways: boolean };

export function useCardPreview() {
  /** `faces`: the face shown, then (a double-faced card) the other face beside it. */
  const [preview, setPreview] = useState<{ faces: Face[]; x: number; y: number } | null>(null);
  /**
   * Beside the hovered card or row, never over it: to its right if that fits, else to its left,
   * else (an element almost as wide as the window) beside the cursor. Vertically it follows the
   * cursor, kept on screen.
   */
  const position = (e: React.MouseEvent, faces: Face[]) => {
    const w = faces.reduce((sum, f) => sum + (f.sideways ? PREVIEW_H : PREVIEW_W), PREVIEW_GAP * (faces.length - 1));
    const h = faces.some((f) => !f.sideways) ? PREVIEW_H : PREVIEW_W, pad = 12;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let x: number;
    if (r.right + pad + w <= innerWidth - 8) x = r.right + pad;
    else if (r.left - pad - w >= 8) x = r.left - pad - w;
    else x = e.clientX + 18 + w <= innerWidth ? e.clientX + 18 : Math.max(8, e.clientX - w - 18);
    const y = Math.min(Math.max(8, e.clientY - h / 2), innerHeight - h - 8);
    return { x, y };
  };
  /** `face`: which face to preview (1 = the back of a double-faced card that's turned over). */
  const handlers = (c: scry.ScryCard | undefined, face = 0) => ({
    onMouseEnter: (e: React.MouseEvent) => {
      if (!c || matchMedia("(hover: none)").matches) return;
      const url = scry.imageUrl(c, "normal", face);
      if (!url) return;
      // Both faces of a double-faced card, the one showing first.
      const other = scry.hasBackImage(c) ? scry.imageUrl(c, "normal", face ? 0 : 1) : undefined;
      const faces = [{ url, sideways: scry.isSideways(c, face) }];
      if (other && other !== url) faces.push({ url: other, sideways: scry.isSideways(c, face ? 0 : 1) });
      setPreview({ faces, ...position(e, faces) });
    },
    // Measure now: React clears the event's currentTarget once the handler returns, and a state
    // updater runs later (that blanked the page).
    onMouseMove: (e: React.MouseEvent) => {
      if (!preview) return;
      const at = position(e, preview.faces);
      setPreview((p) => (p ? { ...p, ...at } : p));
    },
    onMouseLeave: () => setPreview(null),
  });
  /** Render inside any open modal <dialog>, or the dialog's top layer hides it. */
  const element = preview && (
    <div className={`preview${preview.faces.length > 1 ? " two-faces" : ""}`} style={{ transform: `translate(${preview.x}px, ${preview.y}px)` }}>
      {preview.faces.map((f) => f.sideways
        ? <span key={f.url} className="sideways"><span className="sideways-turn"><CardImg src={f.url} name="" alt="" /></span></span>
        : <CardImg key={f.url} src={f.url} name="" alt="" />)}
    </div>
  );
  return { handlers, element, hide: () => setPreview(null) };
}
