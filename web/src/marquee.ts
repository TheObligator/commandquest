// Drag select in the deck editor: which cards a box drawn over the deck catches. Only the part of a
// card you can see counts. In Stacked and Spread each card is covered from below by the cards after
// it, so a card behind another is caught only where its own strip shows. No DOM here, so it's tested.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The part of each card that shows, given every card's box in the order they're drawn (later ones on
 * top). A card's bottom is cut off at the top edge of any later card lying over it; cards beside it
 * (the same top, or not overlapping sideways) don't cut it.
 */
export function visibleParts(boxes: Box[]): Box[] {
  return boxes.map((b, i) => {
    let bottom = b.bottom;
    for (let j = i + 1; j < boxes.length; j++) {
      const o = boxes[j];
      if (o.left < b.right && o.right > b.left && o.top > b.top && o.top < bottom) bottom = o.top;
    }
    return { ...b, bottom };
  });
}

/** The box from where the drag started to where the pointer is now. */
export function boxBetween(x1: number, y1: number, x2: number, y2: number): Box {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
}

/** The two boxes share some area (touching edges isn't enough). */
export const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** The indexes of the cards (by their visible parts) that `band` touches. */
export function caught(band: Box, visible: Box[]): number[] {
  return visible.flatMap((v, i) => (overlaps(band, v) ? [i] : []));
}
