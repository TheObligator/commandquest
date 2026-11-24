// Hover preview: a card image beside the hovered card or row, for lists of card names and stacked cards.
// Off on touch screens (no hover); tapping opens the card details instead.
import { useState } from "react";
import { CardImg } from "./components/CardImg";
import * as scry from "./scryfall";

/** Space between the two faces of a double-faced card. */
const PREVIEW_GAP = 8;

export function useCardPreview() {
  /** `urls`: the face shown, then (a double-faced card) the other face beside it. */
  const [preview, setPreview] = useState<{ urls: string[]; x: number; y: number } | null>(null);
  /**
   * Beside the hovered card or row, never over it: to its right if that fits, else to its left,
   * else (an element almost as wide as the window) beside the cursor. Vertically it follows the
   * cursor, kept on screen.
   */
  const position = (e: React.MouseEvent, faces = 1) => {
    const w = 250 * faces + PREVIEW_GAP * (faces - 1), h = 349, pad = 12;
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
      const urls = other && other !== url ? [url, other] : [url];
      setPreview({ urls, ...position(e, urls.length) });
    },
    // Measure now: React clears the event's currentTarget once the handler returns, and a state
    // updater runs later (that blanked the page).
    onMouseMove: (e: React.MouseEvent) => {
      const faces = preview?.urls.length ?? 1;
      const at = position(e, faces);
      setPreview((p) => (p ? { ...p, ...at } : p));
    },
    onMouseLeave: () => setPreview(null),
  });
  /** Render inside any open modal <dialog>, or the dialog's top layer hides it. */
  const element = preview && (
    <div className={`preview${preview.urls.length > 1 ? " two-faces" : ""}`} style={{ transform: `translate(${preview.x}px, ${preview.y}px)` }}>
      {preview.urls.map((u) => <CardImg key={u} src={u} name="" alt="" />)}
    </div>
  );
  return { handlers, element, hide: () => setPreview(null) };
}
