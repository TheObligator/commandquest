// The deck editor's card shortcuts: they act on the selected cards, or with none selected, on the
// card under the pointer. Matched by the physical key (`code`), since Alt+1 types "¡" on a Mac.
// No React or DOM here, so it's tested.

export type DeckShortcut = "addOne" | "removeOne" | "toSide" | "toMaybe" | "toMain" | "tags";

export const DECK_SHORTCUTS: Record<DeckShortcut, string[]> = {
  addOne: ["Alt", "1"],
  removeOne: ["Alt", "2"],
  toSide: ["Alt", "3"],
  toMaybe: ["Alt", "4"],
  toMain: ["Alt", "5"],
  tags: ["Alt", "T"],
};

const BY_CODE: Record<string, DeckShortcut> = { Digit1: "addOne", Digit2: "removeOne", Digit3: "toSide", Digit4: "toMaybe", Digit5: "toMain", KeyT: "tags" };

/** The shortcut a key press is, or null. Only Alt (Option) with the key, no other modifier. */
export function deckShortcut(e: { code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): DeckShortcut | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  return BY_CODE[e.code] ?? null;
}

/** A key as it's printed on this computer's keyboard: ⌥ and ⌘ on a Mac. */
export function keyLabel(key: string, mac: boolean): string {
  if (!mac) return key;
  return key === "Alt" ? "⌥" : key === "Ctrl" ? "⌘" : key === "Shift" ? "⇧" : key;
}

/** One line per card, "2 Sol Ring", for copying the selected cards. */
export function cardLines(cards: { name: string; quantity: number }[]): string {
  return cards.map((c) => `${c.quantity} ${c.name}`).join("\n");
}
